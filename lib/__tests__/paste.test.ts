import { describe, it, expect } from 'vitest';
import { parsePaste, pasteItemId, pasteTitle, isIsoDate, isPasteType,
         todayIso, MIN_PASTE_CHARS, PASTE_TYPE_LABELS } from '@/lib/paste';

const LONG = 'Kevin is bullish on NVDA into earnings. '.repeat(20);

describe('pasteItemId', () => {
  it('is stable for the same text', () => {
    expect(pasteItemId(LONG)).toBe(pasteItemId(LONG));
  });

  it('ignores whitespace differences, so a re-copy is still the same item', () => {
    expect(pasteItemId('a  b\n c')).toBe(pasteItemId('a b c '));
  });

  it('differs for different text', () => {
    expect(pasteItemId(LONG)).not.toBe(pasteItemId(`${LONG} and also TSLA.`));
  });

  it('is prefixed so a pasted item is recognisable in the database', () => {
    expect(pasteItemId(LONG)).toMatch(/^paste-[0-9a-f]{16}$/);
  });
});

describe('isIsoDate', () => {
  it('accepts a real calendar date', () => {
    expect(isIsoDate('2026-10-29')).toBe(true);
  });

  it('rejects a date that does not exist', () => {
    expect(isIsoDate('2026-02-31')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
  });

  it('rejects other formats', () => {
    expect(isIsoDate('29/10/2026')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
});

describe('pasteTitle', () => {
  it('falls back to the type and date', () => {
    expect(pasteTitle('alpha-report', '2026-10-29')).toBe('Alpha report — 2026-10-29');
    expect(pasteTitle('livestream-transcript', '2026-10-29')).toBe('Livestream transcript — 2026-10-29');
  });

  it('uses a title that was given', () => {
    expect(pasteTitle('alpha-report', '2026-10-29', '  Kevin on rates  ')).toBe('Kevin on rates');
  });

  it('ignores a blank title', () => {
    expect(pasteTitle('alpha-report', '2026-10-29', '   ')).toBe('Alpha report — 2026-10-29');
  });
});

describe('parsePaste', () => {
  const now = new Date('2026-10-29T12:00:00Z');

  it('accepts a full paste', () => {
    const result = parsePaste({ type: 'alpha-report', date: '2026-10-20', text: LONG, title: 'A report' }, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe('A report');
      expect(result.value.date).toBe('2026-10-20');
    }
  });

  it('defaults the date to today', () => {
    const result = parsePaste({ type: 'alpha-report', text: LONG }, now);
    expect(result.ok && result.value.date).toBe('2026-10-29');
    expect(todayIso(now)).toBe('2026-10-29');
  });

  it('rejects an unknown type', () => {
    const result = parsePaste({ type: 'tweet', text: LONG }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('type must be one of');
  });

  it('rejects a missing type', () => {
    expect(parsePaste({ text: LONG }, now).ok).toBe(false);
  });

  it('rejects a paste that is too short to be a report', () => {
    const result = parsePaste({ type: 'alpha-report', text: 'NVDA good' }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(String(MIN_PASTE_CHARS));
  });

  it('rejects a malformed date', () => {
    const result = parsePaste({ type: 'alpha-report', date: '29-10-2026', text: LONG }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('YYYY-MM-DD');
  });

  it('trims the pasted text', () => {
    const result = parsePaste({ type: 'alpha-report', text: `\n\n${LONG}\n\n` }, now);
    expect(result.ok && result.value.text.startsWith('Kevin')).toBe(true);
  });
});

describe('type labels', () => {
  it('names both types for the UI', () => {
    expect(PASTE_TYPE_LABELS['alpha-report']).toBe('Alpha report');
    expect(PASTE_TYPE_LABELS['livestream-transcript']).toBe('Livestream transcript');
  });

  it('recognises only real types', () => {
    expect(isPasteType('alpha-report')).toBe(true);
    expect(isPasteType('something-else')).toBe(false);
  });
});
