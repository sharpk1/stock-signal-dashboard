import { NextResponse } from 'next/server';
import { getDb, saveChannel, savePastedItem, updateVideoTranscript, saveMention,
         getLatestChannelSummary } from '@/lib/db';
import { CHANNELS } from '@/lib/channels';
import { extractTickers, generateSummary } from '@/lib/extract';
import { parsePaste, pasteItemId, PASTE_TYPE_LABELS, type PasteType } from '@/lib/paste';
import { BudgetReachedError } from '@/lib/budget';

// Summarising a member livestream means several Claude calls, so give it the
// same headroom as the cron route rather than the default.
export const maxDuration = 300;

/** Meet Kevin's private content is what this box exists for. */
const PASTE_CHANNEL_HANDLE = '@MeetKevin';

export interface PasteResponse {
  ok: true;
  duplicate: boolean;
  itemId: string;
  title: string;
  tickers: string[];
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parsePaste(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { type, date, text, title } = parsed.value;

  const channel = CHANNELS.find(c => c.handle === PASTE_CHANNEL_HANDLE);
  if (!channel) {
    return NextResponse.json({ error: `${PASTE_CHANNEL_HANDLE} is not a configured channel` }, { status: 500 });
  }

  const db = await getDb();
  await saveChannel(db, channel);

  const itemId = pasteItemId(text);
  const { videoRowId, isNew } = await savePastedItem(db, {
    itemId,
    channelId: channel.channelId,
    title,
    publishedAt: date,
    itemType: type,
  });

  // Already here *and* already analysed — say so rather than paying to do it
  // twice. An earlier paste whose analysis failed has no mentions, so it falls
  // through and gets another go instead of being stuck behind this guard.
  const existingMentions = (await db.execute({
    sql: 'SELECT ticker FROM ticker_mentions WHERE video_id = ? ORDER BY conviction DESC',
    args: [videoRowId],
  })).rows as unknown as { ticker: string }[];

  if (!isNew && existingMentions.length > 0) {
    return NextResponse.json({
      ok: true, duplicate: true, itemId, title,
      tickers: existingMentions.map(r => r.ticker),
    } satisfies PasteResponse);
  }

  const label = PASTE_TYPE_LABELS[type as PasteType];
  try {
    const previousSummary = await getLatestChannelSummary(db, channel.channelId, videoRowId);
    const summary = await generateSummary(text, previousSummary);
    await updateVideoTranscript(db, videoRowId, text, summary);
  } catch (err) {
    // Keep the text: a failed summary is worth retrying, and losing a paste
    // Ray can't easily re-copy would be worse.
    await updateVideoTranscript(db, videoRowId, text, '');
    console.error(`[paste] summary failed for ${itemId}:`, err instanceof Error ? err.message : err);
  }

  let tickers: string[] = [];
  try {
    const mentions = await extractTickers(text, title, label);
    for (const mention of mentions) {
      await saveMention(db, {
        videoRowId,
        ticker: mention.ticker.toUpperCase(),
        company: mention.company ?? null,
        sentiment: mention.sentiment,
        conviction: mention.conviction,
        quote: mention.quote ?? null,
      });
    }
    tickers = mentions.map(m => m.ticker.toUpperCase());
  } catch (err) {
    console.error(`[paste] extraction failed for ${itemId}:`, err instanceof Error ? err.message : err);
    if (err instanceof BudgetReachedError) {
      // The text is saved either way; once the budget allows, pasting it again
      // runs the analysis.
      return NextResponse.json(
        { error: `Saved the text, but it was not analysed. ${err.message} Paste it again then to analyse it.` },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: 'Saved the text, but the AI analysis failed. Paste it again to retry — it will not be charged twice.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, duplicate: false, itemId, title, tickers } satisfies PasteResponse);
}
