import { NextResponse } from 'next/server';
import { getDb, getLeaderboard, getMentionDetails, type LeaderboardRow, type MentionDetail } from '@/lib/db';
import { CHANNELS } from '@/lib/channels';

const MAX_SCORE = CHANNELS.reduce((sum, c) => sum + c.weight, 0);

export interface LeaderboardEntry extends LeaderboardRow {
  details: MentionDetail[];
  normalized_score: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const channel = searchParams.get('channel') ?? undefined;
  const db = getDb();
  const rows = getLeaderboard(db, channel);
  const details = getMentionDetails(db, channel);

  const detailsByTicker: Record<string, MentionDetail[]> = {};
  for (const d of details) {
    if (!detailsByTicker[d.ticker]) detailsByTicker[d.ticker] = [];
    detailsByTicker[d.ticker].push(d);
  }

  const entries: LeaderboardEntry[] = rows.map(row => ({
    ...row,
    details: detailsByTicker[row.ticker] ?? [],
    normalized_score: Math.min(100, Math.round((row.weighted_score / MAX_SCORE) * 100)),
  }));

  return NextResponse.json(entries);
}
