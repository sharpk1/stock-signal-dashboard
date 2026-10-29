import { CHANNELS } from '@/lib/channels';

export type ItemKind = 'YouTube' | 'Substack video' | 'Substack article' | 'Substack' | 'Pasted';

/**
 * Where an item came from, for the label next to its source. Pasted items
 * (B10) carry the `paste-` id from `pasteItemId`; otherwise the channel's
 * source decides. Looked up by name because that's what the digest and
 * leaderboard rows carry.
 */
export function itemKind(channelName: string, videoId: string, media?: string | null): ItemKind {
  if (videoId.startsWith('paste-')) return 'Pasted';
  const channel = CHANNELS.find(c => c.name === channelName);
  if (channel?.source !== 'substack') return 'YouTube';
  // `media` is filled in by the fetch; a post it hasn't seen yet stays plain "Substack".
  if (media === 'video') return 'Substack video';
  if (media === 'article') return 'Substack article';
  return 'Substack';
}
