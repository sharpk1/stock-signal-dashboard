import type { Client, Transaction } from '@libsql/client';
import { CHANNELS, type Channel } from '@/lib/channels';
import { decryptToken, encryptToken, tokenLast4, type EncryptedToken } from '@/lib/x-crypto';
import type { XUser } from '@/lib/x';

/**
 * X accounts and the token, stored as data rather than in CHANNELS: Ray picks
 * the accounts on /setup/x, so they can't be known at build time.
 */

/** Weight against the 0.1 of a YouTube channel: an off-the-cuff post is weaker evidence than a considered video. */
export const X_CHANNEL_WEIGHT = 0.05;

/**
 * channels.id for an X account. CHANNELS hand-assigns small ids, so X rows sit
 * well clear of them; a collision on the primary key would break saveChannel.
 */
const X_CHANNEL_ID_BASE = 10_000;

export function xChannelId(userId: string): string {
  return `x-${userId}`;
}

export interface XAccount {
  id: number;
  userId: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  enabled: boolean;
  sinceId: string | null;
}

export function xAccountToChannel(a: XAccount): Channel {
  return {
    id: X_CHANNEL_ID_BASE + a.id,
    channelId: xChannelId(a.userId),
    handle: `@${a.handle}`,
    name: a.name,
    weight: X_CHANNEL_WEIGHT,
    source: 'x',
    xUserId: a.userId,
  };
}

type Db = Client | Transaction;

export async function listXAccounts(db: Db, opts: { enabledOnly?: boolean } = {}): Promise<XAccount[]> {
  const rows = (await db.execute(
    `SELECT id, user_id, handle, name, avatar_url, enabled, since_id FROM x_accounts
     ${opts.enabledOnly ? 'WHERE enabled = 1' : ''} ORDER BY id`,
  )).rows as unknown as Record<string, string | number | null>[];
  return rows.map(r => ({
    id: Number(r.id),
    userId: String(r.user_id),
    handle: String(r.handle),
    name: String(r.name),
    avatarUrl: r.avatar_url === null ? null : String(r.avatar_url),
    enabled: Number(r.enabled) === 1,
    sinceId: r.since_id === null ? null : String(r.since_id),
  }));
}

/** CHANNELS plus every followed X account — what the cards, switches and channel pages list. */
export async function getAllChannels(db: Client): Promise<Channel[]> {
  const x = await listXAccounts(db, { enabledOnly: true });
  return [...CHANNELS, ...x.map(xAccountToChannel)];
}

/**
 * Follow an account, or refresh its name and picture if it's already followed.
 * since_id is left alone on a re-save, so re-following never re-reads history.
 * Writes the matching channels row (and avatar) in the same go.
 */
export async function saveXAccount(db: Db, user: XUser): Promise<XAccount> {
  await db.execute({
    sql: `
      INSERT INTO x_accounts (user_id, handle, name, avatar_url, enabled)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(user_id) DO UPDATE SET
        handle = excluded.handle, name = excluded.name,
        avatar_url = excluded.avatar_url, enabled = 1
    `,
    args: [user.id, user.username, user.name, user.avatarUrl],
  });
  const account = (await listXAccounts(db)).find(a => a.userId === user.id)!;
  const ch = xAccountToChannel(account);
  await db.execute({
    sql: `
      INSERT INTO channels (id, channel_id, handle, name, weight, avatar_url, avatar_checked_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(channel_id) DO UPDATE SET
        handle = excluded.handle, name = excluded.name, weight = excluded.weight,
        avatar_url = excluded.avatar_url, avatar_checked_at = excluded.avatar_checked_at
    `,
    args: [ch.id, ch.channelId, ch.handle, ch.name, ch.weight, account.avatarUrl],
  });
  return account;
}

export async function setXSinceId(db: Db, userId: string, sinceId: string): Promise<void> {
  await db.execute({ sql: 'UPDATE x_accounts SET since_id = ? WHERE user_id = ?', args: [sinceId, userId] });
}

/** Replace the stored token. Only ciphertext, IV, tag and the last four characters are written. */
export async function saveXToken(db: Db, token: string, key: Buffer): Promise<void> {
  const enc = encryptToken(token, key);
  await db.execute({
    sql: `
      INSERT INTO x_settings (id, token_ciphertext, token_iv, token_tag, token_last4, updated_at)
      VALUES (1, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        token_ciphertext = excluded.token_ciphertext, token_iv = excluded.token_iv,
        token_tag = excluded.token_tag, token_last4 = excluded.token_last4,
        updated_at = excluded.updated_at
    `,
    args: [enc.ciphertext, enc.iv, enc.tag, tokenLast4(token)],
  });
}

export async function getStoredXToken(db: Db): Promise<(EncryptedToken & { last4: string }) | null> {
  const row = (await db.execute(
    'SELECT token_ciphertext, token_iv, token_tag, token_last4 FROM x_settings WHERE id = 1',
  )).rows[0];
  if (!row) return null;
  return {
    ciphertext: String(row.token_ciphertext),
    iv: String(row.token_iv),
    tag: String(row.token_tag),
    last4: String(row.token_last4),
  };
}

/** The decrypted token, or null when none has been saved. Throws if it can't be decrypted. */
export async function loadXToken(db: Db, key: () => Buffer): Promise<string | null> {
  const stored = await getStoredXToken(db);
  if (!stored) return null;
  return decryptToken(stored, key());
}
