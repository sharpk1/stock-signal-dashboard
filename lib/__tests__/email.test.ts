import { describe, it, expect, afterEach } from 'vitest';
import { alertRecipients, digestRecipients, digestEnabled } from '@/lib/email';

const original = { ...process.env };
afterEach(() => {
  process.env.ALERT_EMAILS = original.ALERT_EMAILS;
  process.env.NOTIFY_EMAIL = original.NOTIFY_EMAIL;
  process.env.DIGEST_EMAILS = original.DIGEST_EMAILS;
  process.env.DIGEST_ENABLED = original.DIGEST_ENABLED;
});

describe('alertRecipients', () => {
  it('splits a comma-separated list, so both Ray and Kush are told', () => {
    process.env.ALERT_EMAILS = 'ray@example.com,kush@altiro.io';
    expect(alertRecipients()).toEqual(['ray@example.com', 'kush@altiro.io']);
  });

  it('tolerates spacing and trailing commas', () => {
    process.env.ALERT_EMAILS = ' ray@example.com ,, kush@altiro.io , ';
    expect(alertRecipients()).toEqual(['ray@example.com', 'kush@altiro.io']);
  });

  it('removes duplicates', () => {
    process.env.ALERT_EMAILS = 'ray@example.com,ray@example.com';
    expect(alertRecipients()).toEqual(['ray@example.com']);
  });

  it('falls back to the digest recipient when ALERT_EMAILS is unset', () => {
    delete process.env.ALERT_EMAILS;
    process.env.NOTIFY_EMAIL = 'kush@altiro.io';
    expect(alertRecipients()).toEqual(['kush@altiro.io']);
  });

  it('returns nothing when neither is configured', () => {
    delete process.env.ALERT_EMAILS;
    delete process.env.NOTIFY_EMAIL;
    expect(alertRecipients()).toEqual([]);
  });
});

describe('digestRecipients', () => {
  it('sends the summary to nobody when DIGEST_EMAILS is unset, even with alerts on', () => {
    delete process.env.DIGEST_EMAILS;
    process.env.ALERT_EMAILS = 'kush@altiro.io';
    expect(digestRecipients()).toEqual([]);
  });

  it('reads its own comma-separated list', () => {
    process.env.DIGEST_EMAILS = 'ray@example.com, kush@altiro.io';
    expect(digestRecipients()).toEqual(['ray@example.com', 'kush@altiro.io']);
  });
});

describe('digestEnabled', () => {
  it('is off when unset', () => {
    delete process.env.DIGEST_ENABLED;
    expect(digestEnabled()).toBe(false);
  });

  it('is off for anything but "true"', () => {
    process.env.DIGEST_ENABLED = 'false';
    expect(digestEnabled()).toBe(false);
    process.env.DIGEST_ENABLED = '1';
    expect(digestEnabled()).toBe(false);
  });

  it('is on for "true", ignoring case and spaces', () => {
    process.env.DIGEST_ENABLED = ' TRUE ';
    expect(digestEnabled()).toBe(true);
  });
});
