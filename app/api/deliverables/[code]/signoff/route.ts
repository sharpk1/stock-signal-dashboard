import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { setSignOff, SignOffError } from '@/lib/deliverables';

// POST { name, signed } — sign off (or undo a sign-off) on one deliverable.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const body = await request.json().catch(() => ({})) as { name?: string; signed?: boolean };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const db = await getDb();
  try {
    await setSignOff(db, code.toUpperCase(), name.slice(0, 80), body.signed !== false);
  } catch (err) {
    if (err instanceof SignOffError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
  return NextResponse.json({ ok: true });
}
