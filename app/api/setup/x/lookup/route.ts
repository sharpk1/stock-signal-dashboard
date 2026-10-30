import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { checkSetupKey } from '@/lib/setup-links';
import { lookupUser, normalizeHandle, setupErrorMessage, XApiError } from '@/lib/x';

// POST { key, token, handle } — the Look up button on /setup/x. Resolves one
// @handle with Ray's token and returns the name and picture to show. Nothing
// is stored until Save.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { key?: string; token?: string; handle?: string };
  const link = await checkSetupKey(await getDb(), body.key);
  if (!link.ok) return NextResponse.json({ error: link.message }, { status: 403 });

  const token = body.token?.trim();
  if (!token) return NextResponse.json({ error: 'Paste and test the token first.' }, { status: 400 });
  const handle = normalizeHandle(body.handle ?? '');
  if (!handle) return NextResponse.json({ error: 'That doesn’t look like an X handle.' }, { status: 400 });

  try {
    const user = await lookupUser(token, handle);
    return NextResponse.json({ user });
  } catch (err) {
    const message = err instanceof XApiError && err.kind === 'not_found'
      ? `No X account found for @${handle}.`
      : setupErrorMessage(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
