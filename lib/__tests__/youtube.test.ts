import { describe, it, expect } from 'vitest';
import {
  parseRssFeed,
  channelFeedUrl,
  feedPlaylistId,
  availableLangsFromError,
  pickEnglishLang,
} from '@/lib/youtube';
import type { Channel } from '@/lib/channels';

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

const DUMB_MONEY: Channel = {
  id: 3,
  channelId: 'UCS01CiRDAiyhR_mTHXDW23A',
  handle: '@DumbMoneyLive',
  name: 'Dumb Money Live',
  weight: 0.1,
  feed: 'streams',
};

const MEET_KEVIN: Channel = {
  id: 9,
  channelId: 'UCUvvj5lwue7PspotMDjk5UA',
  handle: '@MeetKevin',
  name: 'Meet Kevin',
  weight: 0.1,
  feed: 'longform',
};

describe('feedPlaylistId', () => {
  it('swaps the UC prefix for UULV on the streams playlist', () => {
    expect(feedPlaylistId('UCS01CiRDAiyhR_mTHXDW23A', 'streams')).toBe('UULVS01CiRDAiyhR_mTHXDW23A');
  });

  it('swaps the UC prefix for UULF on the long-form playlist', () => {
    expect(feedPlaylistId('UCUvvj5lwue7PspotMDjk5UA', 'longform')).toBe('UULFUvvj5lwue7PspotMDjk5UA');
  });

  it('rejects an id that is not a UC channel id', () => {
    expect(() => feedPlaylistId('thepopularinvestor', 'streams')).toThrow(/expected a UC/);
  });
});

describe('channelFeedUrl', () => {
  it('uses the streams playlist feed for a streams-only channel', () => {
    expect(channelFeedUrl(DUMB_MONEY)).toBe(
      'https://www.youtube.com/feeds/videos.xml?playlist_id=UULVS01CiRDAiyhR_mTHXDW23A',
    );
  });

  it('uses the long-form playlist feed for a long-form-only channel', () => {
    expect(channelFeedUrl(MEET_KEVIN)).toBe(
      'https://www.youtube.com/feeds/videos.xml?playlist_id=UULFUvvj5lwue7PspotMDjk5UA',
    );
  });

  it('uses the channel feed when no feed is pinned', () => {
    const channel: Channel = { ...DUMB_MONEY, feed: undefined, channelId: 'UCabc123' };
    expect(channelFeedUrl(channel)).toBe(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UCabc123',
    );
  });
});

describe('availableLangsFromError', () => {
  it('reads the caption languages out of the library error message', () => {
    const err = new Error(
      'No transcripts are available in en this video (abc123). Available languages: en-US, es, fr',
    );
    expect(availableLangsFromError(err)).toEqual(['en-US', 'es', 'fr']);
  });

  it('returns null for an unrelated error so callers can rethrow it', () => {
    expect(availableLangsFromError(new Error('Transcript is disabled on this video'))).toBeNull();
    expect(availableLangsFromError('not an error')).toBeNull();
  });
});

describe('pickEnglishLang', () => {
  it('prefers plain en', () => {
    expect(pickEnglishLang(['es', 'en', 'en-GB'])).toBe('en');
  });

  it('falls back to a regional English variant', () => {
    expect(pickEnglishLang(['es', 'en-US'])).toBe('en-US');
  });

  it('returns undefined when no track is English', () => {
    expect(pickEnglishLang(['es', 'fr', 'de'])).toBeUndefined();
  });
});
