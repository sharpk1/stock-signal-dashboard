import { NextResponse } from 'next/server';
import { getDb, toggleVideoPin } from '@/lib/db';

export async function PATCH(request: Request) {
  const body = await request.json() as { videoId?: string };
  const videoId = body.videoId?.trim();
  if (!videoId) {
    return NextResponse.json({ error: 'videoId is required' }, { status: 400 });
  }
  const db = getDb();
  try {
    const pinned = toggleVideoPin(db, videoId);
    return NextResponse.json({ pinned });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 404 });
  }
}
