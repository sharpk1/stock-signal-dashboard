import { CHANNELS, Channel } from '@/lib/channels';
import { getDb, saveChannel, saveVideo, saveMention, updateVideoTranscript, getLeaderboard, saveConvergenceAlert, bumpTranscriptAttempts, getDisabledChannelIds, recordSourceRun, getLatestChannelSummary } from '@/lib/db';
import { fetchRecentVideos, fetchRecentVideosWithSource, fetchTranscript, type VideoSource } from '@/lib/youtube';
import { fetchSubstackPosts, extractSubstackContent, SubstackPost,
         cookieAgeWarning, emptyHarvestWarning, describeUnusablePost } from '@/lib/substack';
import { extractTickers, generateSummary } from '@/lib/extract';
import { resetUsage, getUsage, type RunUsage } from '@/lib/usage';
import { getBudgetStatus } from '@/lib/claude';
import { BudgetReachedError, type BudgetStatus } from '@/lib/budget';
import { refreshAvatars } from '@/lib/avatars';

const MAX_TRANSCRIPT_ATTEMPTS = 3; // give up on a video after this many failed runs
const TIME_BUDGET_MS = 240_000;    // stop gracefully before Vercel's 300s hard limit

// Caption lag: YouTube publishes a finished livestream to the feed well before
// its captions are ready — often hours later. Three attempts is right for a
// normal upload, but it would burn through in a single morning and abandon a
// stream permanently, just before the captions landed. So while a stream is
// still fresh enough that captions are plausibly coming, keep retrying.
const CAPTION_LAG_WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_STREAM_TRANSCRIPT_ATTEMPTS = 12;

export function maxTranscriptAttempts(
  channel: Channel,
  publishedAt: string,
  now: number = Date.now(),
): number {
  if (channel.feed !== 'streams') return MAX_TRANSCRIPT_ATTEMPTS;
  const published = new Date(publishedAt).getTime();
  if (!Number.isFinite(published)) return MAX_TRANSCRIPT_ATTEMPTS;
  return now - published <= CAPTION_LAG_WINDOW_MS
    ? MAX_STREAM_TRANSCRIPT_ATTEMPTS
    : MAX_TRANSCRIPT_ATTEMPTS;
}

export interface NewVideo {
  title: string;
  channelName: string;
  url: string;
  tickers: string[];
}

export interface FetchResult {
  success: true;
  timedOut: boolean;
  videosProcessed: number;
  tickersFound: number;
  errors: string[];
  newAlerts: string[];
  newVideos: NewVideo[];
  skippedChannels: string[];
  /**
   * Which listing each YouTube pull came from, by channel name. The RSS feed is
   * the primary and the Data API the fallback, so a run showing `api` is a run
   * that only worked because the feed was down — worth seeing in the summary.
   */
  fetchSources: Record<string, VideoSource>;
  usage: RunUsage;
  /** True once the monthly AI cap stopped summaries and extraction this run. */
  budgetReached: boolean;
  /** This month's spend against the cap, as of the end of the run. */
  budget: BudgetStatus;
}

function videoUrl(channel: Channel, videoId: string): string {
  if (channel.source === 'substack') {
    return `https://${channel.substackHandle}.substack.com/p/${videoId}`;
  }
  return `https://youtube.com/watch?v=${videoId}`;
}

