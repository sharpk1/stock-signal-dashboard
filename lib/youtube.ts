import { XMLParser } from 'fast-xml-parser';
import { YoutubeTranscript } from 'youtube-transcript';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { Channel } from '@/lib/channels';

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
 * YouTube exposes a channel's completed live streams as a system playlist whose
 * id is the channel id with the `UC` prefix swapped for `UULV` (the same trick
 * that turns `UC…` into the `UU…` uploads playlist). That playlist holds only
 * finished streams — no Shorts, no regular uploads — which is the only reliable
 * way to filter them out, since the RSS feed carries no duration or type field.
 */
export function liveStreamsPlaylistId(channelId: string): string {
  if (!channelId.startsWith('UC')) {
    throw new Error(`cannot derive a streams playlist from channel id "${channelId}" (expected a UC… id)`);
  }
  return `UULV${channelId.slice(2)}`;
}

export function channelFeedUrl(channel: Channel): string {
  if (channel.streamsOnly) {
    return `https://www.youtube.com/feeds/videos.xml?playlist_id=${liveStreamsPlaylistId(channel.channelId)}`;
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

export async function fetchRecentVideos(channel: Channel): Promise<RssVideo[]> {
  const url = channelFeedUrl(channel);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`RSS fetch failed for ${channel.handle}: ${res.status}`);
  const xml = await res.text();
  const all = parseRssFeed(xml);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = all.filter(v => new Date(v.publishedAt).getTime() >= cutoff);
  console.log(`[${channel.name}] ${recent.length} new video(s) in last 3 days`);
  return recent;
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
