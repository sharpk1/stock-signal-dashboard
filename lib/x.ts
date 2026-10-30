/**
 * X (Twitter) API v2 client for the X sources (RAY-16).
 *
 * The token is Ray's own, pasted on /setup/x and passed in by the caller —
 * nothing here reads it from env, logs it or puts it in an error message.
 *
 * X API pricing is pay-per-use, billed per post read, so the timeline call
 * reads a bounded window on an account's first pull and only what's newer than
 * since_id after that.
 */
const API = 'https://api.x.com/2';
const REQUEST_TIMEOUT_MS = 15_000;

/** First pull per account: the last week, at most one page of 100 posts. */
export const FIRST_PULL_DAYS = 7;
export const MAX_POSTS_PER_PULL = 100;

/** Who the Test button looks up. Any public account works; this one won't vanish. */
export const TOKEN_TEST_HANDLE = 'X';

export type XErrorKind = 'auth' | 'credits' | 'rate' | 'not_found' | 'other';

export class XApiError extends Error {
  constructor(public kind: XErrorKind, public status: number, message: string) {
    super(message);
    this.name = 'XApiError';
  }

  /** Errors that would fail the same way for every account, so a run stops asking. */
  get affectsAllAccounts(): boolean {
    return this.kind === 'auth' || this.kind === 'credits' || this.kind === 'rate';
  }
}

// Worded to avoid "402" and "payment required": lib/alerts reads those as the
// Anthropic balance running out, and this is X's billing, not Anthropic's.
const CREDITS_MESSAGE =
  'X stopped serving requests: the account is out of credits or has hit its spending limit. ' +
  'Top up or raise the limit at console.x.com.';

type XErrorBody = { title?: string; detail?: string; type?: string; errors?: { title?: string; detail?: string }[] };

function bodyDetail(body: XErrorBody | null): string {
  const first = body?.errors?.[0];
  return String(body?.detail ?? first?.detail ?? body?.title ?? first?.title ?? '').slice(0, 200);
}

/** Turn a non-2xx response into an error that says what to do about it. */
export function classifyXError(status: number, body: XErrorBody | null): XApiError {
  const detail = bodyDetail(body);
  const billing = /credit|spend|usage.?cap|billing/i.test(`${body?.type ?? ''} ${detail}`);
  if (status === 402 || billing) return new XApiError('credits', status, CREDITS_MESSAGE);
  if (status === 401) {
    return new XApiError('auth', status,
      'X rejected the token (HTTP 401). It may have been revoked or regenerated; Ray needs a new setup link.');
  }
  if (status === 403) {
    return new XApiError('auth', status,
      `X refused the token (HTTP 403)${detail ? `: ${detail}` : ''}. Check the app has API access at console.x.com.`);
  }
  if (status === 429) {
    return new XApiError('rate', status, 'X rate limit hit (HTTP 429). It will try again on the next run.');
  }
  if (status === 404) return new XApiError('not_found', status, detail || 'not found on X');
  return new XApiError('other', status, `X API error (HTTP ${status})${detail ? `: ${detail}` : ''}`);
}

async function xGet<T>(token: string, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new XApiError('other', 0, `could not reach X: ${err instanceof Error ? err.message : String(err)}`);
  }
  const body = (await res.json().catch(() => null)) as (T & XErrorBody) | null;
  if (!res.ok) throw classifyXError(res.status, body);
  if (!body) throw new XApiError('other', res.status, 'X returned an empty response');
  return body;
}

