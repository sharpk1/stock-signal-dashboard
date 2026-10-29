import { describe, it, expect } from 'vitest';
import { citedSources, type ChatSource } from '@/app/api/chat/route';
import { itemUrl } from '@/lib/item-url';

const sources: ChatSource[] = [
  { label: 'S1', title: 'First video', channelName: 'Meet Kevin', publishedAt: '2026-10-20', url: 'https://youtube.com/watch?v=a' },
  { label: 'S2', title: 'Second video', channelName: 'Royce Jakob', publishedAt: '2026-10-21', url: 'https://youtube.com/watch?v=b' },
  { label: 'S3', title: 'Third video', channelName: 'Mark Meldrum', publishedAt: '2026-10-22', url: 'https://youtube.com/watch?v=c' },
];

describe('citedSources', () => {
  it('returns only the items the answer actually cited', () => {
    const cited = citedSources('He is bullish on NVDA [S2], and cautious elsewhere [S3].', sources);
    expect(cited.map(s => s.label)).toEqual(['S2', 'S3']);
  });

  it('keeps the order they were cited in', () => {
    expect(citedSources('[S3] then [S1]', sources).map(s => s.label)).toEqual(['S3', 'S1']);
  });

  it('does not repeat a source cited twice', () => {
    expect(citedSources('[S1] and again [S1]', sources)).toHaveLength(1);
  });

  it('ignores a label the model invented', () => {
    expect(citedSources('According to [S9], ...', sources)).toEqual([]);
  });

  it('returns nothing when the answer cites nothing', () => {
    expect(citedSources('I could not find anything on that.', sources)).toEqual([]);
  });
});

describe('itemUrl', () => {
  it('links a YouTube video to YouTube', () => {
    expect(itemUrl('UCUvvj5lwue7PspotMDjk5UA', 'abc123')).toBe('https://youtube.com/watch?v=abc123');
  });

  it('links a Substack post to the publication, not YouTube', () => {
    expect(itemUrl('thepopularinvestor', 'my-post')).toBe('https://thepopularinvestor.substack.com/p/my-post');
  });

  it('falls back to YouTube for an unknown channel', () => {
    expect(itemUrl('UC-unknown', 'xyz')).toBe('https://youtube.com/watch?v=xyz');
  });
});
