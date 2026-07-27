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

  it('filters to videos published within the 30-day fetch window', () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const recentDate = new Date(now - 2 * day).toISOString();
    const oldDate = new Date(now - 40 * day).toISOString();
    const rss = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
      <entry><yt:videoId>recent1</yt:videoId><title>Recent</title><published>${recentDate}</published></entry>
      <entry><yt:videoId>old1</yt:videoId><title>Old</title><published>${oldDate}</published></entry>
    </feed>`;
    const cutoff = now - 30 * day;
    const recent = parseRssFeed(rss).filter(v => new Date(v.publishedAt).getTime() >= cutoff);
    expect(recent).toHaveLength(1);
    expect(recent[0].videoId).toBe('recent1');
  });
});
