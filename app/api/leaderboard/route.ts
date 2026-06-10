import { NextResponse } from 'next/server';
import { getDb, getLeaderboard, getMentionDetails, type LeaderboardRow, type MentionDetail } from '@/lib/db';

export interface LeaderboardEntry extends LeaderboardRow {
  details: MentionDetail[];
}

export async function GET() {
  const db = getDb();
  const rows = getLeaderboard(db);
  const details = getMentionDetails(db);

  const detailsByTicker: Record<string, MentionDetail[]> = {};
  for (const d of details) {
    if (!detailsByTicker[d.ticker]) detailsByTicker[d.ticker] = [];
    detailsByTicker[d.ticker].push(d);
  }

  const entries: LeaderboardEntry[] = rows.map(row => ({
    ...row,
    details: detailsByTicker[row.ticker] ?? [],
  }));

  return NextResponse.json(entries);
}
