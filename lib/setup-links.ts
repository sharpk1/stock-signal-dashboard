import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { Client, Transaction } from '@libsql/client';

/**
 * One-time setup links (RAY-16): /setup/x?key=<random>. Kush mints one with
 * scripts/create-x-setup-link.ts and sends it to Ray. The key is the only
 * credential the page needs, so only its SHA-256 is stored; the link expires
 * after a week and dies the moment a save succeeds.
 */
export const SETUP_LINK_DAYS = 7;
export const SETUP_PURPOSE_X = 'x';
export const SETUP_BASE_URL = 'https://stock-signal-dashboard-nine.vercel.app';

export function hashSetupKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** 32 random bytes, URL-safe. */
export function generateSetupKey(): string {
  return randomBytes(32).toString('base64url');
}

export function setupUrl(key: string, base: string = SETUP_BASE_URL): string {
  return `${base}/setup/x?key=${encodeURIComponent(key)}`;
}

/** Store a new link and return its raw key. The key itself is never written. */
export async function createSetupLink(
  db: Client,
  purpose: string = SETUP_PURPOSE_X,
  now: Date = new Date(),
): Promise<{ key: string; expiresAt: string }> {
  const key = generateSetupKey();
  const expiresAt = new Date(now.getTime() + SETUP_LINK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.execute({
    sql: 'INSERT INTO setup_links (purpose, key_hash, created_at, expires_at) VALUES (?, ?, ?, ?)',
    args: [purpose, hashSetupKey(key), now.toISOString(), expiresAt],
  });
  return { key, expiresAt };
}

export type SetupLinkCheck =
  | { ok: true; id: number; expiresAt: string }
  | { ok: false; reason: 'missing' | 'unknown' | 'expired' | 'used'; message: string };

const MESSAGES: Record<'missing' | 'unknown' | 'expired' | 'used', string> = {
  missing: 'This page needs the setup link Kush sent you. Open that link instead.',
  unknown: "This setup link isn't valid. Ask Kush for a new one.",
  expired: 'This setup link has expired. Ask Kush for a new one.',
  used: 'This setup link has already been used. X is set up; ask Kush if you need to change it.',
};

function fail(reason: keyof typeof MESSAGES): SetupLinkCheck {
  return { ok: false, reason, message: MESSAGES[reason] };
}

/**
 * Is this key a live link? Every stored hash for the purpose is compared in
 * constant time rather than looking the hash up with `=`, so response timing
 * says nothing about how close a guess was. There are only ever a handful of
 * rows.
 */
export async function checkSetupKey(
  db: Client | Transaction,
  key: string | null | undefined,
  purpose: string = SETUP_PURPOSE_X,
  now: Date = new Date(),
): Promise<SetupLinkCheck> {
  if (!key || typeof key !== 'string') return fail('missing');
  const wanted = Buffer.from(hashSetupKey(key), 'hex');
  const rows = (await db.execute({
    sql: 'SELECT id, key_hash, expires_at, used_at FROM setup_links WHERE purpose = ?',
    args: [purpose],
  })).rows as unknown as { id: number; key_hash: string; expires_at: string; used_at: string | null }[];

  let match: (typeof rows)[number] | null = null;
  for (const row of rows) {
    const stored = Buffer.from(String(row.key_hash), 'hex');
    if (stored.length === wanted.length && timingSafeEqual(stored, wanted)) match = row;
  }
  if (!match) return fail('unknown');
  if (match.used_at) return fail('used');
  if (Date.parse(String(match.expires_at)) <= now.getTime()) return fail('expired');
  return { ok: true, id: Number(match.id), expiresAt: String(match.expires_at) };
}

/**
 * Claim the link inside the save's transaction. Conditional on used_at still
 * being null, so two saves racing each other can't both get through.
 */
export async function claimSetupLink(tx: Transaction, id: number, now: Date = new Date()): Promise<boolean> {
  const result = await tx.execute({
    sql: 'UPDATE setup_links SET used_at = ? WHERE id = ? AND used_at IS NULL',
    args: [now.toISOString(), id],
  });
  return result.rowsAffected === 1;
}
