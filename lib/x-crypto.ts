import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * At-rest encryption for Ray's X bearer token: AES-256-GCM, with the key in
 * X_TOKEN_ENCRYPTION_KEY (32 random bytes, base64). The database only ever
 * holds the ciphertext, IV and auth tag, so a copy of it is no use without the
 * Vercel env var. GCM's tag means a wrong key fails loudly rather than
 * decrypting to garbage.
 */
export interface EncryptedToken {
  ciphertext: string;
  iv: string;
  tag: string;
}

export const TOKEN_KEY_ENV = 'X_TOKEN_ENCRYPTION_KEY';

/** The key from env, or a clear error naming the variable. */
export function tokenKeyFromEnv(): Buffer {
  const raw = process.env[TOKEN_KEY_ENV]?.trim();
  if (!raw) throw new Error(`${TOKEN_KEY_ENV} is not set`);
  return parseTokenKey(raw);
}

export function parseTokenKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) {
    throw new Error(`${TOKEN_KEY_ENV} must be 32 bytes, base64 encoded (got ${key.length} bytes)`);
  }
  return key;
}

export function encryptToken(token: string, key: Buffer): EncryptedToken {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

/** Throws if the key is wrong or the stored values were tampered with. */
export function decryptToken(enc: EncryptedToken, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** The only part of the token that is ever shown again. */
export function tokenLast4(token: string): string {
  return token.slice(-4);
}
