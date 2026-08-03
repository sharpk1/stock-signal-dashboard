import { NextResponse } from 'next/server';
import { getDb, getLeaderboard, getMentionDetails, type LeaderboardRow, type MentionDetail } from '@/lib/db';

export interface LeaderboardEntry extends LeaderboardRow {
  details: MentionDetail[];
  normalized_score: number;
  is_convergent: boolean;
  rr_solo: boolean;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const channel = searchParams.get('channel') ?? undefined;
  const days = parseInt(searchParams.get('days') ?? '7') || 7;
  const db = await getDb();
  const rows = await getLeaderboard(db, channel, days);
  const details = await getMentionDetails(db, channel, days);

  const detailsByTicker: Record<string, MentionDetail[]> = {};
  for (const d of details) {
    if (!detailsByTicker[d.ticker]) detailsByTicker[d.ticker] = [];
    detailsByTicker[d.ticker].push(d);
  }

  const entries: LeaderboardEntry[] = rows.map(row => ({
    ...row,
    details: detailsByTicker[row.ticker] ?? [],
    normalized_score: row.weighted_score,
    is_convergent: row.rr_mentions > 0 && row.channel_count >= 2,
    rr_solo: row.rr_mentions > 0 && row.channel_count === 1,
  }));

  return NextResponse.json(entries);
}
