import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listDeliverables } from '@/lib/deliverables';

export async function GET(request: Request) {
  const phase = new URL(request.url).searchParams.get('phase') ?? 'Phase 1';
  const db = await getDb();
  return NextResponse.json(await listDeliverables(db, phase));
}
