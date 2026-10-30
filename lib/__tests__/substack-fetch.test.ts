import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchSubstackPosts } from '@/lib/substack';

const post = { slug: 'p1', title: 'Post', post_date: new Date().toISOString(), body_html: '<p>hi</p>' };

function stubResponse(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
}

describe('fetchSubstackPosts', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('reads the { posts, nextCursor } shape Substack returns since Oct 30 2026', async () => {
    vi.stubEnv('SUBSTACK_SESSION_COOKIE', 'x');
    stubResponse({ posts: [post], nextCursor: 'abc' });
    expect((await fetchSubstackPosts('h')).map(p => p.title)).toEqual(['Post']);
  });

  it('still reads the older bare-array shape', async () => {
    vi.stubEnv('SUBSTACK_SESSION_COOKIE', 'x');
    stubResponse([post]);
    expect(await fetchSubstackPosts('h')).toHaveLength(1);
  });

  it('throws on anything else', async () => {
    vi.stubEnv('SUBSTACK_SESSION_COOKIE', 'x');
    stubResponse({ error: 'nope' });
    await expect(fetchSubstackPosts('h')).rejects.toThrow('Unexpected response shape');
  });
});
