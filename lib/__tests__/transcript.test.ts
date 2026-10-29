import { describe, it, expect } from 'vitest';
import { formatTranscriptForCopy } from '@/lib/transcript';

const base = {
  title: 'Why I am buying NVDA',
  channelName: 'Meet Kevin',
  publishedAt: '2026-10-28T14:00:00+00:00',
  url: 'https://youtube.com/watch?v=abc123',
  transcript: 'So today I want to talk about Nvidia.',
};

describe('formatTranscriptForCopy', () => {
  it('puts title, source, date and link above the text', () => {
    expect(formatTranscriptForCopy(base)).toBe(
      'Why I am buying NVDA\n' +
      'Meet Kevin · 2026-10-28\n' +
      'https://youtube.com/watch?v=abc123\n' +
      '\n' +
      'So today I want to talk about Nvidia.\n',
    );
  });

  it('trims the timestamp off the date', () => {
    expect(formatTranscriptForCopy(base)).toContain('Meet Kevin · 2026-10-28');
    expect(formatTranscriptForCopy(base)).not.toContain('14:00');
  });

  it('omits the link line for a pasted item, which has no public page', () => {
    const copied = formatTranscriptForCopy({ ...base, url: '' });
    expect(copied).toBe(
      'Why I am buying NVDA\nMeet Kevin · 2026-10-28\n\nSo today I want to talk about Nvidia.\n',
    );
    expect(copied).not.toContain('http');
  });

  it('keeps the transcript whole, however long', () => {
    const long = 'word '.repeat(50_000);
    const copied = formatTranscriptForCopy({ ...base, transcript: long });
    expect(copied).toContain(long.trim());
    expect(copied.length).toBeGreaterThan(200_000);
  });

  it('tidies stray whitespace around the transcript', () => {
    expect(formatTranscriptForCopy({ ...base, transcript: '\n\n  hello  \n\n' }))
      .toBe('Why I am buying NVDA\nMeet Kevin · 2026-10-28\nhttps://youtube.com/watch?v=abc123\n\nhello\n');
  });

  it('survives an article with no transcript text', () => {
    expect(formatTranscriptForCopy({ ...base, transcript: '' })).toMatch(/Why I am buying NVDA[\s\S]*\n$/);
  });
});
