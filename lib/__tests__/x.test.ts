import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  testToken, lookupUser, fetchUserPosts, normalizeHandle, classifyXError, xItemId, parseXItemId,
  xPostTitle, setupErrorMessage, XApiError, MAX_POSTS_PER_PULL,
} from '@/lib/x';
import { itemKind } from '@/lib/item-kind';
import { itemUrl } from '@/lib/item-url';
import { detectCreditProblem } from '@/lib/alerts';

const TOKEN = 'secret-bearer-token';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async (..._args: [string, RequestInit?]) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('testToken', () => {
  it('succeeds when X answers the lookup, sending the token as a bearer header', async () => {
    const fn = mockFetch(200, { data: { id: '783214', username: 'X', name: 'X' } });
    await expect(testToken(TOKEN)).resolves.toBeUndefined();
    const [url, init] = fn.mock.calls[0];
    expect(url).toContain('https://api.x.com/2/users/by/username/X');
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('fails clearly on a rejected token, without echoing it', async () => {
    mockFetch(401, { title: 'Unauthorized', status: 401, detail: 'Unauthorized' });
    const err = await testToken(TOKEN).catch(e => e);
    expect(err).toBeInstanceOf(XApiError);
    expect(err.kind).toBe('auth');
    expect(err.message).not.toContain(TOKEN);
    expect(setupErrorMessage(err)).toMatch(/didn't accept this token/);
  });
});

describe('lookupUser', () => {
  it('returns id, name and a larger avatar', async () => {
    mockFetch(200, { data: { id: '42', username: 'ChrisCamillo', name: 'Chris Camillo',
      profile_image_url: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg' } });
    expect(await lookupUser(TOKEN, '@ChrisCamillo')).toEqual({
      id: '42', username: 'ChrisCamillo', name: 'Chris Camillo',
      avatarUrl: 'https://pbs.twimg.com/profile_images/1/a_200x200.jpg',
    });
  });

  it('reports an unknown handle as not found (X answers 200 with errors)', async () => {
    mockFetch(200, { errors: [{ title: 'Not Found Error', detail: 'Could not find user with username: [nobody].' }] });
    await expect(lookupUser(TOKEN, 'nobody')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('rejects something that cannot be a handle without calling X', async () => {
    const fn = mockFetch(200, {});
    await expect(lookupUser(TOKEN, 'not a handle!')).rejects.toMatchObject({ kind: 'not_found' });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('normalizeHandle', () => {
  it('accepts the forms people paste', () => {
    expect(normalizeHandle('@HolySmokas')).toBe('HolySmokas');
    expect(normalizeHandle(' holysmokas ')).toBe('holysmokas');
    expect(normalizeHandle('https://x.com/ChrisCamillo?s=20')).toBe('ChrisCamillo');
    expect(normalizeHandle('twitter.com/chris_c')).toBe('chris_c');
  });

  it('rejects anything else', () => {
    expect(normalizeHandle('')).toBeNull();
    expect(normalizeHandle('two words')).toBeNull();
    expect(normalizeHandle('a'.repeat(16))).toBeNull();
  });
});

describe('fetchUserPosts', () => {
  const NOW = new Date('2026-10-30T12:00:00Z');

  it('first pull: last 7 days, 100 max, no replies or reposts', async () => {
    const fn = mockFetch(200, { data: [], meta: { result_count: 0 } });
    await fetchUserPosts(TOKEN, '42', { now: NOW });
    const url = new URL(fn.mock.calls[0][0]);
    expect(url.pathname).toBe('/2/users/42/tweets');
    expect(url.searchParams.get('start_time')).toBe('2026-10-23T12:00:00.000Z');
    expect(url.searchParams.get('since_id')).toBeNull();
    expect(url.searchParams.get('max_results')).toBe('100');
    expect(url.searchParams.get('exclude')).toBe('replies,retweets');
  });

  it('later pulls: since_id only', async () => {
    const fn = mockFetch(200, { data: [], meta: { result_count: 0 } });
    await fetchUserPosts(TOKEN, '42', { sinceId: '1850000000000000000', now: NOW });
    const url = new URL(fn.mock.calls[0][0]);
    expect(url.searchParams.get('since_id')).toBe('1850000000000000000');
    expect(url.searchParams.get('start_time')).toBeNull();
  });

  it('caps at 100 posts and prefers the full text of long posts', async () => {
    const data = Array.from({ length: 120 }, (_, i) => ({
      id: String(BigInt('1850000000000000000') + BigInt(i)), text: `post ${i}`, created_at: '2026-10-29T00:00:00.000Z',
    }));
    data[0] = { ...data[0], note_tweet: { text: 'the whole long post' } } as typeof data[0];
    mockFetch(200, { data });
    const { posts, newestId } = await fetchUserPosts(TOKEN, '42', { now: NOW });
    expect(posts).toHaveLength(MAX_POSTS_PER_PULL);
    expect(posts[0].text).toBe('the whole long post');
    expect(newestId).toBe('1850000000000000099');
  });
});

describe('classifyXError', () => {
  it('401 and 403 are token problems', () => {
    expect(classifyXError(401, null).kind).toBe('auth');
    expect(classifyXError(403, { detail: 'client-not-enrolled' }).kind).toBe('auth');
  });

  it('429 is a rate limit', () => {
    const err = classifyXError(429, null);
    expect(err.kind).toBe('rate');
    expect(err.message).toMatch(/rate limit/);
  });

  it('402 and spending-cap errors are billing, worded so they are not read as the Anthropic balance', () => {
    for (const err of [classifyXError(402, null), classifyXError(429, { title: 'UsageCapExceeded', detail: 'Usage cap exceeded: monthly spend' })]) {
      expect(err.kind).toBe('credits');
      expect(err.message).toMatch(/console\.x\.com/);
      expect(detectCreditProblem([err.message])).toBeNull();
    }
  });
});

describe('X items', () => {
  const id = xItemId('ChrisCamillo', '1851234567890123456');

  it('round-trips the item id', () => {
    expect(id).toBe('x-ChrisCamillo-1851234567890123456');
    expect(parseXItemId(id)).toEqual({ handle: 'ChrisCamillo', postId: '1851234567890123456' });
  });

  it('does not mistake a YouTube id for a post', () => {
    expect(parseXItemId('x-AbCdEfGhI')).toBeNull();
    expect(parseXItemId('dQw4w9WgXcQ')).toBeNull();
  });

  it('is labelled X', () => {
    expect(itemKind('Chris Camillo', id)).toBe('X');
  });

  it('links to the post', () => {
    expect(itemUrl('x-42', id)).toBe('https://x.com/ChrisCamillo/status/1851234567890123456');
  });

  it('titles a post by its first line, or about 100 characters of it', () => {
    expect(xPostTitle('$NVDA looks strong\nmore detail here')).toBe('$NVDA looks strong');
    const long = xPostTitle('word '.repeat(60));
    expect(long.length).toBeLessThanOrEqual(101);
    expect(long.endsWith('…')).toBe(true);
  });
});
