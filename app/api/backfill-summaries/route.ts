import { NextResponse } from 'next/server';
import { getDb, getVideosMissingSummary, getLatestChannelSummary, updateVideoSummary } from '@/lib/db';
import { generateSummary } from '@/lib/extract';
import { resetUsage, getUsage } from '@/lib/usage';
import { getBudgetStatus } from '@/lib/claude';
import { BudgetReachedError } from '@/lib/budget';

export const maxDuration = 300;

/** Stop starting new summaries after this, so the route finishes inside maxDuration. */
const TIME_BUDGET_MS = 240_000;
const MAX_DAYS = 30;

// One-off repair for items saved while summaries came back empty (Sonnet 5.5's
// leading thinking block). The fetch skips those as already processed, so this
// fills in only the summary. Triggered by the backfill-summaries workflow, which
// sends CRON_SECRET — unlike /api/cron, it refuses to run with no secret set.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const requested = Number(new URL(request.url).searchParams.get('days') ?? 2);
  const days = Math.min(Math.max(Number.isFinite(requested) ? Math.floor(requested) : 2, 1), MAX_DAYS);

  const started = Date.now();
  const db = await getDb();
  const pending = await getVideosMissingSummary(db, days);
  resetUsage();

  let filled = 0;
  const failed: string[] = [];
  // Set when the monthly AI cap stops the run; what's left is in `remaining`.
  let budgetError: string | null = null;
  for (const video of pending) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    const budget = await getBudgetStatus();
    if (budget.reached) {
      budgetError = new BudgetReachedError(budget.spentUsd, budget.capUsd).message;
      break;
    }
    try {
      const previous = await getLatestChannelSummary(db, video.channelId, video.id);
      await updateVideoSummary(db, video.id, await generateSummary(video.transcript, previous));
      filled++;
      console.log(`Backfilled summary: ${video.title}`);
    } catch (err) {
      if (err instanceof BudgetReachedError) {
        budgetError = err.message;
        break;
      }
      const msg = `${video.title}: ${err instanceof Error ? err.message : err}`;
      failed.push(msg);
      console.error(`Backfill failed — ${msg}`);
    }
  }

  const usage = getUsage();
  return NextResponse.json({
    days,
    found: pending.length,
    filled,
    failed,
    remaining: pending.length - filled - failed.length,
    estimatedCostUsd: usage.estimatedCostUsd,
    budgetReached: budgetError !== null,
    budgetError,
  });
}
