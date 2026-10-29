import { describe, it, expect } from 'vitest';
import { avatarNeedsRefresh, parseSubstackPhotoUrl, substackAvatarUrl, parseYouTubeAvatars } from '@/lib/avatars';

const NOW = Date.parse('2026-10-29T19:42:00Z');

describe('avatarNeedsRefresh', () => {
  it('looks up a channel that has never been checked', () => {
    expect(avatarNeedsRefresh(null, NOW)).toBe(true);
  });

  it('leaves a channel checked within the week alone', () => {
    expect(avatarNeedsRefresh('2026-10-23 19:42:01', NOW)).toBe(false);
  });

  it('refreshes once seven days have passed', () => {
    expect(avatarNeedsRefresh('2026-10-22 19:42:00', NOW)).toBe(true);
  });

  it('reads the SQLite timestamp as UTC', () => {
    // 6 days 23h ago in UTC — would count as a week old if read as local time west of UTC.
    expect(avatarNeedsRefresh('2026-10-22 20:42:00', NOW)).toBe(false);
  });

  it('refreshes when the stamp cannot be parsed', () => {
    expect(avatarNeedsRefresh('garbage', NOW)).toBe(true);
  });
});

describe('parseSubstackPhotoUrl', () => {
  it('reads author_photo_url from the embedded JSON', () => {
    const html = '<script>window._preloads = {"pub":{"subdomain":"x","author_photo_url":"https://bucket.s3.amazonaws.com/public/images/me.jpg","logo_url":"https://logo.png"}}</script>';
    expect(parseSubstackPhotoUrl(html)).toBe('https://bucket.s3.amazonaws.com/public/images/me.jpg');
  });

  it('falls back to logo_url, ignoring logo_url_wide', () => {
    const html = '{"author_photo_url":null,"logo_url_wide":"https://wide.png","logo_url":"https://logo.png"}';
    expect(parseSubstackPhotoUrl(html)).toBe('https://logo.png');
  });

  it('unescapes JSON string escapes', () => {
    const html = '{"author_photo_url":"https:\\/\\/cdn.example\\u002Fme.jpg"}';
    expect(parseSubstackPhotoUrl(html)).toBe('https://cdn.example/me.jpg');
  });

  it('reads JSON embedded inside an escaped string', () => {
    const html = 'JSON.parse("{\\"author_photo_url\\":\\"https:\\/\\/cdn.example\\/me.jpg\\"}")';
    expect(parseSubstackPhotoUrl(html)).toBe('https://cdn.example/me.jpg');
  });

  it('returns null when the page has neither', () => {
    expect(parseSubstackPhotoUrl('<html><body>nothing</body></html>')).toBeNull();
  });
});

describe('substackAvatarUrl', () => {
  const PREFIX = 'https://substackcdn.com/image/fetch/w_176,h_176,c_fill,f_jpg,q_auto:good,g_face/';

  it('wraps the original in a small, face-cropped CDN fetch', () => {
    expect(substackAvatarUrl('https://bucket.s3.amazonaws.com/a b.jpg'))
      .toBe(`${PREFIX}${encodeURIComponent('https://bucket.s3.amazonaws.com/a b.jpg')}`);
  });

  it('unwraps a full-size CDN URL instead of nesting it', () => {
    const original = 'https://bucket.s3.amazonaws.com/public/images/me.jpeg';
    const cdn = `https://substackcdn.com/image/fetch/$s_!ijRv!,f_auto,q_auto:good,fl_progressive:steep/${encodeURIComponent(original)}`;
    expect(substackAvatarUrl(cdn)).toBe(`${PREFIX}${encodeURIComponent(original)}`);
  });
});

describe('parseYouTubeAvatars', () => {
  it('prefers the medium thumbnail and falls back to default', () => {
    const found = parseYouTubeAvatars({
      items: [
        { id: 'UC1', snippet: { thumbnails: { default: { url: 'https://d1' }, medium: { url: 'https://m1' } } } },
        { id: 'UC2', snippet: { thumbnails: { default: { url: 'https://d2' } } } },
        { id: 'UC3', snippet: {} },
      ],
    });
    expect(found).toEqual(new Map([['UC1', 'https://m1'], ['UC2', 'https://d2']]));
  });

  it('handles an empty body', () => {
    expect(parseYouTubeAvatars({}).size).toBe(0);
  });
});
