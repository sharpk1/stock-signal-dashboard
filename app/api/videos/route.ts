import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export interface VideoUrl {
  video_id: string;
  title: string;
  channel_name: string;
  published_at: string;
  url: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') ?? '0') || 0;
  const db = getDb();
  const whereClause = days > 0
    ? `WHERE rtrim(replace(v.published_at, 'T', ' '), 'Z') >= datetime('now', '-${days} days')`
    : '';
  const rows = db.prepare(`
    SELECT v.video_id, v.title, v.published_at, c.name AS channel_name
    FROM videos v
    JOIN channels c ON v.channel_id = c.channel_id
    ${whereClause}
    ORDER BY v.published_at DESC
  `).all() as { video_id: string; title: string; published_at: string; channel_name: string }[];

  const videos: VideoUrl[] = rows.map(r => ({
    ...r,
    url: `https://youtube.com/watch?v=${r.video_id}`,
  }));

  return NextResponse.json(videos);
}
