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
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`RSS fetch failed for ${channel.handle}: ${res.status}`);
  const xml = await res.text();
  const all = parseRssFeed(xml);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = all.filter(v => new Date(v.publishedAt).getTime() >= cutoff);
  console.log(`[${channel.name}] ${recent.length} new video(s) in last 3 days`);
  return recent;
}

export async function fetchTranscript(videoId: string): Promise<string> {
  const useProxy = Boolean(process.env.WEBSHARE_PROXY_USERNAME && process.env.WEBSHARE_PROXY_PASSWORD);
  // Behind the rotating proxy, retry so each attempt draws a fresh exit IP;
  // some IPs return empty caption tracks even when a transcript exists.
  const maxAttempts = useProxy ? 5 : 1;
  let lastErr: unknown = new Error('no transcript');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const fetchFn = buildProxiedFetch();
    try {
      const items = await YoutubeTranscript.fetchTranscript(
        videoId,
        fetchFn ? { fetch: fetchFn } : undefined,
      );
      const text = items.map(item => item.text).join(' ');
      if (text.trim().length > 0) return text;
      lastErr = new Error('empty transcript');
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
