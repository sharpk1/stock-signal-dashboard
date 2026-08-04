import { NextResponse } from 'next/server';
import { runFetch } from '@/lib/fetch-pipeline';

export const maxDuration = 300;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const headerSecret = request.headers.get('x-cron-secret');
    const bearer = request.headers.get('authorization') === `Bearer ${secret}`;
    if (headerSecret !== secret && !bearer) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  try {
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
