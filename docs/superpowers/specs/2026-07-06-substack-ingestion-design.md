# Substack Ingestion — Design Spec

**Date:** 2026-07-06  
**Status:** Approved

## Goal

Ingest Robert Reynolds' paid Substack posts (articles and unlisted YouTube videos) into the existing stock signal pipeline so his content appears on the leaderboard and is queryable via the AI chat — automatically, with no manual copying of transcripts.

## Validation

Both pieces of the pipeline were tested in isolation before design:

1. Substack API with session cookie returns full `body_html` of paid posts ✅  
2. `YoutubeTranscript.fetchTranscript()` successfully fetches transcripts from unlisted YouTube videos embedded in those posts ✅

## Architecture

The existing pipeline loop in `app/api/fetch/route.ts` iterates over `CHANNELS`, fetches videos, gets transcripts, runs Claude extraction, and stores results in SQLite. Robert Reynolds plugs in as a new channel entry. The loop branches on a `source` field to use Substack-specific fetch logic instead of YouTube RSS. Everything after transcript acquisition — summary generation, ticker extraction, DB storage — is unchanged.

## Channel Model Changes

`lib/channels.ts` — add `source` and `substackHandle` to the `Channel` interface:

```ts
export interface Channel {
  id: number;
  channelId: string;
  handle: string;
  name: string;
  weight: number;
  source?: 'youtube' | 'substack';
  substackHandle?: string;
}
```

Existing channels implicitly have `source: 'youtube'` (undefined falls through to the YouTube branch). Robert Reynolds is added as:

```ts
{
  id: 8,
  channelId: "thepopularinvestor",
  handle: "@thepopularinvestor",
  name: "Robert Reynolds",
  weight: 0.35,
  source: 'substack',
  substackHandle: 'thepopularinvestor',
}
```

Weight of 0.35 reflects that ~60-70% of Raymond's trades come from him. Other channel weights should be renormalized after adding this entry.

## DB Changes

None. Substack posts are stored in the existing `videos` table with the post `slug` as `video_id` (e.g. `video-june-industry-posture-market`). The slug is unique per publication and the existing `saveVideo()` insert-or-ignore deduplication works correctly.

## New Module: `lib/substack.ts`

Two exported functions:

### `fetchSubstackPosts(handle: string, cutoffMs: number): Promise<RssVideo[]>`

- Calls `GET https://[handle].substack.com/api/v1/posts?limit=12`
- Sets `Cookie: substack.sid=[SUBSTACK_SESSION_COOKIE]` header
- Filters to posts with `post_date` newer than `cutoffMs` (same 3-day window as YouTube)
- Returns `{ videoId: slug, title, publishedAt }[]` — same shape as `RssVideo`
- Also returns `bodyHtml` on each item (extended type) for content extraction

### `extractSubstackContent(bodyHtml: string): { youtubeVideoId: string | null, articleText: string }`

- Extracts YouTube video ID by matching `"videoId":"([^"]+)"` in the `data-attrs` JSON embedded in the HTML
- Strips HTML tags to produce plain `articleText` as a fallback transcript
- If a video ID is present, the caller uses `fetchTranscript(youtubeVideoId)`
- If no video ID, the caller uses `articleText` directly as the transcript input to Claude

## Fetch Route Changes (`app/api/fetch/route.ts`)

Two branch points added to the existing loop:

**Video discovery:**
```ts
if (channel.source === 'substack') {
  videos = await fetchSubstackPosts(channel.substackHandle!, cutoff);
} else {
  videos = await fetchRecentVideos(channel);
}
```

**Transcript acquisition:**
```ts
if (channel.source === 'substack') {
  const { youtubeVideoId, articleText } = extractSubstackContent(post.bodyHtml);
  transcript = youtubeVideoId
    ? await fetchTranscript(youtubeVideoId)
    : articleText;
} else {
  transcript = await fetchTranscript(video.videoId);
}
```

## Environment Config

Add to `.env.local`:

```
SUBSTACK_SESSION_COOKIE=s:2fNvHmXGUUuvp5JC-2NcMBGW7ZxP7mcW.otAg9hzSZ3U7Pi19/0P6pHdmR+7G3ncgvt6BNEYB0QI
```

The cookie is long-lived (months). When it expires, Raymond logs into Substack in his browser, copies the new `substack.sid` value from DevTools → Application → Cookies, and updates `.env.local`.

## Error Handling

- If the Substack API returns a non-2xx (e.g. cookie expired), log the error and skip the channel — same pattern as existing YouTube RSS failures.
- If `fetchTranscript()` fails on an unlisted video (no captions), fall back to `articleText` if available, otherwise skip the post and log an error.
- If `articleText` is empty (video-only post with no article body), skip and log.

## Out of Scope

- Substack article-only posts with no tickers (they still get processed — Claude extraction simply returns an empty array, which is fine)
- Automatic cookie refresh (manual update to `.env.local` when needed)
- Fetching Robert Reynolds' eToro portfolio weightings (separate future feature)
