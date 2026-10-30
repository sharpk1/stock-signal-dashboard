import { describe, it, expect } from 'vitest';
import {
  sortLeaderboard, nextSort, ariaSort, parseSort,
  DEFAULT_SORT, SORT_COLUMNS,
  type LeaderboardSort, type SortableRow,
} from '@/lib/leaderboard-sort';

function row(over: Partial<SortableRow> = {}): SortableRow {
  return { ticker: 'NVDA', channel_count: 2, mention_count: 3, normalized_score: 70, ...over };
}

const sort = (over: Partial<LeaderboardSort> = {}): LeaderboardSort => ({ ...DEFAULT_SORT, ...over });

const tickers = (rows: SortableRow[]) => rows.map(r => r.ticker);

describe('sortLeaderboard', () => {
  const rows = [
    row({ ticker: 'AAPL', channel_count: 1, mention_count: 9, normalized_score: 40 }),
    row({ ticker: 'TSLA', channel_count: 4, mention_count: 4, normalized_score: 60 }),
    row({ ticker: 'NVDA', channel_count: 2, mention_count: 2, normalized_score: 90 }),
  ];

  it('defaults to score, highest first', () => {
    expect(tickers(sortLeaderboard(rows, DEFAULT_SORT))).toEqual(['NVDA', 'TSLA', 'AAPL']);
  });

  it('sorts by channels, highest first', () => {
    expect(tickers(sortLeaderboard(rows, sort({ column: 'channels' })))).toEqual(['TSLA', 'NVDA', 'AAPL']);
  });

  it('sorts by mentions, highest first', () => {
    expect(tickers(sortLeaderboard(rows, sort({ column: 'mentions' })))).toEqual(['AAPL', 'TSLA', 'NVDA']);
  });

  it('reverses each column when the direction flips', () => {
    for (const column of SORT_COLUMNS) {
      const desc = tickers(sortLeaderboard(rows, sort({ column, direction: 'desc' })));
      const asc = tickers(sortLeaderboard(rows, sort({ column, direction: 'asc' })));
      expect(asc).toEqual([...desc].reverse());
    }
  });

  it('breaks ties on score, then ticker', () => {
    const tied = [
      row({ ticker: 'MSFT', channel_count: 3, normalized_score: 50 }),
      row({ ticker: 'AMD', channel_count: 3, normalized_score: 80 }),
      row({ ticker: 'ABNB', channel_count: 3, normalized_score: 50 }),
    ];
    expect(tickers(sortLeaderboard(tied, sort({ column: 'channels' }))))
      .toEqual(['AMD', 'ABNB', 'MSFT']);
  });

  it('keeps the tie-break order when the direction flips', () => {
    const tied = [
      row({ ticker: 'MSFT', mention_count: 5, normalized_score: 50 }),
      row({ ticker: 'AMD', mention_count: 5, normalized_score: 80 }),
      row({ ticker: 'ABNB', mention_count: 5, normalized_score: 50 }),
    ];
    const order = ['AMD', 'ABNB', 'MSFT'];
    expect(tickers(sortLeaderboard(tied, sort({ column: 'mentions', direction: 'desc' })))).toEqual(order);
    expect(tickers(sortLeaderboard(tied, sort({ column: 'mentions', direction: 'asc' })))).toEqual(order);
  });

  it('leaves the caller’s array alone', () => {
    const input = [...rows];
    sortLeaderboard(input, sort({ column: 'channels' }));
    expect(tickers(input)).toEqual(['AAPL', 'TSLA', 'NVDA']);
  });

  it('handles empty and single-row boards', () => {
    expect(sortLeaderboard([], DEFAULT_SORT)).toEqual([]);
    expect(tickers(sortLeaderboard([row({ ticker: 'KO' })], DEFAULT_SORT))).toEqual(['KO']);
  });
});

describe('nextSort', () => {
  it('flips the direction of the active column', () => {
    expect(nextSort(sort({ column: 'score', direction: 'desc' }), 'score'))
      .toEqual({ column: 'score', direction: 'asc' });
    expect(nextSort(sort({ column: 'score', direction: 'asc' }), 'score'))
      .toEqual({ column: 'score', direction: 'desc' });
  });

  it('starts a newly picked column at highest first', () => {
    expect(nextSort(sort({ column: 'score', direction: 'asc' }), 'mentions'))
      .toEqual({ column: 'mentions', direction: 'desc' });
  });
});

describe('ariaSort', () => {
  it('reports a direction only for the active column', () => {
    const current = sort({ column: 'mentions', direction: 'asc' });
    expect(ariaSort(current, 'mentions')).toBe('ascending');
    expect(ariaSort(current, 'channels')).toBe('none');
    expect(ariaSort(sort({ column: 'mentions' }), 'mentions')).toBe('descending');
  });
});

describe('parseSort', () => {
  it('round-trips a stored sort', () => {
    const stored: LeaderboardSort = { column: 'channels', direction: 'asc' };
    expect(parseSort(JSON.stringify(stored))).toEqual(stored);
  });

  it('falls back to the default on anything unusable', () => {
    for (const raw of [null, '', 'not json', '[]', 'null', '"score"',
                       '{"column":"sentiment","direction":"desc"}',
                       '{"column":"score","direction":"sideways"}',
                       '{"column":"score"}', '{}']) {
      expect(parseSort(raw)).toEqual(DEFAULT_SORT);
    }
  });
});
