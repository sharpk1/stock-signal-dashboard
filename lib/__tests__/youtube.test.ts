import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseRssFeed,
  channelFeedUrl,
  feedPlaylistId,
  uploadsPlaylistId,
  channelPlaylistId,
  parsePlaylistItems,
  fetchRecentVideosWithSource,
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

describe('uploadsPlaylistId', () => {
  it('swaps the UC prefix for UU on the uploads playlist', () => {
    expect(uploadsPlaylistId('UCUvvj5lwue7PspotMDjk5UA')).toBe('UUUvvj5lwue7PspotMDjk5UA');
  });

  it('rejects an id that is not a UC channel id', () => {
    expect(() => uploadsPlaylistId('thepopularinvestor')).toThrow(/expected a UC/);
  });
});

describe('channelPlaylistId', () => {
  it('uses the pinned feed playlist when the channel has one', () => {
    expect(channelPlaylistId(DUMB_MONEY)).toBe('UULVS01CiRDAiyhR_mTHXDW23A');
    expect(channelPlaylistId(MEET_KEVIN)).toBe('UULFUvvj5lwue7PspotMDjk5UA');
  });

  it('falls back to the uploads playlist when no feed is pinned', () => {
    expect(channelPlaylistId({ ...MEET_KEVIN, feed: undefined })).toBe('UUUvvj5lwue7PspotMDjk5UA');
  });
});

describe('parsePlaylistItems', () => {
  it('maps playlistItems onto the RSS video shape', () => {
    const videos = parsePlaylistItems({
      items: [
        {
          snippet: { title: 'API Video', publishedAt: '2026-10-20T10:00:00Z' },
          contentDetails: { videoId: 'api123', videoPublishedAt: '2026-10-19T08:00:00Z' },
        },
      ],
    });
    expect(videos).toEqual([
      { videoId: 'api123', title: 'API Video', publishedAt: '2026-10-19T08:00:00Z' },
    ]);
  });

  it('prefers the video publish date over the playlist-add date', () => {
    const [video] = parsePlaylistItems({
      items: [{
        snippet: { title: 'T', publishedAt: '2026-10-20T10:00:00Z' },
        contentDetails: { videoId: 'v1', videoPublishedAt: '2026-10-01T10:00:00Z' },
      }],
    });
    expect(video.publishedAt).toBe('2026-10-01T10:00:00Z');
  });

  it('falls back to the playlist-add date when the video date is absent', () => {
    const [video] = parsePlaylistItems({
      items: [{
        snippet: { title: 'T', publishedAt: '2026-10-20T10:00:00Z' },
        contentDetails: { videoId: 'v1' },
      }],
    });
    expect(video.publishedAt).toBe('2026-10-20T10:00:00Z');
  });

  it('returns an empty list for an empty response', () => {
    expect(parsePlaylistItems({})).toEqual([]);
  });
});

/**
 * The fallback is the whole point of the change, so these drive
 * `fetchRecentVideosWithSource` through a mocked `fetch` rather than testing the
 * pieces: what matters is which listing gets called, in what order.
 */
