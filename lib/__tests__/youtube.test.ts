import { describe, it, expect } from 'vitest';
import { parseRssFeed, type RssVideo } from '@/lib/youtube';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>abc123</yt:videoId>
    <title>Test Video One</title>
    <published>2026-06-10T10:00:00+00:00</published>
  </entry>
  <entry>
    <yt:videoId>def456</yt:videoId>
    <title>Test Video Two</title>
    <published>2026-06-08T10:00:00+00:00</published>
  </entry>
</feed>`;

describe('parseRssFeed', () => {
  it('extracts video ids and titles', () => {
    const videos = parseRssFeed(SAMPLE_RSS);
    expect(videos).toHaveLength(2);
    expect(videos[0].videoId).toBe('abc123');
    expect(videos[0].title).toBe('Test Video One');
  });

  it('returns empty array for empty feed', () => {
    const empty = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom"></feed>`;
    expect(parseRssFeed(empty)).toEqual([]);
  });

  it('filters to videos published within the last 24 hours', () => {
    const recent = parseRssFeed(SAMPLE_RSS).filter(v => {
      const age = Date.now() - new Date(v.publishedAt).getTime();
      return age < 24 * 60 * 60 * 1000;
    });
    expect(recent).toHaveLength(1);
    expect(recent[0].videoId).toBe('abc123');
  });
});
