import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { itemUrl } from '@/lib/item-url';

export interface TranscriptResponse {
  videoId: string;
  title: string;
  channelName: string;
  publishedAt: string;
  url: string;
  transcript: string;
}

// Fetched on demand rather than with the item list: a three-hour livestream
// transcript runs past 150k characters, and most items are never opened.
export async function GET(request: Request) {
  const videoId = new URL(request.url).searchParams.get('videoId')?.trim();
  if (!videoId) {
    return NextResponse.json({ error: 'videoId is required' }, { status: 400 });
  }

  const db = await getDb();
  const rows = (await db.execute({
    sql: `
      SELECT v.video_id, v.title, v.published_at, v.transcript, v.item_type,
             v.channel_id, c.name AS channel_name
      FROM videos v
      JOIN channels c ON c.channel_id = v.channel_id
      WHERE v.video_id = ?
    `,
    args: [videoId],
  })).rows as unknown as {
    video_id: string; title: string; published_at: string; transcript: string | null;
    item_type: string | null; channel_id: string; channel_name: string;
  }[];

  if (rows.length === 0) {
    return NextResponse.json({ error: `no item found for ${videoId}` }, { status: 404 });
  }

  const row = rows[0];
  if (!row.transcript) {
    return NextResponse.json(
      { error: 'No transcript stored for this item yet.' },
      { status: 404 },
    );
  }

  return NextResponse.json({
    videoId: row.video_id,
    title: row.title,
    channelName: row.channel_name,
    publishedAt: row.published_at,
    url: row.item_type ? '' : itemUrl(row.channel_id, row.video_id),
    transcript: row.transcript,
  } satisfies TranscriptResponse);
}