describe('fetchRecentVideosWithSource', () => {
  const recentDate = () => new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  const rssBody = () => `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
    <entry><yt:videoId>rss1</yt:videoId><title>From RSS</title><published>${recentDate()}</published></entry>
  </feed>`;

  const apiBody = () => ({
    items: [{
      snippet: { title: 'From API', publishedAt: recentDate() },
      contentDetails: { videoId: 'api1', videoPublishedAt: recentDate() },
    }],
  });

  let calls: string[];
  const originalKey = process.env.YOUTUBE_API_KEY;

  /** Route by host so a test states only what each listing should answer. */
  function stubFetch(handlers: {
    rss: () => { ok: boolean; status: number; text?: string };
    api?: () => { ok: boolean; status: number; json?: unknown };
  }) {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      calls.push(input);
      if (input.includes('googleapis.com')) {
        if (!handlers.api) throw new Error(`unexpected Data API call: ${input}`);
        const res = handlers.api();
        return { ok: res.ok, status: res.status, json: async () => res.json };
      }
      const res = handlers.rss();
      return { ok: res.ok, status: res.status, text: async () => res.text ?? '' };
    }));
  }

  beforeEach(() => {
    calls = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = originalKey;
  });

  it('uses RSS and never touches the Data API while the feed is healthy', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    stubFetch({ rss: () => ({ ok: true, status: 200, text: rssBody() }) });

    const result = await fetchRecentVideosWithSource(MEET_KEVIN);

    expect(result.via).toBe('rss');
    expect(result.videos).toEqual([
      { videoId: 'rss1', title: 'From RSS', publishedAt: expect.any(String) },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls.some(c => c.includes('googleapis.com'))).toBe(false);
  });

  it('falls back to the Data API when the feed 404s, and maps the result', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    stubFetch({
      rss: () => ({ ok: false, status: 404 }),
      api: () => ({ ok: true, status: 200, json: apiBody() }),
    });

    const result = await fetchRecentVideosWithSource(MEET_KEVIN);

    expect(result.via).toBe('api');
    expect(result.videos).toEqual([
      { videoId: 'api1', title: 'From API', publishedAt: expect.any(String) },
    ]);
    const apiCall = calls.find(c => c.includes('googleapis.com'));
    expect(apiCall).toContain('playlistItems');
    expect(apiCall).toContain('playlistId=UULFUvvj5lwue7PspotMDjk5UA');
    expect(apiCall).toContain('key=test-key');
  });

  it('asks the uploads playlist for a channel with no pinned feed', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    stubFetch({
      rss: () => ({ ok: false, status: 500 }),
      api: () => ({ ok: true, status: 200, json: apiBody() }),
    });

    await fetchRecentVideosWithSource({ ...MEET_KEVIN, feed: undefined });

    expect(calls.find(c => c.includes('googleapis.com'))).toContain('playlistId=UUUvvj5lwue7PspotMDjk5UA');
  });

  it('falls back when the feed request throws rather than returning a status', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      calls.push(input);
      if (input.includes('googleapis.com')) {
        return { ok: true, status: 200, json: async () => apiBody() };
      }
      throw new Error('socket hang up');
    }));

    const result = await fetchRecentVideosWithSource(MEET_KEVIN);

    expect(result.via).toBe('api');
    expect(result.videos).toHaveLength(1);
  });

  it('keeps the old behaviour and throws the RSS error when no key is configured', async () => {
    delete process.env.YOUTUBE_API_KEY;
    stubFetch({ rss: () => ({ ok: false, status: 404 }) });

    await expect(fetchRecentVideosWithSource(MEET_KEVIN)).rejects.toThrow(
      'RSS fetch failed for @MeetKevin: 404',
    );
    expect(calls.some(c => c.includes('googleapis.com'))).toBe(false);
  });

  it('names both the RSS status and the API error when the fallback also fails', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    stubFetch({
      rss: () => ({ ok: false, status: 404 }),
      api: () => ({ ok: false, status: 403, json: { error: { message: 'API key not valid' } } }),
    });

    await expect(fetchRecentVideosWithSource(MEET_KEVIN)).rejects.toThrow(
      /RSS fetch failed for @MeetKevin: 404; YouTube Data API fallback failed: playlistItems UULFUvvj5lwue7PspotMDjk5UA: API key not valid/,
    );
  });

  it('never puts the API key in the error message', async () => {
    process.env.YOUTUBE_API_KEY = 'super-secret-key';
    stubFetch({
      rss: () => ({ ok: false, status: 404 }),
      api: () => ({ ok: false, status: 400, json: { error: { message: 'bad request' } } }),
    });

    await expect(fetchRecentVideosWithSource(MEET_KEVIN)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('super-secret-key') }),
    );
  });

  it('strips the key when the transport error quotes the request URL', async () => {
    process.env.YOUTUBE_API_KEY = 'super-secret-key';
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      calls.push(input);
      if (input.includes('googleapis.com')) throw new Error(`request to ${input} failed`);
      return { ok: false, status: 404, text: async () => '' };
    }));

    const err = await fetchRecentVideosWithSource(MEET_KEVIN).catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('super-secret-key');
    expect((err as Error).message).toContain('[redacted]');
  });

  it('applies the 30-day window to Data API results too', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    stubFetch({
      rss: () => ({ ok: false, status: 404 }),
      api: () => ({
        ok: true,
        status: 200,
        json: {
          items: [
            { snippet: { title: 'Fresh' }, contentDetails: { videoId: 'new1', videoPublishedAt: recentDate() } },
            { snippet: { title: 'Stale' }, contentDetails: { videoId: 'old1', videoPublishedAt: old } },
          ],
        },
      }),
    });

    const result = await fetchRecentVideosWithSource(MEET_KEVIN);

    expect(result.videos.map(v => v.videoId)).toEqual(['new1']);
  });
});
