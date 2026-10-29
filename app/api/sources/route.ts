import { NextResponse } from 'next/server';
import { getDb, getSourceStatuses } from '@/lib/db';

export type { SourceStatus } from '@/lib/db';

// GET — per-source run status: last successful pull and last error.
export async function GET() {
  const db = await getDb();
  return NextResponse.json(await getSourceStatuses(db));
}
