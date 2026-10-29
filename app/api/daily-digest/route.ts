import { NextResponse } from 'next/server';
import { getDb, getLeaderboard, getSourceStatuses } from '@/lib/db';
import { sendDailyDigestEmail } from '@/lib/email';
import { itemUrl } from '@/lib/item-url';
import type { DigestContent, DigestItem, DigestTicker, DigestAlert, DigestSourceError } from '@/lib/daily-digest';

export const maxDuration = 60;

/** How far back a "daily" digest looks. A little over a day, so a run that
 *  slips by an hour doesn't drop yesterday's late item. */
const WINDOW_HOURS = 26;
const MAX_TICKERS = 8;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const db = await getDb();

    const itemRows = (await db.execute({
      sql: `
        SELECT v.video_id, v.title, v.summary, v.item_type, v.channel_id, c.name AS channel_name
        FROM videos v
        JOIN channels c ON c.channel_id = v.channel_id
        WHERE rtrim(replace(v.published_at, 'T', ' '), 'Z') >= datetime('now', '-' || ? || ' hours')
        ORDER BY v.published_at DESC
      `,
      args: [WINDOW_HOURS],
    })).rows as unknown as {
      video_id: string; title: string; summary: string | null;
      item_type: string | null; channel_id: string; channel_name: string;
    }[];

    const mentionRows = (await db.execute({
      sql: `
        SELECT tm.ticker, v.video_id
        FROM ticker_mentions tm
        JOIN videos v ON v.id = tm.video_id
        WHERE rtrim(replace(v.published_at, 'T', ' '), 'Z') >= datetime('now', '-' || ? || ' hours')
        ORDER BY tm.conviction DESC
      `,
      args: [WINDOW_HOURS],
    })).rows as unknown as { ticker: string; video_id: string }[];

    const tickersByVideo = new Map<string, string[]>();
    for (const row of mentionRows) {
      const list = tickersByVideo.get(row.video_id) ?? [];
      if (!list.includes(row.ticker)) list.push(row.ticker);
      tickersByVideo.set(row.video_id, list);
    }

    const items: DigestItem[] = itemRows.map(row => ({
      title: row.title,
      channelName: row.channel_name,
      summary: row.summary,
      tickers: tickersByVideo.get(row.video_id) ?? [],
      url: row.item_type ? '' : itemUrl(row.channel_id, row.video_id),
    }));

    const topTickers: DigestTicker[] = (await getLeaderboard(db, undefined, 1))
      .slice(0, MAX_TICKERS)
      .map(row => ({
        ticker: row.ticker,
        company: row.company,
        channelCount: row.channel_count,
        weightedScore: row.weighted_score,
        channels: row.channels,
      }));

    const alerts = (await db.execute({
      sql: `SELECT ticker, channels FROM convergence_alerts
            WHERE alerted_at >= datetime('now', '-' || ? || ' hours')
            ORDER BY alerted_at DESC`,
      args: [WINDOW_HOURS],
    })).rows as unknown as DigestAlert[];

    const sourceErrors: DigestSourceError[] = (await getSourceStatuses(db))
      .filter(source => source.lastRunOk === false && source.lastError)
      .map(source => ({ name: source.name, error: source.lastError! }));

    const content: DigestContent = {
      date: new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
      items,
      topTickers,
      alerts: alerts.map(a => ({ ticker: a.ticker, channels: a.channels })),
      sourceErrors,
    };

    const sent = await sendDailyDigestEmail(content);
    return NextResponse.json({
      ok: true, sent,
      counts: { items: items.length, tickers: topTickers.length, alerts: alerts.length, sourceErrors: sourceErrors.length },
    });
  } catch (err) {
    console.error('daily digest failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
