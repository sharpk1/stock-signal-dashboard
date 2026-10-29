import { describe, it, expect } from 'vitest';
import { oneLineSummary, digestSubject, buildDigestHtml,
         type DigestContent } from '@/lib/daily-digest';

const empty: DigestContent = { date: 'Thu, Oct 29', items: [], topTickers: [], alerts: [], sourceErrors: [] };

const full: DigestContent = {
  date: 'Thu, Oct 29',
  items: [{
    title: 'Why I am buying NVDA',
    channelName: 'Meet Kevin',
    summary: '## Thesis\nHe is adding to NVDA ahead of earnings. More detail follows.',
    tickers: ['NVDA', 'TSLA'],
    url: 'https://youtube.com/watch?v=abc',
  }],
  topTickers: [
    { ticker: 'NVDA', company: 'Nvidia', channelCount: 3, weightedScore: 82, channels: 'Meet Kevin,Royce Jakob' },
    { ticker: 'TSLA', company: null, channelCount: 1, weightedScore: 40, channels: 'Royce Jakob' },
  ],
  alerts: [{ ticker: 'NVDA', channels: 'Robert Reynolds,Meet Kevin' }],
  sourceErrors: [{ name: 'Bravo’s Research', error: 'fetch failed — 404' }],
};

describe('oneLineSummary', () => {
  it('takes the first sentence', () => {
    expect(oneLineSummary('He is adding to NVDA. More detail follows.')).toBe('He is adding to NVDA.');
  });

  it('steps over a markdown heading', () => {
    expect(oneLineSummary('## Thesis\nHe is adding to NVDA. More follows.')).toBe('He is adding to NVDA.');
  });

  it('steps over a bold lead-in', () => {
    expect(oneLineSummary('**Thesis:** He is adding to NVDA. More.')).toBe('Thesis: He is adding to NVDA.');
  });

  it('truncates a very long first line', () => {
    const line = `${'word '.repeat(100)}.`;
    const result = oneLineSummary(line, 60);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result.endsWith('…')).toBe(true);
  });

  it('handles a missing summary', () => {
    expect(oneLineSummary(null)).toBe('No summary available.');
    expect(oneLineSummary('')).toBe('No summary available.');
  });

  it('handles a summary that is only a heading rule', () => {
    expect(oneLineSummary('---\n')).toBe('No summary available.');
  });
});

describe('digestSubject', () => {
  it('says plainly when nothing came in', () => {
    expect(digestSubject(empty)).toBe('Signal Desk — nothing new, Thu, Oct 29');
  });

  it('counts items and leads with the top tickers', () => {
    expect(digestSubject(full)).toBe('Signal Desk — 1 new item · NVDA, TSLA');
  });

  it('pluralises', () => {
    const two = { ...full, items: [full.items[0], full.items[0]] };
    expect(digestSubject(two)).toContain('2 new items');
  });
});

describe('buildDigestHtml', () => {
  const html = buildDigestHtml(full, 'https://example.com');

  it('includes the alerts, top tickers and the item', () => {
    expect(html).toContain('Convergence alerts (1)');
    expect(html).toContain('Top tickers');
    expect(html).toContain('Why I am buying NVDA');
    expect(html).toContain('New items (1)');
  });

  it('gives each item a one-line summary', () => {
    expect(html).toContain('He is adding to NVDA ahead of earnings.');
  });

  it('spaces out the channel lists, which arrive comma-joined from SQL', () => {
    expect(html).toContain('Meet Kevin, Royce Jakob');
    expect(html).not.toContain('Meet Kevin,Royce Jakob');
  });

  it('puts failing sources in a footer', () => {
    expect(html).toContain('Sources needing attention');
    expect(html).toContain('fetch failed — 404');
  });

  it('says a quiet day is quiet, not broken', () => {
    const quiet = buildDigestHtml(empty, 'https://example.com');
    expect(quiet).toContain('quiet day, not a broken one');
    expect(quiet).not.toContain('Sources needing attention');
    expect(quiet).not.toContain('Top tickers');
  });

  it('links an item that has a url and plain-texts one that does not', () => {
    expect(html).toContain('href="https://youtube.com/watch?v=abc"');
    const pasted = buildDigestHtml(
      { ...full, items: [{ ...full.items[0], url: '' }] },
      'https://example.com',
    );
    expect(pasted).not.toContain('href="https://youtube.com');
    expect(pasted).toContain('Why I am buying NVDA');
  });

  it('escapes html in titles so a stray bracket cannot break the email', () => {
    const risky = buildDigestHtml(
      { ...full, items: [{ ...full.items[0], title: 'NVDA <script>alert(1)</script>' }] },
      'https://example.com',
    );
    expect(risky).not.toContain('<script>');
    expect(risky).toContain('&lt;script&gt;');
  });
});
