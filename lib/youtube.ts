import { XMLParser } from 'fast-xml-parser';
import { YoutubeTranscript } from 'youtube-transcript';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { Channel, ChannelFeed } from '@/lib/channels';

// YouTube blocks data-center IPs, so transcript requests are routed through
// Webshare rotating residential proxies. We inject a proxied fetch into the
// youtube-transcript library via its `config.fetch` option. Falls back to a
// direct fetch when creds aren't configured (e.g. local dev).
//
// Each call builds a FRESH ProxyAgent so a retry gets a new rotating exit IP —
// Webshare rotates per connection, and YouTube serves empty caption tracks from
// some flagged IPs, so a single attempt is unreliable. Retrying with new IPs is
// what makes transcript fetching work reliably from a data center (Vercel).
function buildProxiedFetch(): typeof fetch | undefined {
  const username = process.env.WEBSHARE_PROXY_USERNAME;
  const password = process.env.WEBSHARE_PROXY_PASSWORD;
  const host = process.env.WEBSHARE_PROXY_HOST ?? 'p.webshare.io';
  const port = process.env.WEBSHARE_PROXY_PORT ?? '80';
  if (!username || !password) return undefined;
  const dispatcher = new ProxyAgent(`http://${username}:${password}@${host}:${port}`);
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    undiciFetch(input as string, { ...init, dispatcher } as Parameters<typeof undiciFetch>[1])) as unknown as typeof fetch;
}

/**
 * YouTube keeps a system playlist per upload type, each id being the channel id
 * with the `UC` prefix swapped for a type prefix (the same trick that turns
 * `UC…` into the `UU…` uploads playlist):
 *
 *   UULV — completed livestreams
 *   UULF — regular long-form uploads
 *
 * Each excludes the other types, Shorts included. This is the only reliable way
 * to filter a channel down to one kind of upload: the RSS feed carries no
 * duration or video-type field.
 */
const FEED_PLAYLIST_PREFIX: Record<ChannelFeed, string> = {
  streams: 'UULV',
  longform: 'UULF',
};

export function feedPlaylistId(channelId: string, feed: ChannelFeed): string {
  if (!channelId.startsWith('UC')) {
    throw new Error(`cannot derive a ${feed} playlist from channel id "${channelId}" (expected a UC… id)`);
  }
  return `${FEED_PLAYLIST_PREFIX[feed]}${channelId.slice(2)}`;
}

/**
 * The `UU…` uploads playlist — every upload of every type, the same set the
 * channel-wide RSS feed carries. Used for a channel with no pinned feed.
 */
export function uploadsPlaylistId(channelId: string): string {
  if (!channelId.startsWith('UC')) {
    throw new Error(`cannot derive an uploads playlist from channel id "${channelId}" (expected a UC… id)`);
  }
  return `UU${channelId.slice(2)}`;
}

/** The playlist that mirrors whatever `channelFeedUrl` would ask RSS for. */
export function channelPlaylistId(channel: Channel): string {
  return channel.feed
    ? feedPlaylistId(channel.channelId, channel.feed)
    : uploadsPlaylistId(channel.channelId);
}

