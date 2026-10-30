import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkSetupKey } from '@/lib/setup-links';
import { testToken, setupErrorMessage } from '@/lib/x';

// POST { key, token } — the Test button on /setup/x. Asks X to look up a
// known account with the token; nothing is stored. The token is never logged
// or echoed back.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { key?: string; token?: string };
  const link = await checkSetupKey(await getDb(), body.key);
  if (!link.ok) return NextResponse.json({ error: link.message }, { status: 403 });

  const token = body.token?.trim();
  if (!token) return NextResponse.json({ error: 'Paste the Bearer Token first.' }, { status: 400 });

  try {
    await testToken(token);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: setupErrorMessage(err) }, { status: 400 });
  }
}
