import { describe, it, expect } from 'vitest';
import { CHANNELS } from '@/lib/channels';
import { channelFeedUrl } from '@/lib/youtube';

describe('CHANNELS', () => {
  it('gives every channel a unique id', () => {
    const ids = CHANNELS.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every channel a unique channelId', () => {
    const ids = CHANNELS.map(c => c.channelId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('pins the B1 channels to the long-form feed so Shorts are skipped', () => {
    for (const handle of ['@FinancialEducation', '@bravosresearch', '@jeremylefebvremakesmoney7934']) {
      const channel = CHANNELS.find(c => c.handle === handle);
      expect(channel, `${handle} is missing from CHANNELS`).toBeDefined();
      expect(channel!.feed).toBe('longform');
      expect(channelFeedUrl(channel!)).toContain('playlist_id=UULF');
    }
  });

  it('can build a feed url for every YouTube channel', () => {
    for (const channel of CHANNELS.filter(c => c.source !== 'substack')) {
      expect(() => channelFeedUrl(channel)).not.toThrow();
    }
  });
});
