import { describe, it, expect } from 'vitest';
import { filterItems, availableSources, isFilterActive, EMPTY_FILTER,
         type FilterableItem, type ItemFilter } from '@/lib/filters';

function item(over: Partial<FilterableItem> = {}): FilterableItem {
  return {
    title: 'Why I am buying NVDA',
    channel_name: 'Meet Kevin',
    summary: 'He likes the datacenter cycle.',
    mentions: [{ ticker: 'NVDA', sentiment: 'bullish' }],
    ...over,
  };
}

const filter = (over: Partial<ItemFilter> = {}): ItemFilter => ({ ...EMPTY_FILTER, ...over });

describe('filterItems', () => {
  const items = [
    item(),
    item({ channel_name: 'Royce Jakob', title: 'Shorting TSLA', summary: 'Deliveries missed.',
           mentions: [{ ticker: 'TSLA', sentiment: 'bearish' }] }),
    item({ channel_name: 'Mark Meldrum', title: 'Rates and the dollar', summary: 'Macro only.', mentions: [] }),
  ];

  it('returns everything with no filter', () => {
    expect(filterItems(items, EMPTY_FILTER)).toHaveLength(3);
  });

  it('filters by source', () => {
    const result = filterItems(items, filter({ source: 'Royce Jakob' }));
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Shorting TSLA');
  });

  it('filters by direction', () => {
    expect(filterItems(items, filter({ direction: 'bearish' }))).toHaveLength(1);
    expect(filterItems(items, filter({ direction: 'bullish' }))).toHaveLength(1);
  });

  it('drops items with no mentions when a direction is chosen', () => {
    const macro = filterItems(items, filter({ direction: 'bullish' }));
    expect(macro.some(i => i.title === 'Rates and the dollar')).toBe(false);
  });

  it('searches by ticker', () => {
    const result = filterItems(items, filter({ query: 'tsla' }));
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Shorting TSLA');
  });

  it('searches keywords in the title', () => {
    expect(filterItems(items, filter({ query: 'rates' }))).toHaveLength(1);
  });

  it('searches keywords in the summary', () => {
    const result = filterItems(items, filter({ query: 'datacenter' }));
    expect(result).toHaveLength(1);
    expect(result[0].channel_name).toBe('Meet Kevin');
  });

  it('ignores case and surrounding spaces', () => {
    expect(filterItems(items, filter({ query: '  NvDa  ' }))).toHaveLength(1);
  });

  it('handles an item with no summary', () => {
    const none = [item({ summary: null, title: 'x', mentions: [] })];
    expect(filterItems(none, filter({ query: 'anything' }))).toHaveLength(0);
    expect(filterItems(none, EMPTY_FILTER)).toHaveLength(1);
  });

  it('combines source, direction and search', () => {
    expect(filterItems(items, filter({ source: 'Meet Kevin', direction: 'bullish', query: 'nvda' }))).toHaveLength(1);
    expect(filterItems(items, filter({ source: 'Meet Kevin', direction: 'bearish', query: 'nvda' }))).toHaveLength(0);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterItems(items, filter({ query: 'cocoa futures' }))).toEqual([]);
  });
});

describe('availableSources', () => {
  it('lists each source once, alphabetically', () => {
    const sources = availableSources([
      item({ channel_name: 'Royce Jakob' }),
      item({ channel_name: 'Meet Kevin' }),
      item({ channel_name: 'Meet Kevin' }),
    ]);
    expect(sources).toEqual(['Meet Kevin', 'Royce Jakob']);
  });

  it('is empty for no items', () => {
    expect(availableSources([])).toEqual([]);
  });
});

describe('isFilterActive', () => {
  it('is false for the empty filter', () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
  });

  it('is true once anything is set', () => {
    expect(isFilterActive(filter({ source: 'Meet Kevin' }))).toBe(true);
    expect(isFilterActive(filter({ direction: 'bearish' }))).toBe(true);
    expect(isFilterActive(filter({ query: 'nvda' }))).toBe(true);
  });

  it('ignores a whitespace-only query', () => {
    expect(isFilterActive(filter({ query: '   ' }))).toBe(false);
  });
});
