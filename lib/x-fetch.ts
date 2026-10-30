import type { Client } from '@libsql/client';
import { saveVideo, updateVideoTranscript, updateVideoSummary, saveMention, recordSourceRun,
         bumpTranscriptAttempts, getLatestChannelSummary } from '@/lib/db';
import { fetchUserPosts, xItemId, xPostTitle, xPostUrl, XApiError, SUMMARY_MIN_CHARS } from '@/lib/x';
import { listXAccounts, loadXToken, setXSinceId, xAccountToChannel, type XAccount } from '@/lib/x-store';
import { tokenKeyFromEnv } from '@/lib/x-crypto';
import { extractTickers, generateSummary } from '@/lib/extract';
import { BudgetReachedError } from '@/lib/budget';
import type { NewVideo } from '@/lib/fetch-pipeline';

/** A post whose extraction fails this many times is left alone, as with transcripts. */
const MAX_EXTRACT_ATTEMPTS = 3;
/**
 * Posts analysed at once. A first pull can bring in 200 posts across two
 * accounts, and one at a time that would outlast the run's time budget; a few
 * in parallel gets them through in a couple of minutes.
 */
const CONCURRENCY = 4;

export const TIME_BUDGET_MESSAGE = 'time budget reached — stopping early; run again to continue';

/** What runFetch shares with the X pass, so both use one budget, one deadline and one error list. */
export interface XRunContext {
  db: Client;
  deadline: number;
  disabled: Set<string>;
  errors: string[];
  checkBudget: () => Promise<boolean>;
  noteBudgetReached: (err: BudgetReachedError) => void;
  /** Only these X user ids, e.g. the accounts a save just added. All when omitted. */
  onlyUserIds?: string[];
  tokenKey?: () => Buffer;
  now?: Date;
}

export interface XRunResult {
  timedOut: boolean;
  processed: number;
  tickersFound: number;
  newVideos: NewVideo[];
  skippedChannels: string[];
}

interface PendingPost {
  rowId: number;
  videoId: string;
  title: string;
  transcript: string;
  summary: string | null;
}

async function pendingPosts(db: Client, channelId: string): Promise<PendingPost[]> {
  const rows = (await db.execute({
    sql: `
      SELECT id, video_id, title, transcript, summary FROM videos
      WHERE channel_id = ? AND extracted_at IS NULL
        AND transcript IS NOT NULL AND transcript != ''
        AND transcript_attempts < ?
      ORDER BY published_at ASC, id ASC
    `,
    args: [channelId, MAX_EXTRACT_ATTEMPTS],
  })).rows as unknown as { id: number; video_id: string; title: string; transcript: string; summary: string | null }[];
  return rows.map(r => ({
    rowId: Number(r.id), videoId: String(r.video_id), title: String(r.title),
    transcript: String(r.transcript), summary: r.summary === null ? null : String(r.summary),
  }));
}

async function inPool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

/**
 * Pull and analyse every followed X account. Runs after the CHANNELS loop in
 * runFetch, and on its own right after a save.
 *
 * Each post is its own item: its text is the transcript, extraction runs
 * through the same budget-capped path as everything else, and only posts long
 * enough to need one get a summary. Posts are saved before they're analysed
 * and since_id moves past them straight away, so X is never asked for them
 * again; analysis left over by a timeout or the budget cap is picked up from
 * the database on the next run (extracted_at is still null).
 *
 * No saved token means X hasn't been set up: nothing is recorded, so it never
 * reads as a failing source. A token X rejects is a failed run for every
 * account, which is what fires the failure alert.
 */
