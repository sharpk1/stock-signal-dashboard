import { NextResponse } from 'next/server';
import { runFetch } from '@/lib/fetch-pipeline';
import { getDb, getLastRunAt } from '@/lib/db';
import { cooldownMinutesLeft } from '@/lib/fetch-cooldown';

export const maxDuration = 300;

// The Fetch Latest button. No CRON_SECRET check: the browser can't hold a
// secret, so the cooldown is what keeps this from being hammered. The scheduled
// run goes through /api/cron, which does check the secret.
export async function POST() {
  try {
    const wait = cooldownMinutesLeft(await getLastRunAt(await getDb()));
    if (wait > 0) {
      return NextResponse.json(
        { error: `A fetch ran in the last few minutes. Try again in ${wait} min.` },
        { status: 429 },
      );
    }
    const result = await runFetch();
    return NextResponse.json(result);
  } catch (err) {
    console.error('fetch route failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? `${err.message}` : String(err) },
      { status: 500 }
    );
  }
}
