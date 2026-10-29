import type { Client } from '@libsql/client';
import type { Channel } from '@/lib/channels';
import { getAvatarStates, saveAvatar } from '@/lib/db';

/**
 * Channel avatars are hotlinked, never downloaded: only the URL is stored. A
 * profile picture rarely changes, so each channel is looked up at most once a
 * week, and every failure is swallowed — a missing picture falls back to
 * initials and must never fail a fetch run.
 */
export const AVATAR_REFRESH_DAYS = 7;
const REQUEST_TIMEOUT_MS = 10_000;

/** SQLite `datetime('now')` is UTC with no zone marker: "2026-10-29 19:42:05". */
function parseSqliteUtc(value: string): number {
  return new Date(`${value.replace(' ', 'T')}Z`).getTime();
}

export function avatarNeedsRefresh(
  checkedAt: string | null,
  now: number = Date.now(),
  refreshDays: number = AVATAR_REFRESH_DAYS,
): boolean {
  if (!checkedAt) return true;
  const last = parseSqliteUtc(checkedAt);
  if (Number.isNaN(last)) return true;
  return now - last >= refreshDays * 24 * 60 * 60 * 1000;
}

interface ChannelsListBody {
  items?: {
    id?: string;
    snippet?: { thumbnails?: Record<string, { url?: string } | undefined> };
  }[];
  error?: { message?: string };
}

/** channelId → thumbnail URL, preferring the 240px "medium" size. */
export function parseYouTubeAvatars(body: ChannelsListBody): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of body.items ?? []) {
    const thumbs = item.snippet?.thumbnails;
    const url = thumbs?.medium?.url ?? thumbs?.default?.url;
    if (item.id && url) out.set(item.id, url);
  }
  return out;
}

/**
 * Substack embeds the publication in the homepage as JSON, so the author's
 * photo is a plain `"author_photo_url":"…"` string; the publication logo is the
 * fallback. The page escapes some of it (`/`, `\"`), hence the JSON.parse
 * of the captured literal rather than using it raw.
 */
export function parseSubstackPhotoUrl(html: string): string | null {
  for (const key of ['author_photo_url', 'logo_url']) {
    // Either raw JSON or JSON inside an escaped string (`\"key\":\"…\"`).
    const match =
      html.match(new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`)) ??
      html.match(new RegExp(`\\\\"${key}\\\\"\\s*:\\s*\\\\"(.*?)\\\\"`));
    if (!match) continue;
    let value: string;
    try {
      value = match[0].startsWith('\\') ? match[1] : (JSON.parse(match[1]) as string);
    } catch {
      continue;
    }
    value = value.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
    if (/^https?:\/\//.test(value)) return value;
  }
  return null;
}

/**
 * Author photos are uploaded at full size (6000px+); have Substack's CDN crop
 * and shrink it. The page usually hands back a CDN URL already (full size),
 * so unwrap that to the original first rather than nesting one fetch in another.
 */
export function substackAvatarUrl(photoUrl: string): string {
  const wrapped = photoUrl.match(/^https:\/\/substackcdn\.com\/image\/fetch\/[^/]+\/(https?%3A.+)$/i);
  let original = photoUrl;
  if (wrapped) {
    try {
      original = decodeURIComponent(wrapped[1]);
    } catch {
      /* malformed escape — wrap it as it is */
    }
  }
  return `https://substackcdn.com/image/fetch/w_176,h_176,c_fill,f_jpg,q_auto:good,g_face/${encodeURIComponent(original)}`;
}

/**
 * One batched channels.list call for every YouTube id. The key travels in the
 * query string, so as in lib/youtube.ts nothing that leaves here may carry the
 * URL — errors name only the status, with the key stripped as a backstop.
 */
async function fetchYouTubeAvatars(channelIds: string[], apiKey: string): Promise<Map<string, string>> {
  const url =
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&maxResults=50' +
    `&id=${channelIds.map(encodeURIComponent).join(',')}&key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const body = (await res.json().catch(() => null)) as ChannelsListBody | null;
    if (!res.ok) throw new Error(`channels.list: ${body?.error?.message ?? `HTTP ${res.status}`}`);
    return parseYouTubeAvatars(body ?? {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message.split(apiKey).join('[redacted]'));
  }
}

async function fetchSubstackAvatar(handle: string): Promise<string | null> {
  const res = await fetch(`https://${handle}.substack.com/`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const photo = parseSubstackPhotoUrl(await res.text());
  return photo ? substackAvatarUrl(photo) : null;
}

/**
 * Refresh avatars for channels not looked up in the last week. A channel is
 * marked checked only when its lookup got an answer, so a failed one is tried
 * again next run; a lookup that answers with no picture still counts, so a
 * channel without one isn't asked every run. Never throws.
 */
export async function refreshAvatars(db: Client, channels: Channel[], now: number = Date.now()): Promise<void> {
  try {
    const states = await getAvatarStates(db);
    const due = channels.filter(ch => avatarNeedsRefresh(states.get(ch.channelId) ?? null, now));
    if (due.length === 0) return;

    const youtube = due.filter(ch => ch.source !== 'substack');
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (youtube.length > 0 && apiKey) {
      try {
        const found = await fetchYouTubeAvatars(youtube.map(ch => ch.channelId), apiKey);
        for (const ch of youtube) await saveAvatar(db, ch.channelId, found.get(ch.channelId) ?? null);
      } catch (err) {
        console.warn(`avatars: YouTube lookup failed — ${err instanceof Error ? err.message : err}`);
      }
    }

    for (const ch of due.filter(c => c.source === 'substack' && c.substackHandle)) {
      try {
        await saveAvatar(db, ch.channelId, await fetchSubstackAvatar(ch.substackHandle!));
      } catch (err) {
        console.warn(`avatars: ${ch.name} lookup failed — ${err instanceof Error ? err.message : err}`);
      }
    }
  } catch (err) {
    console.warn(`avatars: refresh skipped — ${err instanceof Error ? err.message : err}`);
  }
}
