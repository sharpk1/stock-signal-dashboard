import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export interface VideoUrl {
  video_id: string;
  title: string;
  channel_name: string;
  published_at: string;
  url: string;
}

export interface ChannelVideo {
  video_id: string;
  title: string;
  channel_name: string;
  channel_id: string;
  published_at: string;
  pinned: number;
  summary: string | null;
  url: string;
  mentions: { ticker: string; sentiment: string; conviction: number }[];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') ?? '0') || 0;
  const channelId = searchParams.get('channelId') ?? undefined;
  const db = getDb();

  const conditions: string[] = [];
  if (days > 0) conditions.push(`(rtrim(replace(v.published_at, 'T', ' '), 'Z') >= datetime('now', '-${days} days') OR v.pinned = 1)`);
  if (channelId) conditions.push(`v.channel_id = '${channelId.replace(/'/g, "''")}'`);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT v.video_id, v.title, v.published_at, v.pinned, v.summary, c.name AS channel_name, c.channel_id
    FROM videos v
    JOIN channels c ON v.channel_id = c.channel_id
    ${whereClause}
    ORDER BY v.pinned DESC, v.published_at DESC
  `).all() as { video_id: string; title: string; published_at: string; pinned: number; summary: string | null; channel_name: string; channel_id: string }[];

  if (channelId) {
    const mentionRows = db.prepare(`
      SELECT tm.ticker, tm.sentiment, tm.conviction, v.video_id
      FROM ticker_mentions tm
      JOIN videos v ON tm.video_id = v.id
      WHERE v.channel_id = ?
      ORDER BY tm.conviction DESC
    `).all(channelId) as { ticker: string; sentiment: string; conviction: number; video_id: string }[];

    const mentionsByVideo: Record<string, { ticker: string; sentiment: string; conviction: number }[]> = {};
    for (const m of mentionRows) {
      if (!mentionsByVideo[m.video_id]) mentionsByVideo[m.video_id] = [];
      mentionsByVideo[m.video_id].push({ ticker: m.ticker, sentiment: m.sentiment, conviction: m.conviction });
    }

    const videos: ChannelVideo[] = rows.map(r => ({
      ...r,
      url: `https://youtube.com/watch?v=${r.video_id}`,
      mentions: mentionsByVideo[r.video_id] ?? [],
    }));
    return NextResponse.json(videos);
  }

  const videos: VideoUrl[] = rows.map(r => ({
    video_id: r.video_id,
    title: r.title,
    channel_name: r.channel_name,
    published_at: r.published_at,
    url: `https://youtube.com/watch?v=${r.video_id}`,
  }));

  return NextResponse.json(videos);
}
