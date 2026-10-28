import { describe, it, expect } from 'vitest';
import { maxTranscriptAttempts } from '@/lib/fetch-pipeline';
import type { Channel } from '@/lib/channels';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-28T12:00:00Z');

const streamChannel: Channel = {
  id: 3,
  channelId: 'UCS01CiRDAiyhR_mTHXDW23A',
  handle: '@DumbMoneyLive',
  name: 'Dumb Money Live',
  weight: 0.1,
  feed: 'streams',
};

const longFormChannel: Channel = {
  id: 9,
  channelId: 'UCUvvj5lwue7PspotMDjk5UA',
  handle: '@MeetKevin',
  name: 'Meet Kevin',
  weight: 0.1,
  feed: 'longform',
};

const normalChannel: Channel = {
  id: 1,
  channelId: 'UCnMn36GT_H0X-w5_ckLtlgQ',
  handle: '@FinancialEducation',
  name: 'Financial Education',
  weight: 0.1,
};

function publishedHoursAgo(hours: number): string {
  return new Date(NOW - hours * HOUR).toISOString();
}

describe('maxTranscriptAttempts', () => {
  it('keeps retrying a fresh stream while its captions may still be coming', () => {
    expect(maxTranscriptAttempts(streamChannel, publishedHoursAgo(6), NOW)).toBe(12);
  });

  it('still retries a stream at the edge of the caption-lag window', () => {
    expect(maxTranscriptAttempts(streamChannel, publishedHoursAgo(47), NOW)).toBe(12);
  });

  it('gives up on the normal schedule once a stream is past the window', () => {
    expect(maxTranscriptAttempts(streamChannel, publishedHoursAgo(72), NOW)).toBe(3);
  });

  it('leaves normal uploads on three attempts', () => {
    expect(maxTranscriptAttempts(normalChannel, publishedHoursAgo(1), NOW)).toBe(3);
  });

  it('leaves a long-form-only channel on three attempts — caption lag is a livestream problem', () => {
    expect(maxTranscriptAttempts(longFormChannel, publishedHoursAgo(1), NOW)).toBe(3);
  });

  it('falls back to three attempts for an unparseable publish date', () => {
    expect(maxTranscriptAttempts(streamChannel, 'not a date', NOW)).toBe(3);
  });
});
