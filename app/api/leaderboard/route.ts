import { NextResponse } from 'next/server';
import { getDb, getLeaderboard, getMentionDetails, type LeaderboardRow, type MentionDetail } from '@/lib/db';
import { getHoldingIndex } from '@/lib/etoro';
import { CHANNELS } from '@/lib/channels';

/** A mention, plus whether the person making it actually owns the thing. */
export interface MentionWithHolding extends MentionDetail {
  /** eToro "Invested" percent of that analyst's portfolio, when on record. */
  holding_pct: number | null;
  /** eToro "Value" percent — the same position at today's prices. */
  holding_value_pct: number | null;
  holding_as_of: string | null;
}

export interface LeaderboardEntry extends LeaderboardRow {
  details: MentionWithHolding[];
  /** The largest position any mentioning analyst holds. */
  max_holding_pct: number | null;
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

  // ALT-61. What someone says and what they own are different signals, and
  // the second is harder to fake. Mentions carry the position size alongside
  // the spoken conviction rather than replacing it.
  const holdings = getHoldingIndex();
  const channelIdByName = new Map(CHANNELS.map((c) => [c.name, c.channelId]));

  const detailsByTicker: Record<string, MentionWithHolding[]> = {};
  for (const d of details) {
    const channelId = channelIdByName.get(d.channel_name);
    const held = channelId ? holdings.get(`${channelId}|${d.ticker.toUpperCase()}`) : undefined;
    if (!detailsByTicker[d.ticker]) detailsByTicker[d.ticker] = [];
    detailsByTicker[d.ticker].push({
      ...d,
      holding_pct: held?.invested_pct ?? null,
      holding_value_pct: held?.value_pct ?? null,
      holding_as_of: held?.as_of ?? null,
    });
  }

  const entries: LeaderboardEntry[] = rows.map(row => {
    const d = detailsByTicker[row.ticker] ?? [];
    const held = d.map((x) => x.holding_pct).filter((x): x is number => x !== null);
    return {
    ...row,
    details: d,
    max_holding_pct: held.length ? Math.max(...held) : null,
    normalized_score: row.weighted_score,
    is_convergent: row.rr_mentions > 0 && row.channel_count >= 2,
    rr_solo: row.rr_mentions > 0 && row.channel_count === 1,
    };
  });

  return NextResponse.json(entries);
}
