/**
 * The Fetch Latest button can't carry CRON_SECRET — anything the browser sends,
 * a visitor can read — so the manual route is open and a cooldown stands in for
 * the secret. Each fetch spends Anthropic credit, so the thing to stop is
 * someone hammering the button, not someone pressing it.
 */
export const FETCH_COOLDOWN_MINUTES = 10;

/** SQLite `datetime('now')` is UTC with no zone marker: "2026-10-29 19:42:05". */
function parseSqliteUtc(value: string): number {
  return new Date(`${value.replace(' ', 'T')}Z`).getTime();
}

/**
 * Minutes left before another fetch may start, or 0 if one can start now.
 * `lastRunAt` is the newest `source_runs.ran_at` — scheduled and manual runs
 * both write there, so a fetch that just ran (or is still running) counts.
 */
export function cooldownMinutesLeft(
  lastRunAt: string | null,
  now: number = Date.now(),
  cooldownMinutes: number = FETCH_COOLDOWN_MINUTES,
): number {
  if (!lastRunAt) return 0;
  const last = parseSqliteUtc(lastRunAt);
  if (Number.isNaN(last)) return 0;
  const leftMs = last + cooldownMinutes * 60_000 - now;
  return leftMs > 0 ? Math.ceil(leftMs / 60_000) : 0;
}
