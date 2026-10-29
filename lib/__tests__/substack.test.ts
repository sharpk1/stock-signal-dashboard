import { describe, it, expect } from 'vitest';
import { extractSubstackContent, describeUnusablePost, cookieAgeWarning,
         emptyHarvestWarning, COOKIE_AGEING_MARKER, DEFAULT_COOKIE_MAX_AGE_DAYS,
         type SubstackPost } from '@/lib/substack';

const BODY_WITH_VIDEO = `<p>Some article text here.</p><div id="youtube2-rjR0jh5qpZE" class="youtube-wrap" data-attrs="{&quot;videoId&quot;:&quot;rjR0jh5qpZE&quot;,&quot;startTime&quot;:null,&quot;endTime&quot;:null}" data-component-name="Youtube2ToDOM"><div class="youtube-inner"><iframe src="https://www.youtube-nocookie.com/embed/rjR0jh5qpZE?rel=0" frameborder="0"></iframe></div></div>`;

const BODY_ARTICLE_ONLY = `<p>First paragraph.</p><p>Second paragraph with <a href="https://example.com">a link</a>.</p>`;

const BODY_EMPTY = ``;

describe('extractSubstackContent', () => {
  it('extracts YouTube video ID from data-attrs when video is embedded', () => {
    const result = extractSubstackContent(BODY_WITH_VIDEO);
    expect(result.youtubeVideoId).toBe('rjR0jh5qpZE');
  });

  it('returns null youtubeVideoId when no video is embedded', () => {
    const result = extractSubstackContent(BODY_ARTICLE_ONLY);
    expect(result.youtubeVideoId).toBeNull();
  });

  it('strips HTML tags from articleText', () => {
    const result = extractSubstackContent(BODY_ARTICLE_ONLY);
    expect(result.articleText).toContain('First paragraph.');
    expect(result.articleText).not.toContain('<p>');
    expect(result.articleText).not.toContain('<a');
  });

  it('returns articleText even when a video is present', () => {
    const result = extractSubstackContent(BODY_WITH_VIDEO);
    expect(result.articleText).toContain('Some article text here.');
  });

  it('returns empty articleText for empty body', () => {
    const result = extractSubstackContent(BODY_EMPTY);
    expect(result.articleText).toBe('');
    expect(result.youtubeVideoId).toBeNull();
  });

  it('extracts YouTube video ID from literal-quote data-attrs (non-entity-encoded)', () => {
    const bodyWithLiteralQuotes = `<p>Text.</p><div data-attrs='{"videoId":"abc123","startTime":null}' data-component-name="Youtube2ToDOM"></div>`;
    const result = extractSubstackContent(bodyWithLiteralQuotes);
    expect(result.youtubeVideoId).toBe('abc123');
  });
});

const LONG_ARTICLE = `<p>${'Real analysis about the market. '.repeat(30)}</p>`;
const NATIVE_VIDEO_POST = `<p>Watch the replay.</p><div data-component-name="VideoEmbedToDOM" data-attrs="{&quot;mediaUploadId&quot;:&quot;abc&quot;}"><video src="https://substackcdn.com/v.mp4"></video></div>`;

function post(bodyHtml: string): SubstackPost {
  return { videoId: 'a-slug', title: 'A post', publishedAt: '2026-10-20', bodyHtml };
}

describe('native Substack video detection', () => {
  it('flags a Substack-hosted video with no YouTube embed', () => {
    expect(extractSubstackContent(NATIVE_VIDEO_POST).hasNativeVideo).toBe(true);
  });

  it('does not flag a post that embeds YouTube', () => {
    expect(extractSubstackContent(BODY_WITH_VIDEO).hasNativeVideo).toBe(false);
  });

  it('does not flag a plain article', () => {
    expect(extractSubstackContent(LONG_ARTICLE).hasNativeVideo).toBe(false);
  });
});

describe('describeUnusablePost', () => {
  it('passes a proper article', () => {
    expect(describeUnusablePost(LONG_ARTICLE)).toBeNull();
  });

  it('passes a post with a YouTube embed even with little text', () => {
    expect(describeUnusablePost(BODY_WITH_VIDEO)).toBeNull();
  });

  it('says a Substack-hosted video has nothing to transcribe', () => {
    expect(describeUnusablePost(NATIVE_VIDEO_POST)).toMatch(/nothing to transcribe/);
  });

  it('still reports a genuinely empty body', () => {
    expect(describeUnusablePost('')).toBe('empty body');
  });

  it('reports a caption-length post as too short', () => {
    expect(describeUnusablePost('<p>Short note.</p>')).toMatch(/too short/);
  });
});

describe('cookieAgeWarning', () => {
  const now = Date.parse('2026-10-29T00:00:00Z');
  const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();

  it('stays quiet on a fresh cookie', () => {
    expect(cookieAgeWarning(daysAgo(10), DEFAULT_COOKIE_MAX_AGE_DAYS, now)).toBeNull();
  });

  it('warns once the cookie reaches the threshold', () => {
    const warning = cookieAgeWarning(daysAgo(80), DEFAULT_COOKIE_MAX_AGE_DAYS, now);
    expect(warning).toContain(COOKIE_AGEING_MARKER);
    expect(warning).toContain('80 days ago');
  });

  it('warns with weeks to spare by default', () => {
    expect(DEFAULT_COOKIE_MAX_AGE_DAYS).toBeLessThan(90);
  });

  it('stays quiet when the set date is unknown rather than guessing', () => {
    expect(cookieAgeWarning(undefined, DEFAULT_COOKIE_MAX_AGE_DAYS, now)).toBeNull();
    expect(cookieAgeWarning('   ', DEFAULT_COOKIE_MAX_AGE_DAYS, now)).toBeNull();
  });

  it('stays quiet on an unparseable set date', () => {
    expect(cookieAgeWarning('not a date', DEFAULT_COOKIE_MAX_AGE_DAYS, now)).toBeNull();
  });

  it('honours a custom threshold', () => {
    expect(cookieAgeWarning(daysAgo(20), 10, now)).toContain(COOKIE_AGEING_MARKER);
  });
});

describe('emptyHarvestWarning', () => {
  it('stays quiet when a post had readable content', () => {
    expect(emptyHarvestWarning([post(LONG_ARTICLE), post('')])).toBeNull();
  });

  it('stays quiet when nothing came back at all', () => {
    // No posts is a quiet week, not a broken session.
    expect(emptyHarvestWarning([])).toBeNull();
  });

  it('warns when posts came back but none were readable', () => {
    const warning = emptyHarvestWarning([post(''), post('<p>Teaser.</p>')]);
    expect(warning).toContain(COOKIE_AGEING_MARKER);
    expect(warning).toContain('2 post(s)');
  });
});