export async function runFetch(): Promise<FetchResult> {
  const db = await getDb();
  const errors: string[] = [];
  let videosProcessed = 0;
  let tickersFound = 0;
  const newVideos: NewVideo[] = [];
  const deadline = Date.now() + TIME_BUDGET_MS;
  let timedOut = false;
  const disabled = await getDisabledChannelIds(db);
  const skippedChannels: string[] = [];
  const fetchSources: Record<string, VideoSource> = {};
  resetUsage();

  // Once the month's AI cap is reached, items are still fetched and saved but
  // not analysed. They stay unprocessed (no mentions), so the first run after
  // the cap lifts picks them up. Reported once per run, not once per item, and
  // without a channel-name prefix so it never reads as a source failing.
  let budgetReached = false;
  const noteBudgetReached = (err: BudgetReachedError) => {
    if (budgetReached) return;
    budgetReached = true;
    errors.push(err.message);
    console.warn(err.message);
  };
  const checkBudget = async (): Promise<boolean> => {
    if (budgetReached) return false;
    const status = await getBudgetStatus();
    if (status.reached) noteBudgetReached(new BudgetReachedError(status.spentUsd, status.capUsd));
    return !budgetReached;
  };

  for (const channel of CHANNELS) {
    if (timedOut) break;
    // Keep the row current either way, so a switched-off channel still shows
    // up in the UI with its toggle intact.
    await saveChannel(db, channel);

    if (disabled.has(channel.channelId)) {
      skippedChannels.push(channel.name);
      console.log(`${channel.name}: switched off — skipping`);
      continue;
    }

    // Log one row per source per run for the status page. Every message this
    // channel adds to `errors` is prefixed with its name, so slicing from here
    // and matching that prefix picks out exactly its own problems — the shared
    // time-budget notice stays out of it.
    const errorStart = errors.length;
    let channelItems = 0;
    const recordRun = async (success: boolean) => {
      const own = errors.slice(errorStart).filter(e => e.startsWith(channel.name));
      await recordSourceRun(db, {
        channelId: channel.channelId,
        success,
        items: channelItems,
        error: own.length > 0 ? own.join('; ').slice(0, 1000) : null,
      });
    };

    const warn = (warning: string | null) => {
      if (!warning) return;
      const msg = `${channel.name}: ${warning}`;
      errors.push(msg);
      console.warn(msg);
    };

    // How old the cookie is is a calendar question, not a network one — check it
    // before the pull, so an ageing session is still reported on a run where
    // the pull itself fails.
    if (channel.source === 'substack') warn(cookieAgeWarning());

    let videos: Array<SubstackPost | Awaited<ReturnType<typeof fetchRecentVideos>>[number]>;
    try {
      if (channel.source === 'substack') {
        videos = await fetchSubstackPosts(channel.substackHandle!);
        // The pull worked; check whether it actually brought anything back.
        warn(emptyHarvestWarning(videos as SubstackPost[]));
      } else {
        const pulled = await fetchRecentVideosWithSource(channel);
        fetchSources[channel.name] = pulled.via;
        videos = pulled.videos;
      }
    } catch (err) {
      const msg = `${channel.name}: fetch failed — ${err instanceof Error ? err.message : err}`;
      errors.push(msg);
      console.error(msg);
      await recordRun(false);
      continue;
    }

    if (videos.length === 0) {
      console.log(`${channel.name}: no new videos in window`);
      // The pull itself worked; there was simply nothing new.
      await recordRun(true);
      continue;
    }

    for (const video of videos) {
      if (Date.now() > deadline) {
        timedOut = true;
        errors.push('time budget reached — stopping early; run again to continue');
        console.log('Time budget reached, stopping early.');
        break;
      }

      const videoRowId = await saveVideo(db, {
        videoId: video.videoId,
        channelId: channel.channelId,
        title: video.title,
        publishedAt: video.publishedAt,
      });

      // Check processing state
      const existing = (await db.execute({
        sql: `
        SELECT v.transcript, v.transcript_attempts,
               (SELECT COUNT(*) FROM ticker_mentions WHERE video_id = v.id) AS mention_count
        FROM videos v WHERE v.id = ?
      `,
        args: [videoRowId],
      })).rows[0] as unknown as { transcript: string | null; transcript_attempts: number; mention_count: number };

      if (existing.transcript && existing.mention_count > 0) {
        // fully processed — skip
        console.log(`Skipped (already processed): ${video.title}`);
        continue;
      }

      const attemptCap = maxTranscriptAttempts(channel, video.publishedAt);
      if (!existing.transcript && existing.transcript_attempts >= attemptCap) {
        // repeatedly couldn't get a transcript (likely no captions) — stop retrying
        console.log(`Skipped (no transcript after ${existing.transcript_attempts} attempts): ${video.title}`);
        continue;
      }

      // Fresh content = first time we've pulled a transcript for this video.
      // This is what gets reported as "new" (reprocessed videos don't count).
      const isFreshContent = !existing.transcript;

      let transcript: string = '';
      if (existing.transcript) {
        // transcript stored but extraction previously failed — reuse stored transcript
        transcript = existing.transcript;
      } else {
        // fresh content — fetch transcript or use article text
        try {
          if (channel.source === 'substack') {
            const post = video as SubstackPost;
            const { youtubeVideoId, articleText } = extractSubstackContent(post.bodyHtml);
            if (youtubeVideoId) {
              try {
                transcript = await fetchTranscript(youtubeVideoId);
              } catch {
                if (!articleText) {
                  const msg = `${channel.name} / ${video.videoId}: no transcript and no article text — skipping`;
                  errors.push(msg);
                  console.error(msg);
                  continue;
                }
                console.warn(`${channel.name} / ${video.videoId}: YouTube transcript failed, falling back to article text`);
                transcript = articleText;
              }
            } else {
              const unusable = describeUnusablePost(post.bodyHtml);
              if (unusable) {
                const msg = `${channel.name} / ${video.videoId}: ${unusable} — skipping`;
                errors.push(msg);
                console.error(msg);
                continue;
              }
              transcript = articleText;
            }
          } else {
            transcript = await fetchTranscript(video.videoId);
          }
        } catch (err) {
          await bumpTranscriptAttempts(db, videoRowId);
          const msg = `${channel.name} / ${video.videoId}: transcript unavailable — ${err instanceof Error ? err.message : err}`;
          errors.push(msg);
          console.error(msg);
          continue;
        }

        let summary = '';
        if (await checkBudget()) {
          try {
            // What this person said last time, so the summary can say what moved.
            const previousSummary = await getLatestChannelSummary(db, channel.channelId, videoRowId);
            summary = await generateSummary(transcript, previousSummary);
          } catch (err) {
            if (err instanceof BudgetReachedError) noteBudgetReached(err);
            else console.error(`${channel.name} / ${video.title}: summary generation failed — ${err instanceof Error ? err.message : err}`);
          }
        }

        await updateVideoTranscript(db, videoRowId, transcript, summary);
      }

      // Transcript is saved by now; with the cap reached, leave the analysis for later.
      if (!(await checkBudget())) continue;

      let mentions;
      try {
        mentions = await extractTickers(transcript, video.title);
      } catch (err) {
        if (err instanceof BudgetReachedError) {
          noteBudgetReached(err);
          continue;
        }
        const msg = `${channel.name} / ${video.title}: Claude extraction failed — ${err instanceof Error ? err.message : err}`;
        errors.push(msg);
        console.error(msg);
        continue;
      }

      for (const mention of mentions) {
        await saveMention(db, {
          videoRowId,
          ticker: mention.ticker.toUpperCase(),
          company: mention.company ?? null,
          sentiment: mention.sentiment,
          conviction: mention.conviction,
          quote: mention.quote ?? null,
        });
        tickersFound++;
      }

      videosProcessed++;
      channelItems++;
      if (isFreshContent) {
        newVideos.push({
          title: video.title,
          channelName: channel.name,
          url: videoUrl(channel, video.videoId),
          tickers: mentions.map(m => m.ticker.toUpperCase()),
        });
      }
      console.log(`Processed: ${video.title} — ${mentions.length} tickers`);
    }

    await recordRun(true);
  }

  // Profile pictures for the Commentators cards. Weekly per channel, switched-off
  // ones included (they still get a card), and it swallows its own failures.
  // Skipped on a timed-out run so the time left goes to items.
  if (!timedOut) await refreshAvatars(db, CHANNELS);

  // Detect new convergences and save alerts
  const newAlerts: string[] = [];
  const leaderboard = await getLeaderboard(db, undefined, 30);
  for (const row of leaderboard) {
    if (row.rr_mentions > 0 && row.channel_count >= 2) {
      const channels = row.channels;
      const quotes = (await db.execute({
        sql: `
        SELECT tm.quote, c.name AS channel_name
        FROM ticker_mentions tm
        JOIN videos v ON tm.video_id = v.id
        JOIN channels c ON v.channel_id = c.channel_id
        WHERE tm.ticker = ? AND tm.quote IS NOT NULL
        ORDER BY c.weight DESC
        LIMIT 4
      `,
        args: [row.ticker],
      })).rows as unknown as { quote: string; channel_name: string }[];
      const quotesJson = JSON.stringify(quotes);
      const isNew = await saveConvergenceAlert(db, row.ticker, channels, quotesJson);
      if (isNew) newAlerts.push(row.ticker);
    }
  }

  const usage = getUsage();
  console.log(
    `Run used ${usage.calls} Claude call(s): ${usage.inputTokens} in / ${usage.outputTokens} out, ` +
    `about $${usage.estimatedCostUsd.toFixed(4)}${usage.partialCost ? '+ (some models unpriced)' : ''}`,
  );

  const budget = await getBudgetStatus();
  return {
    success: true, timedOut, videosProcessed, tickersFound, errors, newAlerts, newVideos,
    skippedChannels, fetchSources, usage, budgetReached, budget,
  };
}
