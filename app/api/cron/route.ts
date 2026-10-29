import { NextResponse } from 'next/server';
import { runFetch } from '@/lib/fetch-pipeline';
import { sendAlertEmail } from '@/lib/email';
import { getDb, getSourceAlertStates } from '@/lib/db';
import { decideAlerts } from '@/lib/alerts';

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
      const decision = decideAlerts(await getSourceAlertStates(db), result.errors);
      alerted = await sendAlertEmail(decision);
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
