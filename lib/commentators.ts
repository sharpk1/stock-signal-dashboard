import type { Channel } from '@/lib/channels';

/** One channel's card on the Signals tab. */
export interface Commentator {
  channelId: string;
  name: string;
  source: 'youtube' | 'substack' | 'x';
  /** Items published inside the window. */
  pieces: number;
  /** Most-mentioned tickers in the window; `count` is items mentioning it. */
  topTickers: { ticker: string; count: number }[];
  enabled: boolean;
  avatarUrl: string | null;
}

/** One (channel, ticker) pair and how many items in the window mention it. */
export interface TickerCountRow {
  channelId: string;
  ticker: string;
  count: number;
}

/**
 * Extraction sometimes stores a private company under its name — ANTHROPIC,
 * OPENAI, NSCALE, SPACEX, WHITEFIBER — or spells out a listed one (REDDIT
 * instead of RDDT). A US symbol is one to five letters with an optional class
 * suffix (BRK.B), and every one of those names is longer, so the shape alone
 * keeps them off the cards. A four-letter private name would slip through;
 * that's the trade for not keeping a list. This only hides them here: the
 * stored mentions and the extraction are untouched.
 */
const TICKER_SHAPE = /^[A-Z]{1,5}(\.[A-Z])?$/;

export function isRealTicker(symbol: string): boolean {
  return TICKER_SHAPE.test(symbol);
}

/**
 * The `limit` most-mentioned real tickers per channel. Ties break
 * alphabetically, so the cards don't reshuffle between loads.
 */
export function topTickersByChannel(
  rows: TickerCountRow[],
  limit: number = 3,
): Map<string, { ticker: string; count: number }[]> {
  const byChannel = new Map<string, { ticker: string; count: number }[]>();
  for (const row of rows) {
    if (!isRealTicker(row.ticker)) continue;
    const list = byChannel.get(row.channelId) ?? [];
    list.push({ ticker: row.ticker, count: row.count });
    byChannel.set(row.channelId, list);
  }
  for (const [channelId, list] of byChannel) {
    list.sort((a, b) => b.count - a.count || a.ticker.localeCompare(b.ticker));
    byChannel.set(channelId, list.slice(0, limit));
  }
  return byChannel;
}

/**
 * One card per configured channel, busiest first. CHANNELS order breaks ties
 * (Array.prototype.sort is stable), so quiet channels keep a fixed order.
 */
export function buildCommentators(
  channels: Channel[],
  pieces: Map<string, number>,
  tickerRows: TickerCountRow[],
  disabled: Set<string>,
  avatars: Map<string, string | null>,
): Commentator[] {
  const top = topTickersByChannel(tickerRows);
  return channels
    .map(ch => ({
      channelId: ch.channelId,
      name: ch.name,
      source: ch.source ?? 'youtube',
      pieces: pieces.get(ch.channelId) ?? 0,
      topTickers: top.get(ch.channelId) ?? [],
      enabled: !disabled.has(ch.channelId),
      avatarUrl: avatars.get(ch.channelId) ?? null,
    }))
    .sort((a, b) => b.pieces - a.pieces);
}

/** "YouTube · 28 pieces", "Substack · 1 post", "X · 12 posts", "YouTube · nothing new", "… · Paused". */
export function commentatorMeta(c: Pick<Commentator, 'source' | 'pieces' | 'enabled'>): string {
  const label = c.source === 'substack' ? 'Substack' : c.source === 'x' ? 'X' : 'YouTube';
  const noun = c.source === 'youtube' ? 'piece' : 'post';
  const parts = [label];
  if (c.pieces > 0) parts.push(`${c.pieces} ${noun}${c.pieces === 1 ? '' : 's'}`);
  else if (c.enabled) parts.push('nothing new');
  if (!c.enabled) parts.push('Paused');
  return parts.join(' · ');
}

/** Up to two initials for the avatar fallback: "Meet Kevin" → "MK". */
export function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map(w => w[0].toUpperCase()).join('');
}
