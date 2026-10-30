import { describe, it, expect } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { initDb } from '@/lib/db';
import { createSetupLink, checkSetupKey, claimSetupLink, hashSetupKey, generateSetupKey, setupUrl } from '@/lib/setup-links';

// A file, not :memory:: libsql hands a transaction its own connection, and
// for an in-memory database that's a different, empty database.
async function makeTestDb(): Promise<Client> {
  const db = createClient({ url: `file:${path.join(mkdtempSync(path.join(tmpdir(), 'setup-links-')), 'test.db')}` });
  await initDb(db);
  return db;
}

const NOW = new Date('2026-10-30T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('setup link keys', () => {
  it('mints a long random URL-safe key, different each time', () => {
    const a = generateSetupKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateSetupKey()).not.toBe(a);
  });

  it('hashes with SHA-256', () => {
    expect(hashSetupKey('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('builds the production setup URL', () => {
    expect(setupUrl('k_1')).toBe('https://stock-signal-dashboard-nine.vercel.app/setup/x?key=k_1');
  });

  it('stores only the hash, with a 7-day expiry', async () => {
    const db = await makeTestDb();
    const { key, expiresAt } = await createSetupLink(db, 'x', NOW);
    const rows = (await db.execute('SELECT * FROM setup_links')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].key_hash).toBe(hashSetupKey(key));
    expect(JSON.stringify(rows[0])).not.toContain(key);
    expect(Date.parse(expiresAt) - NOW.getTime()).toBe(7 * DAY);
  });
});

describe('checkSetupKey', () => {
  it('accepts a live key', async () => {
    const db = await makeTestDb();
    const { key } = await createSetupLink(db, 'x', NOW);
    expect((await checkSetupKey(db, key, 'x', NOW)).ok).toBe(true);
  });

  it('rejects a missing key', async () => {
    const db = await makeTestDb();
    expect(await checkSetupKey(db, undefined, 'x', NOW)).toMatchObject({ ok: false, reason: 'missing' });
    expect(await checkSetupKey(db, '', 'x', NOW)).toMatchObject({ ok: false, reason: 'missing' });
  });

  it('rejects an unknown key', async () => {
    const db = await makeTestDb();
    await createSetupLink(db, 'x', NOW);
    expect(await checkSetupKey(db, 'not-a-real-key', 'x', NOW)).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('rejects a key minted for a different purpose', async () => {
    const db = await makeTestDb();
    const { key } = await createSetupLink(db, 'other', NOW);
    expect(await checkSetupKey(db, key, 'x', NOW)).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('rejects an expired key', async () => {
    const db = await makeTestDb();
    const { key } = await createSetupLink(db, 'x', NOW);
    const later = new Date(NOW.getTime() + 7 * DAY + 1);
    const result = await checkSetupKey(db, key, 'x', later);
    expect(result).toMatchObject({ ok: false, reason: 'expired' });
    expect(result.ok ? '' : result.message).toMatch(/expired/);
  });

  it('rejects a key once it has been used, and can only be claimed once', async () => {
    const db = await makeTestDb();
    const { key } = await createSetupLink(db, 'x', NOW);
    const live = await checkSetupKey(db, key, 'x', NOW);
    if (!live.ok) throw new Error('expected a live link');

    const tx = await db.transaction('write');
    expect(await claimSetupLink(tx, live.id, NOW)).toBe(true);
    expect(await claimSetupLink(tx, live.id, NOW)).toBe(false);
    await tx.commit();

    expect(await checkSetupKey(db, key, 'x', NOW)).toMatchObject({ ok: false, reason: 'used' });
  });
});
