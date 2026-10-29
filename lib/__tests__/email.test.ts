import { describe, it, expect, afterEach } from 'vitest';
import { alertRecipients, digestRecipients } from '@/lib/email';

const original = { ...process.env };
afterEach(() => {
  process.env.ALERT_EMAILS = original.ALERT_EMAILS;
  process.env.NOTIFY_EMAIL = original.NOTIFY_EMAIL;
  process.env.DIGEST_EMAILS = original.DIGEST_EMAILS;
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