export function channelFeedUrl(channel: Channel): string {
  if (channel.feed) {
    return `https://www.youtube.com/feeds/videos.xml?playlist_id=${feedPlaylistId(channel.channelId, channel.feed)}`;
  }
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`;
}

export interface RssVideo {
  videoId: string;
  title: string;
  publishedAt: string;
}

export function parseRssFeed(xml: string): RssVideo[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const result = parser.parse(xml);
  const feed = result?.feed;
  if (!feed?.entry) return [];

  const entries = Array.isArray(feed.entry) ? feed.entry : [feed.entry];
  return entries.map((entry: Record<string, string>) => ({
    videoId: entry['yt:videoId'],
    title: entry.title,
    publishedAt: entry.published,
  }));
}

/**
 * How far back a pull reaches. The window and the log line that reports it read
 * from the same constant on purpose — they drifted apart once already (the log
 * claimed 3 days while the cutoff was 30).
 */
const FETCH_WINDOW_DAYS = 30;

function withinWindow(videos: RssVideo[], now: number = Date.now()): RssVideo[] {
  const cutoff = now - FETCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return videos.filter(v => new Date(v.publishedAt).getTime() >= cutoff);
}

/** Which of the two upload listings a pull actually came from. */
export type VideoSource = 'rss' | 'api';

export interface RecentVideos {
  videos: RssVideo[];
  via: VideoSource;
}

const SOURCE_LABEL: Record<VideoSource, string> = {
  rss: 'RSS',
  api: 'YouTube Data API',
};

const PLAYLIST_ITEMS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/playlistItems';

/** Matches the RSS feeds, which carry 15 entries. */
const API_MAX_RESULTS = 15;

interface PlaylistItemsBody {
  items?: Array<{
    snippet?: { title?: string; publishedAt?: string };
    contentDetails?: { videoId?: string; videoPublishedAt?: string };
  }>;
  error?: { message?: string };
}

/**
 * `playlistItems` carries the publish date twice: `snippet.publishedAt` is when
 * the video was added to the playlist, `contentDetails.videoPublishedAt` when
 * the video itself went public. The latter is what RSS reports, so prefer it.
 */
export function parsePlaylistItems(body: PlaylistItemsBody): RssVideo[] {
  return (body.items ?? [])
    .map(item => ({
      videoId: item.contentDetails?.videoId ?? '',
      title: item.snippet?.title ?? '',
      publishedAt: item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt ?? '',
    }))
    .filter(v => v.videoId);
}

/**
 * The key travels in the query string, so the URL must never reach an error
 * message or a log line — errors name the playlist instead. Some fetch
 * implementations put the failing URL in their own message, so anything on its
 * way out of here gets the key stripped as a backstop.
 */
async function fetchViaDataApi(channel: Channel, apiKey: string): Promise<RssVideo[]> {
  const playlistId = channelPlaylistId(channel);
  const url =
    `${PLAYLIST_ITEMS_ENDPOINT}?part=snippet,contentDetails&maxResults=${API_MAX_RESULTS}` +
    `&playlistId=${encodeURIComponent(playlistId)}&key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const body = (await res.json().catch(() => null)) as PlaylistItemsBody | null;
    if (!res.ok) {
      throw new Error(`playlistItems ${playlistId}: ${body?.error?.message ?? `HTTP ${res.status}`}`);
    }
    return parsePlaylistItems(body ?? {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(redactKey(message, apiKey));
  }
}

function redactKey(message: string, apiKey: string): string {
  return apiKey ? message.split(apiKey).join('[redacted]') : message;
}

/**
 * Recent uploads for a channel, and which listing they came from.
 *
 * YouTube's public RSS feed goes down for everyone every so often — 404/500 on
 * every channel, Google's own included (2021, 2024, Dec 2025, Feb 2026, and
 * again 2026-10-29, when it returned 0 videos across all channels). The Data
 * API serves the same system playlists and stays up through those outages, so
 * it backs the feed up rather than replacing it: RSS costs no quota, so it
 * stays the primary.
 *
 * With no `YOUTUBE_API_KEY` configured there is nothing to fall back to, so the
 * RSS failure propagates unchanged.
 */
export async function fetchRecentVideosWithSource(channel: Channel): Promise<RecentVideos> {
  const report = (videos: RssVideo[], via: VideoSource): RecentVideos => {
    console.log(
      `[${channel.name}] ${videos.length} new video(s) in last ${FETCH_WINDOW_DAYS} days ` +
      `(via ${SOURCE_LABEL[via]})`,
    );
    return { videos, via };
  };

  let rssFailure: Error;
  try {
    const res = await fetch(channelFeedUrl(channel));
    if (res.ok) return report(withinWindow(parseRssFeed(await res.text())), 'rss');
    rssFailure = new Error(`RSS fetch failed for ${channel.handle}: ${res.status}`);
  } catch (err) {
    rssFailure = err instanceof Error ? err : new Error(String(err));
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw rssFailure;

  console.warn(`[${channel.name}] ${rssFailure.message} — falling back to the YouTube Data API`);
  try {
    return report(withinWindow(await fetchViaDataApi(channel, apiKey)), 'api');
  } catch (err) {
    throw new Error(
      `${rssFailure.message}; YouTube Data API fallback failed: ` +
      `${err instanceof Error ? err.message : err}`,
    );
  }
}

export async function fetchRecentVideos(channel: Channel): Promise<RssVideo[]> {
  return (await fetchRecentVideosWithSource(channel)).videos;
}

/**
 * Read the caption-track languages back off a
 * `YoutubeTranscriptNotAvailableLanguageError`. The library matches `lang`
 * exactly and gives us no other way to see which tracks a video actually has,
 * but it does list them in that error's message. Returns null for any other
 * error, so callers can tell "wrong language" from "no captions at all".
 */
export function availableLangsFromError(err: unknown): string[] | null {
  const msg = err instanceof Error ? err.message : '';
  const match = /Available languages:\s*(.*)$/.exec(msg);
  if (!match) return null;
  return match[1].split(',').map(l => l.trim()).filter(Boolean);
}

/**
 * Pick the best English caption track: plain `en` if present, otherwise a
 * regional variant such as `en-US` or `en-GB`. Returns undefined when a video
 * has captions but none in English, so we skip it rather than summarising a
 * dubbed or translated track.
 */
export function pickEnglishLang(availableLangs: string[]): string | undefined {
  return (
    availableLangs.find(l => l.toLowerCase() === 'en') ??
    availableLangs.find(l => l.toLowerCase().startsWith('en'))
  );
}

export async function fetchTranscript(videoId: string): Promise<string> {
  const useProxy = Boolean(process.env.WEBSHARE_PROXY_USERNAME && process.env.WEBSHARE_PROXY_PASSWORD);
  // Behind the rotating proxy, retry so each attempt draws a fresh exit IP;
  // some IPs return empty caption tracks even when a transcript exists.
  const maxAttempts = useProxy ? 3 : 1;
  let lastErr: unknown = new Error('no transcript');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const fetchFn = buildProxiedFetch();
    const config = (lang: string) => ({ lang, ...(fetchFn ? { fetch: fetchFn } : {}) });
    try {
      let items;
      try {
        items = await YoutubeTranscript.fetchTranscript(videoId, config('en'));
      } catch (err) {
        // No exact `en` track. If the video has English under a regional code,
        // take that; if it has captions but none English, don't fall back to
        // another language.
        const langs = availableLangsFromError(err);
        if (!langs) throw err;
        const english = pickEnglishLang(langs);
        if (!english) {
          throw new Error(
            `no English captions for ${videoId} (available: ${langs.join(', ') || 'none'})`,
          );
        }
        items = await YoutubeTranscript.fetchTranscript(videoId, config(english));
      }
      const text = items.map(item => item.text).join(' ');
      if (text.trim().length > 0) return text;
      lastErr = new Error('empty transcript');
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
