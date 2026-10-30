import { CHANNELS } from '@/lib/channels';
import { parseXItemId, xPostUrl } from '@/lib/x';

/**
 * Public link for one stored item. Substack posts live at the publication, not
 * on YouTube, so the channel decides the shape — the same split
 * `lib/fetch-pipeline.ts` makes when it records a video's url. X posts carry
 * their handle in the item id, since X accounts aren't in CHANNELS.
 */
export function itemUrl(channelId: string, videoId: string): string {
  const post = parseXItemId(videoId);
  if (post) return xPostUrl(post.handle, post.postId);
  const channel = CHANNELS.find(c => c.channelId === channelId);
  if (channel?.source === 'substack') {
    return `https://${channel.substackHandle}.substack.com/p/${videoId}`;
  }
  return `https://youtube.com/watch?v=${videoId}`;
}
