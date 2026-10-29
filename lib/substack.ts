import { RssVideo } from '@/lib/youtube';

export interface SubstackPost extends RssVideo {
  bodyHtml: string;
}

/** Below this, a post's text is a caption rather than something to summarise. */
const MIN_ARTICLE_CHARS = 400;

export function extractSubstackContent(bodyHtml: string): {
  youtubeVideoId: string | null;
  articleText: string;
  /** A player Substack hosts itself — a native upload or a livestream replay. */
  hasNativeVideo: boolean;
} {
  // body_html from Substack API uses HTML entity encoding for attribute values
  const decoded = bodyHtml.replace(/&quot;/g, '"');
  const videoMatch = decoded.match(/"videoId":"([^"]+)"/);
  const youtubeVideoId = videoMatch ? videoMatch[1] : null;
  const articleText = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // Matched by shape rather than by Substack's component names, which change:
  // any player element, or a component whose name mentions video or live.
  const hasNativeVideo = !youtubeVideoId && (
    /<(video|iframe)\b/i.test(decoded) ||
    /data-component-name="[^"]*(video|live)[^"]*"/i.test(decoded) ||
    /"(mediaUploadId|videoUploadId)"\s*:/i.test(decoded)
  );

  return { youtubeVideoId, articleText, hasNativeVideo };
}

/**
 * Why a post yielded nothing worth summarising, phrased so the sources page
 * says what is actually wrong instead of "empty body".
 */
export function describeUnusablePost(bodyHtml: string): string | null {
  const { youtubeVideoId, articleText, hasNativeVideo } = extractSubstackContent(bodyHtml);
  if (youtubeVideoId || articleText.length >= MIN_ARTICLE_CHARS) return null;
  if (hasNativeVideo) {
    return 'Substack-hosted video or livestream with no YouTube embed and no article text — nothing to transcribe';
  }
  return articleText.length === 0 ? 'empty body' : 'post body too short to summarise';
}

/**
 * videoId on each returned SubstackPost holds the post slug (e.g. "video-june-2026"),
 * used as the unique DB key via saveVideo(). To get the embedded YouTube video ID,
 * call extractSubstackContent(post.bodyHtml).youtubeVideoId in the caller.
 */
export async function fetchSubstackPosts(handle: string): Promise<SubstackPost[]> {
  const cookie = process.env.SUBSTACK_SESSION_COOKIE;
  if (!cookie) throw new Error('SUBSTACK_SESSION_COOKIE is not set');

  const url = `https://${handle}.substack.com/api/v1/posts?limit=12`;
  const res = await fetch(url, {
    headers: { Cookie: `substack.sid=${cookie}` },
  });

  // Say which failure this is: a rejected session needs a new cookie pasted in,
  // where a 500 just needs waiting out.
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `${COOKIE_EXPIRED_MARKER}: Substack rejected the session cookie for ${handle} (HTTP ${res.status}) — SUBSTACK_SESSION_COOKIE needs replacing`,
    );
  }
  if (!res.ok) throw new Error(`Substack API failed for ${handle}: ${res.status}`);

  const posts = (await res.json()) as Array<{
    slug: string;
    title: string;
    post_date: string;
    body_html: string;
  }>;

  if (!Array.isArray(posts)) throw new Error(`Unexpected response shape from Substack API for ${handle}`);

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  return posts
    .filter(p => new Date(p.post_date).getTime() >= cutoff)
    .map(p => ({
      videoId: p.slug,
      title: p.title,
      publishedAt: p.post_date,
      bodyHtml: p.body_html ?? '',
    }));
}

/**
 * Marks both cookie problems so the alert email and the sources page can pick
 * them out of a run's errors without re-deriving the reason.
 */
export const COOKIE_EXPIRED_MARKER = 'Substack session expired';
export const COOKIE_AGEING_MARKER = 'Substack session ageing';

/** Substack sessions last months, so warn with weeks to spare. */
export const DEFAULT_COOKIE_MAX_AGE_DAYS = 75;

function maxCookieAgeDays(): number {
  const raw = Number(process.env.SUBSTACK_COOKIE_MAX_AGE_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_COOKIE_MAX_AGE_DAYS;
}

/**
 * A session cookie carries no readable expiry, so the only way to warn *before*
 * it dies is to know when it was issued. SUBSTACK_COOKIE_SET_AT is the date the
 * cookie was pasted in; with it unset there is nothing to warn about and this
 * stays quiet rather than guessing.
 */
export function cookieAgeWarning(
  setAt: string | undefined = process.env.SUBSTACK_COOKIE_SET_AT,
  maxAgeDays: number = maxCookieAgeDays(),
  now: number = Date.now(),
): string | null {
  if (!setAt?.trim()) return null;
  const issued = new Date(setAt.trim()).getTime();
  if (!Number.isFinite(issued)) return null;

  const ageDays = Math.floor((now - issued) / (24 * 60 * 60 * 1000));
  if (ageDays < maxAgeDays) return null;
  return `${COOKIE_AGEING_MARKER}: the Substack cookie was set ${ageDays} days ago (warning at ${maxAgeDays}). Refresh SUBSTACK_SESSION_COOKIE and SUBSTACK_COOKIE_SET_AT before it stops returning subscriber posts.`;
}

/**
 * An expired cookie doesn't always fail loudly: Substack can answer with the
 * free posts and paywalled bodies, which looks like a quiet week rather than a
 * broken session. If nothing came back with usable text, say so.
 */
export function emptyHarvestWarning(posts: SubstackPost[]): string | null {
  if (posts.length === 0) return null;
  const usable = posts.filter(p => describeUnusablePost(p.bodyHtml) === null);
  if (usable.length > 0) return null;
  return `${COOKIE_AGEING_MARKER}: Substack returned ${posts.length} post(s) but none had readable content — the session cookie may have expired or the posts are subscriber-only.`;
}
