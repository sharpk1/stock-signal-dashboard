import { XMLParser } from 'fast-xml-parser';
import { YoutubeTranscript } from 'youtube-transcript';
import { Channel } from '@/lib/channels';

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
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return all.filter(v => new Date(v.publishedAt).getTime() >= cutoff);
}

export async function fetchTranscript(videoId: string): Promise<string> {
  const items = await YoutubeTranscript.fetchTranscript(videoId);
  return items.map(item => item.text).join(' ');
}
