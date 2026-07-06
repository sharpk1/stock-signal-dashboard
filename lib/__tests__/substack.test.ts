import { describe, it, expect } from 'vitest';
import { extractSubstackContent } from '@/lib/substack';

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
});
