import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { itemUrl } from '@/lib/item-url';

export interface DigestVideo {
  video_id: string;
  title: string;
  channel_name: string;
  channel_id: string;
  published_at: string;
  summary: string | null;
  /** Substack posts: 'video' or 'article'; null otherwise. */
  media: string | null;
  url: string;
  mentions: { ticker: string; sentiment: string; conviction: number }[];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') ?? '7') || 7;
  const db = await getDb();

  const rows = (await db.execute({
    sql: `
      SELECT v.video_id, v.title, v.published_at, v.summary, v.media, c.name AS channel_name, c.channel_id
      FROM videos v
      JOIN channels c ON v.channel_id = c.channel_id
      WHERE (rtrim(replace(v.published_at, 'T', ' '), 'Z') >= datetime('now', '-' || ? || ' days') OR v.pinned = 1)
      ORDER BY v.published_at DESC
    `,
    args: [days],
  })).rows as unknown as Omit<DigestVideo, 'url' | 'mentions'>[];

  const mentionRows = (await db.execute(`
    SELECT tm.ticker, tm.sentiment, tm.conviction, v.video_id
    FROM ticker_mentions tm
    JOIN videos v ON tm.video_id = v.id
    ORDER BY tm.conviction DESC
  `)).rows as unknown as { ticker: string; sentiment: string; conviction: number; video_id: string }[];

  const byVideo: Record<string, { ticker: string; sentiment: string; conviction: number }[]> = {};
  for (const m of mentionRows) {
    (byVideo[m.video_id] ??= []).push({ ticker: m.ticker, sentiment: m.sentiment, conviction: m.conviction });
  }

  const videos: DigestVideo[] = rows.map(r => ({
    ...r,
    url: itemUrl(r.channel_id, r.video_id),
    mentions: byVideo[r.video_id] ?? [],
  }));

  return NextResponse.json(videos);
}
