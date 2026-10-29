import { describe, it, expect } from 'vitest';
import { isRealTicker, topTickersByChannel, buildCommentators, commentatorMeta, initials } from '@/lib/commentators';
import type { Channel } from '@/lib/channels';

describe('isRealTicker', () => {
  it('keeps listed symbols, class shares included', () => {
    for (const s of ['A', 'NVDA', 'GOOGL', 'BRK.B', 'RDDT']) expect(isRealTicker(s)).toBe(true);
  });

  it('drops the private-company names extraction has stored', () => {
    for (const s of ['ANTHROPIC', 'OPENAI', 'NSCALE', 'SPACEX', 'WHITEFIBER', 'REDDIT']) {
      expect(isRealTicker(s)).toBe(false);
    }
  });

  it('drops anything not shaped like a symbol', () => {
    for (const s of ['', 'nvda', 'BRK.BB', 'BTC-USD', '$TSLA', 'S&P']) expect(isRealTicker(s)).toBe(false);
  });
});

describe('topTickersByChannel', () => {
  it('keeps the three most-mentioned per channel, ties alphabetical', () => {
    const top = topTickersByChannel([
      { channelId: 'a', ticker: 'MSFT', count: 5 },
      { channelId: 'a', ticker: 'META', count: 7 },
      { channelId: 'a', ticker: 'NVDA', count: 6 },
      { channelId: 'a', ticker: 'AMD', count: 5 },
      { channelId: 'b', ticker: 'TSLA', count: 1 },
    ]);
    expect(top.get('a')).toEqual([
      { ticker: 'META', count: 7 },
      { ticker: 'NVDA', count: 6 },
      { ticker: 'AMD', count: 5 },
    ]);
    expect(top.get('b')).toEqual([{ ticker: 'TSLA', count: 1 }]);
  });

  it('filters non-tickers before ranking, so they never take a slot', () => {
    const top = topTickersByChannel([
      { channelId: 'a', ticker: 'OPENAI', count: 9 },
      { channelId: 'a', ticker: 'SPACEX', count: 8 },
      { channelId: 'a', ticker: 'QQQ', count: 1 },
    ]);
    expect(top.get('a')).toEqual([{ ticker: 'QQQ', count: 1 }]);
  });
});

describe('buildCommentators', () => {
  const channels: Channel[] = [
    { id: 1, channelId: 'yt1', handle: '@one', name: 'One', weight: 0.1 },
    { id: 2, channelId: 'yt2', handle: '@two', name: 'Two', weight: 0.1 },
    { id: 3, channelId: 'ss', handle: '@ss', name: 'Sub', weight: 0.3, source: 'substack', substackHandle: 'ss' },
  ];

  it('gives every channel a card, busiest first, CHANNELS order on ties', () => {
    const cards = buildCommentators(
      channels,
      new Map([['ss', 3]]),
      [{ channelId: 'ss', ticker: 'NVDA', count: 1 }],
      new Set(['yt2']),
      new Map([['ss', 'https://img/ss.jpg'], ['yt1', null]]),
    );
    expect(cards.map(c => c.channelId)).toEqual(['ss', 'yt1', 'yt2']);
    expect(cards[0]).toEqual({
      channelId: 'ss', name: 'Sub', source: 'substack', pieces: 3,
      topTickers: [{ ticker: 'NVDA', count: 1 }], enabled: true, avatarUrl: 'https://img/ss.jpg',
    });
    expect(cards[1]).toMatchObject({ source: 'youtube', pieces: 0, topTickers: [], avatarUrl: null });
    expect(cards[2].enabled).toBe(false);
  });
});

describe('commentatorMeta', () => {
  it('counts pieces for YouTube and posts for Substack', () => {
    expect(commentatorMeta({ source: 'youtube', pieces: 28, enabled: true })).toBe('YouTube · 28 pieces');
    expect(commentatorMeta({ source: 'youtube', pieces: 1, enabled: true })).toBe('YouTube · 1 piece');
    expect(commentatorMeta({ source: 'substack', pieces: 3, enabled: true })).toBe('Substack · 3 posts');
  });

  it('says nothing new when quiet, and Paused when switched off', () => {
    expect(commentatorMeta({ source: 'youtube', pieces: 0, enabled: true })).toBe('YouTube · nothing new');
    expect(commentatorMeta({ source: 'youtube', pieces: 0, enabled: false })).toBe('YouTube · Paused');
    expect(commentatorMeta({ source: 'substack', pieces: 2, enabled: false })).toBe('Substack · 2 posts · Paused');
  });
});

describe('initials', () => {
  it('takes the first two words', () => {
    expect(initials('Meet Kevin')).toBe('MK');
    expect(initials("Bravo's Research")).toBe('BR');
    expect(initials('The Maverick of Wall Street')).toBe('TM');
  });
});
