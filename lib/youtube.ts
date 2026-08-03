import { XMLParser } from 'fast-xml-parser';
import { YoutubeTranscript } from 'youtube-transcript';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { Channel } from '@/lib/channels';

// YouTube blocks data-center IPs, so transcript requests are routed through
// Webshare rotating residential proxies. We inject a proxied fetch into the
// youtube-transcript library via its `config.fetch` option. Falls back to a
// direct fetch when creds aren't configured (e.g. local dev).
let proxiedFetch: typeof fetch | undefined;
function getProxiedFetch(): typeof fetch | undefined {
  if (proxiedFetch) return proxiedFetch;
  const username = process.env.WEBSHARE_PROXY_USERNAME;
  const password = process.env.WEBSHARE_PROXY_PASSWORD;
  const host = process.env.WEBSHARE_PROXY_HOST ?? 'p.webshare.io';
  const port = process.env.WEBSHARE_PROXY_PORT ?? '80';
  if (!username || !password) return undefined;
  const dispatcher = new ProxyAgent(`http://${username}:${password}@${host}:${port}`);
  proxiedFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    undiciFetch(input as string, { ...init, dispatcher } as Parameters<typeof undiciFetch>[1])) as unknown as typeof fetch;
  return proxiedFetch;
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
  const fetchFn = getProxiedFetch();
  const items = await YoutubeTranscript.fetchTranscript(
    videoId,
    fetchFn ? { fetch: fetchFn } : undefined,
  );
  return items.map(item => item.text).join(' ');
}
