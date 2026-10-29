import { CHANNELS } from '@/lib/channels';

export type ItemKind = 'YouTube' | 'Substack' | 'Pasted';

/**
 * Where an item came from, for the label next to its source. Pasted items
 * (B10) carry the `paste-` id from `pasteItemId`; otherwise the channel's
 * source decides. Looked up by name because that's what the digest and
 * leaderboard rows carry.
 */
export function itemKind(channelName: string, videoId: string): ItemKind {
  if (videoId.startsWith('paste-')) return 'Pasted';
  const channel = CHANNELS.find(c => c.name === channelName);
  return channel?.source === 'substack' ? 'Substack' : 'YouTube';
}
