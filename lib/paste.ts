import { createHash } from 'crypto';

/**
 * Meet Kevin's Alpha reports and member livestreams sit behind a login the
 * fetcher can't hold, so Ray pastes them in by hand. A pasted item is stored as
 * an ordinary item and summarised like any other — only its origin differs.
 */
export const PASTE_TYPES = ['alpha-report', 'livestream-transcript'] as const;
export type PasteType = (typeof PASTE_TYPES)[number];

export const PASTE_TYPE_LABELS: Record<PasteType, string> = {
  'alpha-report': 'Alpha report',
  'livestream-transcript': 'Livestream transcript',
};

/** Short enough to catch a stray paste, long enough to pass a real report. */
export const MIN_PASTE_CHARS = 200;

export function isPasteType(value: unknown): value is PasteType {
  return typeof value === 'string' && (PASTE_TYPES as readonly string[]).includes(value);
}

/**
 * Identity is the text itself, so pasting the same report twice lands on the
 * same row instead of creating a second copy. Whitespace is normalised first —
 * a re-copy often differs only in line endings or trailing spaces.
 */
export function pasteItemId(text: string): string {
  const normalised = text.replace(/\s+/g, ' ').trim();
  return `paste-${createHash('sha256').update(normalised).digest('hex').slice(0, 16)}`;
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function pasteTitle(type: PasteType, date: string, provided?: string): string {
  const given = provided?.trim();
  if (given) return given.slice(0, 200);
  return `${PASTE_TYPE_LABELS[type]} — ${date}`;
}

export interface PasteInput {
  type: PasteType;
  date: string;
  text: string;
  title: string;
}

/**
 * Validates one paste, returning either the normalised item or the reason it
 * was rejected, so the route stays a thin wrapper around this.
 */
export function parsePaste(
  body: { type?: unknown; date?: unknown; text?: unknown; title?: unknown },
  now: Date = new Date(),
): { ok: true; value: PasteInput } | { ok: false; error: string } {
  if (!isPasteType(body.type)) {
    return { ok: false, error: `type must be one of: ${PASTE_TYPES.join(', ')}` };
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < MIN_PASTE_CHARS) {
    return { ok: false, error: `text is too short — paste at least ${MIN_PASTE_CHARS} characters` };
  }

  const rawDate = typeof body.date === 'string' && body.date.trim() ? body.date.trim() : todayIso(now);
  if (!isIsoDate(rawDate)) {
    return { ok: false, error: 'date must be a calendar date in YYYY-MM-DD form' };
  }

  const title = typeof body.title === 'string' ? body.title : undefined;
  return { ok: true, value: { type: body.type, date: rawDate, text, title: pasteTitle(body.type, rawDate, title) } };
}
