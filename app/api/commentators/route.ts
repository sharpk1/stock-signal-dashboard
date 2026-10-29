import { NextResponse } from 'next/server';
import { getDb, getCommentatorCounts, getDisabledChannelIds } from '@/lib/db';
import { CHANNELS } from '@/lib/channels';
import { buildCommentators } from '@/lib/commentators';

export type { Commentator } from '@/lib/commentators';

// GET ?days=N — one card per configured channel for the Signals tab: items in
// the window, top three tickers, on/off state and avatar. CHANNELS decides
// which channels exist, as in /api/channels.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // Same default as /api/leaderboard; clamped so a bad value still means a sane window.
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '7') || 7, 1), 365);
  const db = await getDb();
  const [counts, disabled] = await Promise.all([
    getCommentatorCounts(db, days),
    getDisabledChannelIds(db),
  ]);
  return NextResponse.json(
    buildCommentators(CHANNELS, counts.pieces, counts.tickers, disabled, counts.avatars),
  );
}
