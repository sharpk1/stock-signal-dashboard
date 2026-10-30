import { NextResponse, after } from 'next/server';
import { getDb } from '@/lib/db';
import { checkSetupKey, claimSetupLink } from '@/lib/setup-links';
import { lookupUser, normalizeHandle, setupErrorMessage, XApiError, type XUser } from '@/lib/x';
import { saveXAccount, saveXToken } from '@/lib/x-store';
import { tokenKeyFromEnv } from '@/lib/x-crypto';
import { runFetch } from '@/lib/fetch-pipeline';

// Room for the first pull, which runs after the response has gone.
export const maxDuration = 300;

const MAX_ACCOUNTS = 10;

// POST { key, token, handles } — Save and start following. Re-checks the
// token and every handle against X rather than trusting what the page looked
// up, stores the encrypted token and the accounts, and kills the link — all in
// one transaction. Then the first pull for the new accounts runs in after(),
// so posts show up within minutes instead of at the next scheduled run.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { key?: string; token?: string; handles?: unknown };
  const db = await getDb();
  const link = await checkSetupKey(db, body.key);
  if (!link.ok) return NextResponse.json({ error: link.message }, { status: 403 });

  const token = body.token?.trim();
  if (!token) return NextResponse.json({ error: 'Paste and test the token first.' }, { status: 400 });

  const raw = Array.isArray(body.handles) ? body.handles.filter((h): h is string => typeof h === 'string') : [];
  const handles = [...new Set(raw.map(h => normalizeHandle(h)?.toLowerCase()).filter((h): h is string => !!h))];
  if (handles.length === 0) return NextResponse.json({ error: 'Add at least one account to follow.' }, { status: 400 });
  if (handles.length > MAX_ACCOUNTS) {
    return NextResponse.json({ error: `Up to ${MAX_ACCOUNTS} accounts at a time.` }, { status: 400 });
  }

  let key: Buffer;
  try {
    key = tokenKeyFromEnv();
  } catch (err) {
    console.error('setup/x save:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Setup isn't finished on our side yet (the encryption key is missing). Let Kush know." },
      { status: 500 },
    );
  }

  const users: XUser[] = [];
  for (const handle of handles) {
    try {
      users.push(await lookupUser(token, handle));
    } catch (err) {
      const message = err instanceof XApiError && err.kind === 'not_found'
        ? `No X account found for @${handle}. Fix or remove it, then save again.`
        : setupErrorMessage(err);
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  const tx = await db.transaction('write');
  try {
    if (!(await claimSetupLink(tx, link.id))) {
      await tx.rollback();
      return NextResponse.json({ error: 'This setup link has already been used.' }, { status: 403 });
    }
    await saveXToken(tx, token, key);
    for (const user of users) await saveXAccount(tx, user);
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    console.error('setup/x save failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Saving failed. Nothing was changed; try again.' }, { status: 500 });
  } finally {
    tx.close();
  }

  const userIds = users.map(u => u.id);
  after(async () => {
    try {
      const result = await runFetch({ xOnly: { userIds } });
      console.log(`setup/x first pull: ${result.videosProcessed} post(s) analysed, ${result.errors.length} error(s)`);
    } catch (err) {
      console.error('setup/x first pull failed:', err instanceof Error ? err.message : err);
    }
  });

  return NextResponse.json({
    ok: true,
    accounts: users.map(u => ({ handle: u.username, name: u.name })),
  });
}
