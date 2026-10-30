/**
 * Column sorting for the Signals leaderboard. Pure and independent of the API
 * shape so it can be tested directly, and because the rows are already in the
 * browser: picking a column is a re-sort, never another round trip.
 */

export const SORT_COLUMNS = ['channels', 'mentions', 'score'] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];
export type SortDirection = 'asc' | 'desc';

export const SORT_COLUMN_LABELS: Record<SortColumn, string> = {
  channels: 'Channels',
  mentions: 'Mentions',
  score: 'Score',
};

export interface LeaderboardSort {
  column: SortColumn;
  direction: SortDirection;
}

/** Score, highest first — the order the leaderboard query used to hand back. */
export const DEFAULT_SORT: LeaderboardSort = { column: 'score', direction: 'desc' };

/** Only the numbers the sortable headers stand for, plus the ticker tie-break. */
export interface SortableRow {
  ticker: string;
  channel_count: number;
  mention_count: number;
  normalized_score: number;
}

function valueOf(row: SortableRow, column: SortColumn): number {
  switch (column) {
    case 'channels': return row.channel_count;
    case 'mentions': return row.mention_count;
    case 'score':    return row.normalized_score;
  }
}

/**
 * Clicking the active column flips its direction; clicking a different one
 * starts that column at highest-first, which is how a leaderboard reads.
 */
export function nextSort(current: LeaderboardSort, column: SortColumn): LeaderboardSort {
  if (current.column !== column) return { column, direction: 'desc' };
  return { column, direction: current.direction === 'desc' ? 'asc' : 'desc' };
}

/**
 * Ties fall back to score and then ticker in a fixed order regardless of the
 * chosen direction, so rows that are level on the clicked column hold their
 * places instead of shuffling every time the window changes.
 */
export function sortLeaderboard<T extends SortableRow>(rows: T[], sort: LeaderboardSort): T[] {
  const sign = sort.direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const primary = valueOf(a, sort.column) - valueOf(b, sort.column);
    if (primary !== 0) return sign * primary;
    const byScore = b.normalized_score - a.normalized_score;
    if (byScore !== 0) return byScore;
    return a.ticker.localeCompare(b.ticker);
  });
}

/** aria-sort for a header cell: only the active column claims a direction. */
export function ariaSort(
  sort: LeaderboardSort,
  column: SortColumn,
): 'ascending' | 'descending' | 'none' {
  if (sort.column !== column) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

export const SORT_STORAGE_KEY = 'stock-signals-leaderboard-sort';

/** Stored sorts outlive deploys and are hand-editable, so validate before use. */
export function parseSort(raw: string | null): LeaderboardSort {
  if (!raw) return DEFAULT_SORT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SORT;
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SORT;
  const { column, direction } = parsed as { column?: unknown; direction?: unknown };
  if (!SORT_COLUMNS.includes(column as SortColumn)) return DEFAULT_SORT;
  if (direction !== 'asc' && direction !== 'desc') return DEFAULT_SORT;
  return { column: column as SortColumn, direction };
}

/** Remembering the choice is a convenience: blocked storage just means default. */
export function loadSort(): LeaderboardSort {
  try {
    return parseSort(localStorage.getItem(SORT_STORAGE_KEY));
  } catch {
    return DEFAULT_SORT;
  }
}

export function saveSort(sort: LeaderboardSort): void {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort));
  } catch {
    /* storage blocked */
  }
}