/** "@Name", "name", "x.com/name" or "https://twitter.com/name" → "name"; null if it can't be a handle. */
export function normalizeHandle(input: string): string | null {
  let s = input.trim();
  const url = /^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([^/?#]+)/i.exec(s);
  if (url) s = url[1];
  s = s.replace(/^@/, '');
  return /^[A-Za-z0-9_]{1,15}$/.test(s) ? s : null;
}

export interface XUser {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
}

/** X's default avatar is 48px; the 200px variant reads better on the cards. */
function largerAvatar(url: string | undefined): string | null {
  return url ? url.replace('_normal.', '_200x200.') : null;
}

/** Resolve a handle. Throws XApiError('not_found') when there's no such account. */
export async function lookupUser(token: string, handle: string): Promise<XUser> {
  const clean = normalizeHandle(handle);
  if (!clean) throw new XApiError('not_found', 0, `"${handle}" isn't a valid X handle`);
  const body = await xGet<{ data?: { id: string; username: string; name: string; profile_image_url?: string } } & XErrorBody>(
    token,
    `/users/by/username/${encodeURIComponent(clean)}?user.fields=profile_image_url`,
  );
  // X answers an unknown or suspended username with 200 and an `errors` list.
  if (!body.data) {
    throw new XApiError('not_found', 200, `No X account found for @${clean}`);
  }
  return {
    id: body.data.id,
    username: body.data.username,
    name: body.data.name,
    avatarUrl: largerAvatar(body.data.profile_image_url),
  };
}

/** The Test button: does X accept this token? */
export async function testToken(token: string): Promise<void> {
  await lookupUser(token, TOKEN_TEST_HANDLE);
}

export interface XPost {
  id: string;
  text: string;
  createdAt: string;
}

type RawPost = { id: string; text: string; created_at?: string; note_tweet?: { text?: string } };

/**
 * One account's original posts, newest first. Replies and reposts are left
 * out: a repost is someone else's words, and replies are mostly conversation
 * with no ticker in it — at a per-post price.
 *
 * With `sinceId`, only posts newer than it; without, the last FIRST_PULL_DAYS.
 * Either way a single page of MAX_POSTS_PER_PULL: more than 100 posts in three
 * hours would mean the oldest of them are skipped, which is the right trade
 * against reading an unbounded backlog.
 */
export async function fetchUserPosts(
  token: string,
  userId: string,
  opts: { sinceId?: string | null; now?: Date } = {},
): Promise<{ posts: XPost[]; newestId: string | null }> {
  const params = new URLSearchParams({
    max_results: String(MAX_POSTS_PER_PULL),
    exclude: 'replies,retweets',
    'tweet.fields': 'created_at,note_tweet',
  });
  if (opts.sinceId) {
    params.set('since_id', opts.sinceId);
  } else {
    const now = opts.now ?? new Date();
    params.set('start_time', new Date(now.getTime() - FIRST_PULL_DAYS * 24 * 60 * 60 * 1000).toISOString());
  }

  const body = await xGet<{ data?: RawPost[]; meta?: { newest_id?: string } }>(
    token,
    `/users/${encodeURIComponent(userId)}/tweets?${params}`,
  );
  const posts = (body.data ?? []).slice(0, MAX_POSTS_PER_PULL).map(p => ({
    id: p.id,
    // Posts over 280 characters come back truncated in `text`; the full
    // version is in note_tweet.
    text: p.note_tweet?.text || p.text,
    createdAt: p.created_at ?? new Date().toISOString(),
  }));
  const newestId = body.meta?.newest_id ?? newestPostId(posts);
  return { posts, newestId };
}

/** Post ids are 64-bit snowflakes: compare as BigInt, not as numbers or strings. */
function newestPostId(posts: XPost[]): string | null {
  let best: string | null = null;
  for (const p of posts) if (best === null || BigInt(p.id) > BigInt(best)) best = p.id;
  return best;
}

/**
 * The stored item id for a post: `x-<handle>-<postId>`. Carrying the handle
 * lets lib/item-url build the post's link without a database lookup. A post id
 * is 15+ digits, so the pattern can't collide with an 11-character YouTube id.
 */
const ITEM_ID = /^x-([A-Za-z0-9_]{1,15})-(\d{10,})$/;

export function xItemId(handle: string, postId: string): string {
  return `x-${handle}-${postId}`;
}

export function parseXItemId(videoId: string): { handle: string; postId: string } | null {
  const m = ITEM_ID.exec(videoId);
  return m ? { handle: m[1], postId: m[2] } : null;
}

export function xPostUrl(handle: string, postId: string): string {
  return `https://x.com/${handle}/status/${postId}`;
}

/** First line, or the first ~100 characters of it. */
export function xPostTitle(text: string): string {
  const firstLine = text.trim().split('\n')[0].trim().replace(/\s+/g, ' ');
  if (!firstLine) return '(post with no text)';
  if (firstLine.length <= 100) return firstLine;
  const cut = firstLine.slice(0, 100);
  const space = cut.lastIndexOf(' ');
  return `${(space > 60 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Below this, a post gets ticker extraction only — a summary of a tweet is the tweet. */
export const SUMMARY_MIN_CHARS = 400;

/** What the setup page shows when a Test, Look up or Save call fails. */
export function setupErrorMessage(err: unknown): string {
  if (err instanceof XApiError) {
    if (err.kind === 'auth') return "X didn't accept this token. Copy the Bearer Token again from console.x.com and paste it here.";
    if (err.kind === 'credits') return 'X says this account has no credits or has hit its spending limit. Add credits at console.x.com, then try again.';
    if (err.kind === 'rate') return 'X is rate limiting this token. Wait a few minutes and try again.';
    return err.message;
  }
  return 'Something went wrong talking to X. Try again in a minute.';
}
