import { NextResponse } from 'next/server';
import { runFetch } from '@/lib/fetch-pipeline';
import { sendAlertEmail } from '@/lib/email';
import { getDb, getSourceAlertStates, getBudgetAlertsSent, markBudgetAlertsSent } from '@/lib/db';
import { decideAlerts } from '@/lib/alerts';
import { decideBudgetAlert, levelsCovered } from '@/lib/budget';

export const maxDuration = 300;

// Triggered by Vercel Cron (GET). Vercel sends `Authorization: Bearer $CRON_SECRET`
// automatically when CRON_SECRET is configured.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await runFetch();

    // No per-run email here: this runs every three hours, and eight digests a
    // day is not a daily summary. /api/daily-digest sends one, once a day.

    // Tell someone when a source breaks or the AI credit runs out — this runs
    // unattended, so nobody sees the response above.
    let alerted = false;
    try {
      const db = await getDb();
      // The 80% and 100% budget emails go out once a month each. Spend from
      // chat between runs is in ai_spend too, so this catches it on the next run.
      const { month, spentUsd, capUsd } = result.budget;
      const budgetAlert = decideBudgetAlert(month, spentUsd, capUsd, await getBudgetAlertsSent(db, month));
      const decision = decideAlerts(await getSourceAlertStates(db), result.errors, budgetAlert);
      alerted = await sendAlertEmail(decision);
      // Only once it has actually gone: unconfigured email shouldn't use up
      // the month's one alert.
      if (alerted && budgetAlert) await markBudgetAlertsSent(db, month, levelsCovered(budgetAlert));
    } catch (err) {
      console.error('alert send failed:', err);
      result.errors.push(`alert send failed: ${err instanceof Error ? err.message : err}`);
    }

    return NextResponse.json({ ...result, alerted });
  } catch (err) {
    console.error('cron failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
