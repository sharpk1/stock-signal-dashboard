import { NextResponse } from 'next/server';
import { getDb, getLeaderboard, getMentionDetails, type LeaderboardRow, type MentionDetail } from '@/lib/db';

export interface LeaderboardEntry extends LeaderboardRow {
  details: MentionDetail[];
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
  }));

  return NextResponse.json(entries);
}
