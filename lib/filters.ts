/**
 * Filtering for the item feed. Pure and independent of the API shape so it can
 * be tested directly, and so the same rules could be reused by another view.
 */

export const DIRECTIONS = ['all', 'bullish', 'bearish', 'neutral'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIRECTION_LABELS: Record<Direction, string> = {
  all: 'Any direction',
  bullish: 'Bullish',
  bearish: 'Bearish',
  neutral: 'Neutral',
};

export interface FilterableItem {
  title: string;
  channel_name: string;
  summary: string | null;
  mentions: { ticker: string; sentiment: string }[];
}

export interface ItemFilter {
  /** A channel name, or 'all'. */
  source: string;
  direction: Direction;
  /** A ticker or a keyword; matched case-insensitively. */
  query: string;
}

export const EMPTY_FILTER: ItemFilter = { source: 'all', direction: 'all', query: '' };

export function isFilterActive(filter: ItemFilter): boolean {
  return filter.source !== 'all' || filter.direction !== 'all' || filter.query.trim() !== '';
}

function matchesQuery(item: FilterableItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  // A ticker is the most likely thing being typed, so check those first; then
  // fall back to the words of the title and summary.
  if (item.mentions.some(m => m.ticker.toLowerCase().includes(needle))) return true;
  if (item.title.toLowerCase().includes(needle)) return true;
  return (item.summary ?? '').toLowerCase().includes(needle);
}

export function filterItems<T extends FilterableItem>(items: T[], filter: ItemFilter): T[] {
  return items.filter(item => {
    if (filter.source !== 'all' && item.channel_name !== filter.source) return false;
    // Direction is a property of what was said about a ticker, so an item counts
    // when any of its mentions leans that way.
    if (filter.direction !== 'all' && !item.mentions.some(m => m.sentiment === filter.direction)) {
      return false;
    }
    return matchesQuery(item, filter.query);
  });
}

/** The sources actually present, so the picker never offers an empty filter. */
export function availableSources(items: FilterableItem[]): string[] {
  return [...new Set(items.map(item => item.channel_name))].sort((a, b) => a.localeCompare(b));
}