export async function runXSources(ctx: XRunContext): Promise<XRunResult> {
  const { db, errors } = ctx;
  const result: XRunResult = { timedOut: false, processed: 0, tickersFound: 0, newVideos: [], skippedChannels: [] };

  let accounts = await listXAccounts(db, { enabledOnly: true });
  if (ctx.onlyUserIds) accounts = accounts.filter(a => ctx.onlyUserIds!.includes(a.userId));
  if (accounts.length === 0) return result;

  // Set once something goes wrong that would go wrong for every account
  // (bad token, no credits, rate limited) so the rest aren't asked.
  let shared: string | null = null;
  let token: string | null;
  try {
    token = await loadXToken(db, ctx.tokenKey ?? tokenKeyFromEnv);
  } catch (err) {
    token = '';
    shared = `the saved X token can't be decrypted (${err instanceof Error ? err.message : err}). ` +
      'Check X_TOKEN_ENCRYPTION_KEY, or send Ray a new setup link.';
  }
  if (token === null) {
    console.log('X: no token saved — skipping X sources');
    return result;
  }

  for (const account of accounts) {
    const channel = xAccountToChannel(account);
    if (ctx.disabled.has(channel.channelId)) {
      result.skippedChannels.push(channel.name);
      continue;
    }
    if (result.timedOut) break;

    const errorStart = errors.length;
    let items = 0;
    const fail = (message: string) => {
      const msg = `${channel.name}: ${message}`;
      errors.push(msg);
      console.error(msg);
    };
    const recordRun = async (success: boolean) => {
      const own = errors.slice(errorStart).filter(e => e.startsWith(channel.name));
      await recordSourceRun(db, {
        channelId: channel.channelId, success, items,
        error: own.length > 0 ? own.join('; ').slice(0, 1000) : null,
      });
    };

    if (shared) {
      fail(`fetch failed — ${shared}`);
      await recordRun(false);
      continue;
    }

    let fresh: Set<number>;
    try {
      fresh = await pullAccount(db, token, account, ctx.now);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof XApiError && err.affectsAllAccounts) shared = message;
      fail(`fetch failed — ${message}`);
      await recordRun(false);
      continue;
    }

    await inPool(await pendingPosts(db, channel.channelId), CONCURRENCY, async post => {
      if (result.timedOut) return;
      if (Date.now() > ctx.deadline) {
        result.timedOut = true;
        return;
      }
      if (!(await ctx.checkBudget())) return;

      try {
        if (post.transcript.length >= SUMMARY_MIN_CHARS && !post.summary) {
          try {
            const previous = await getLatestChannelSummary(db, channel.channelId, post.rowId);
            await updateVideoSummary(db, post.rowId, await generateSummary(post.transcript, previous));
          } catch (err) {
            // A missing summary shouldn't cost the post its tickers.
            if (err instanceof BudgetReachedError) throw err;
            console.error(`${channel.name} / ${post.videoId}: summary failed — ${err instanceof Error ? err.message : err}`);
          }
        }
        const mentions = await extractTickers(post.transcript, post.title, 'X post');
        for (const m of mentions) {
          await saveMention(db, {
            videoRowId: post.rowId, ticker: m.ticker.toUpperCase(), company: m.company ?? null,
            sentiment: m.sentiment, conviction: m.conviction, quote: m.quote ?? null,
          });
        }
        await db.execute({ sql: "UPDATE videos SET extracted_at = datetime('now') WHERE id = ?", args: [post.rowId] });
        items++;
        result.processed++;
        result.tickersFound += mentions.length;
        if (fresh.has(post.rowId)) {
          result.newVideos.push({
            title: post.title,
            channelName: channel.name,
            url: xPostUrl(account.handle, post.videoId.split('-').pop()!),
            tickers: mentions.map(m => m.ticker.toUpperCase()),
          });
        }
      } catch (err) {
        // Left unanalysed; the next run picks it up from the database.
        if (err instanceof BudgetReachedError) return ctx.noteBudgetReached(err);
        await bumpTranscriptAttempts(db, post.rowId);
        fail(`${post.videoId}: analysis failed — ${err instanceof Error ? err.message : err}`);
      }
    });

    await recordRun(true);
  }

  if (result.timedOut && !errors.includes(TIME_BUDGET_MESSAGE)) errors.push(TIME_BUDGET_MESSAGE);
  return result;
}

/**
 * Read an account's new posts from X and store them as items, then move
 * since_id past them. Returns the row ids stored for the first time.
 */
async function pullAccount(db: Client, token: string, account: XAccount, now?: Date): Promise<Set<number>> {
  const { posts, newestId } = await fetchUserPosts(token, account.userId, { sinceId: account.sinceId, now });
  const channelId = xAccountToChannel(account).channelId;
  const fresh = new Set<number>();
  for (const post of posts) {
    const videoId = xItemId(account.handle, post.id);
    const existing = (await db.execute({ sql: 'SELECT id FROM videos WHERE video_id = ?', args: [videoId] })).rows;
    if (existing.length > 0) continue;
    const rowId = await saveVideo(db, { videoId, channelId, title: xPostTitle(post.text), publishedAt: post.createdAt });
    await updateVideoTranscript(db, rowId, post.text, '');
    fresh.add(rowId);
  }
  if (newestId) await setXSinceId(db, account.userId, newestId);
  console.log(`X @${account.handle}: ${posts.length} post(s) read, ${fresh.size} new`);
  return fresh;
}
