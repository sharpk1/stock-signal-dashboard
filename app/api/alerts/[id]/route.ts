import { NextResponse } from 'next/server';
import { getDb, markAlertRead } from '@/lib/db';

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id);
  if (isNaN(numId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const db = getDb();
  markAlertRead(db, numId);
  return NextResponse.json({ ok: true });
}
