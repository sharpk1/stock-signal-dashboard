import { NextResponse } from 'next/server';
import { runFetch } from '@/lib/fetch-pipeline';
import { sendNewVideosEmail } from '@/lib/email';

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

    let emailed = false;
    if (result.newVideos.length > 0 && process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL) {
      try {
        await sendNewVideosEmail(result.newVideos);
        emailed = true;
      } catch (err) {
        console.error('email send failed:', err);
        result.errors.push(`email send failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    return NextResponse.json({ ...result, emailed });
  } catch (err) {
    console.error('cron failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
