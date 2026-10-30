import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'crypto';
import { encryptToken, decryptToken, parseTokenKey, tokenKeyFromEnv, tokenLast4 } from '@/lib/x-crypto';

const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAexampleBearerToken%2Fabc123XYZ';

describe('token encryption', () => {
  afterEach(() => { delete process.env.X_TOKEN_ENCRYPTION_KEY; });

  it('round-trips', () => {
    const key = randomBytes(32);
    const enc = encryptToken(TOKEN, key);
    expect(decryptToken(enc, key)).toBe(TOKEN);
  });

  it('never stores the token in the clear', () => {
    const enc = encryptToken(TOKEN, randomBytes(32));
    expect(JSON.stringify(enc)).not.toContain(TOKEN);
    expect(Buffer.from(enc.ciphertext, 'base64').toString('utf8')).not.toBe(TOKEN);
  });

  it('uses a fresh IV each time', () => {
    const key = randomBytes(32);
    expect(encryptToken(TOKEN, key).iv).not.toBe(encryptToken(TOKEN, key).iv);
  });

  it('fails with the wrong key', () => {
    const enc = encryptToken(TOKEN, randomBytes(32));
    expect(() => decryptToken(enc, randomBytes(32))).toThrow();
  });

  it('fails when the ciphertext has been tampered with', () => {
    const key = randomBytes(32);
    const enc = encryptToken(TOKEN, key);
    const bytes = Buffer.from(enc.ciphertext, 'base64');
    bytes[0] ^= 1;
    expect(() => decryptToken({ ...enc, ciphertext: bytes.toString('base64') }, key)).toThrow();
  });

  it('requires a 32-byte base64 key', () => {
    expect(parseTokenKey(randomBytes(32).toString('base64'))).toHaveLength(32);
    expect(() => parseTokenKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });

  it('names the env var when it is missing', () => {
    expect(() => tokenKeyFromEnv()).toThrow(/X_TOKEN_ENCRYPTION_KEY is not set/);
    process.env.X_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    expect(tokenKeyFromEnv()).toHaveLength(32);
  });

  it('keeps only the last four characters for display', () => {
    expect(tokenLast4(TOKEN)).toBe('3XYZ');
  });
});
