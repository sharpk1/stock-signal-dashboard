# Substack Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest Robert Reynolds' paid Substack posts (articles + unlisted YouTube videos) into the stock signal pipeline so his content appears on the leaderboard and is queryable via AI chat.

**Architecture:** A new `lib/substack.ts` module exposes `fetchSubstackPosts()` (hits the Substack REST API with a session cookie) and `extractSubstackContent()` (pulls YouTube video ID and plain article text from post HTML). The fetch route branches on a new `source` field on the `Channel` interface to use these functions instead of the YouTube RSS path. Everything downstream — summary generation, ticker extraction, DB storage — is unchanged.

**Tech Stack:** TypeScript, Next.js 16, better-sqlite3, youtube-transcript, Vitest, Substack REST API (`/api/v1/posts`)

## Global Constraints

- Test runner: `npm test` (runs `vitest run`)
- Path alias `@/` maps to repo root (configured in `vitest.config.ts` and `tsconfig.json`)
- DB is SQLite via `better-sqlite3` — no migrations needed for this feature
- All new network calls must follow the existing error pattern: catch, push to `errors[]`, `continue` — never throw out of the main loop
- Cookie value lives in `.env.local` only — never committed to git

---

### Task 1: `lib/substack.ts` — pure functions + tests

**Files:**
- Create: `lib/substack.ts`
- Create: `lib/__tests__/substack.test.ts`

**Interfaces:**
- Consumes: `RssVideo` from `@/lib/youtube`
- Produces:
  - `SubstackPost` — extends `RssVideo` with `bodyHtml: string`
  - `fetchSubstackPosts(handle: string): Promise<SubstackPost[]>` — network call, not unit-tested
  - `extractSubstackContent(bodyHtml: string): { youtubeVideoId: string | null; articleText: string }` — pure, unit-tested

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/substack.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/kushshah/source/stock-signal-dashboard && npm test -- lib/__tests__/substack.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/substack'`

- [ ] **Step 3: Implement `lib/substack.ts`**

Create `lib/substack.ts`:

```ts
import { RssVideo } from '@/lib/youtube';

export interface SubstackPost extends RssVideo {
  bodyHtml: string;
}

export function extractSubstackContent(bodyHtml: string): {
  youtubeVideoId: string | null;
  articleText: string;
} {
  const videoMatch = bodyHtml.match(/"videoId":"([^"]+)"/);
  const youtubeVideoId = videoMatch ? videoMatch[1] : null;
  const articleText = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { youtubeVideoId, articleText };
}

export async function fetchSubstackPosts(handle: string): Promise<SubstackPost[]> {
  const cookie = process.env.SUBSTACK_SESSION_COOKIE;
  if (!cookie) throw new Error('SUBSTACK_SESSION_COOKIE is not set');

  const url = `https://${handle}.substack.com/api/v1/posts?limit=12`;
  const res = await fetch(url, {
    headers: { Cookie: `substack.sid=${cookie}` },
  });

  if (!res.ok) throw new Error(`Substack API failed for ${handle}: ${res.status}`);

  const posts = (await res.json()) as Array<{
    slug: string;
    title: string;
    post_date: string;
    body_html: string;
  }>;

  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;

  return posts
    .filter(p => new Date(p.post_date).getTime() >= cutoff)
    .map(p => ({
      videoId: p.slug,
      title: p.title,
      publishedAt: p.post_date,
      bodyHtml: p.body_html ?? '',
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/kushshah/source/stock-signal-dashboard && npm test -- lib/__tests__/substack.test.ts
```

Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/kushshah/source/stock-signal-dashboard && git add lib/substack.ts lib/__tests__/substack.test.ts && git commit -m "feat: add lib/substack.ts with fetchSubstackPosts and extractSubstackContent"
```

---

### Task 2: Update `lib/channels.ts`

**Files:**
- Modify: `lib/channels.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: updated `Channel` interface with `source?: 'youtube' | 'substack'` and `substackHandle?: string`; Robert Reynolds added as id 8

- [ ] **Step 1: Update the Channel interface and CHANNELS array**

Replace the entire contents of `lib/channels.ts` with:

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

export const CHANNELS: Channel[] = [
  {
    id: 1,
    channelId: "UCnMn36GT_H0X-w5_ckLtlgQ",
    handle: "@FinancialEducation",
    name: "Financial Education",
    weight: 0.1,
  },
  {
    id: 3,
    channelId: "UCWbHt74zrW8sd3XqFABMXDw",
    handle: "@DumbMoneyLive",
    name: "Dumb Money Live",
    weight: 0.1,
  },
  {
    id: 4,
    channelId: "UCtgIZv41-YwzASc5BdF-7IA",
    handle: "@bravosresearch",
    name: "Bravo's Research",
    weight: 0.1,
  },
  {
    id: 5,
    channelId: "UCAHr-sT0AjrD3sBwr1eRUNg",
    handle: "@MarkMeldrum",
    name: "Mark Meldrum",
    weight: 0.1,
  },
  {
    id: 6,
    channelId: "UCvk0KB4Ue0vfPqvDzjIAwiQ",
    handle: "@TheMaverickofWallStreet",
    name: "The Maverick of Wall Street",
    weight: 0.1,
  },
  {
    id: 7,
    channelId: "UCPP6Eb5fUS38iHIscwWJSAw",
    handle: "@RoyceJakob",
    name: "Royce Jakob",
    weight: 0.15,
  },
  {
    id: 8,
    channelId: "thepopularinvestor",
    handle: "@thepopularinvestor",
    name: "Robert Reynolds",
    weight: 0.35,
    source: 'substack',
    substackHandle: 'thepopularinvestor',
  },
];
```

Weights sum to: 5 × 0.1 + 0.15 + 0.35 = 1.00

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/kushshah/source/stock-signal-dashboard && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd /Users/kushshah/source/stock-signal-dashboard && git add lib/channels.ts && git commit -m "feat: add Robert Reynolds as Substack channel, renormalize weights"
```

---

### Task 3: Wire Substack into `app/api/fetch/route.ts` + env config

**Files:**
- Modify: `app/api/fetch/route.ts`
- Modify: `.env.local`

**Interfaces:**
- Consumes: `fetchSubstackPosts`, `extractSubstackContent`, `SubstackPost` from `@/lib/substack`
- Produces: fetch route handles both `source: 'substack'` and YouTube channels end-to-end

- [ ] **Step 1: Add the cookie to `.env.local`**

Open `.env.local` and add this line (keep existing entries):

```
SUBSTACK_SESSION_COOKIE=s:2fNvHmXGUUuvp5JC-2NcMBGW7ZxP7mcW.otAg9hzSZ3U7Pi19/0P6pHdmR+7G3ncgvt6BNEYB0QI
```

- [ ] **Step 2: Update the imports in `app/api/fetch/route.ts`**

Replace the existing import block at the top of the file with:

```ts
import { NextResponse } from 'next/server';
import { CHANNELS } from '@/lib/channels';
import { getDb, saveChannel, saveVideo, saveMention, updateVideoTranscript } from '@/lib/db';
import { fetchRecentVideos, fetchTranscript } from '@/lib/youtube';
import { fetchSubstackPosts, extractSubstackContent, SubstackPost } from '@/lib/substack';
import { extractTickers, generateSummary } from '@/lib/extract';
```

- [ ] **Step 3: Replace the video-discovery block in the route**

Find this block in `app/api/fetch/route.ts`:

```ts
    let videos;
    try {
      videos = await fetchRecentVideos(channel);
    } catch (err) {
      const msg = `${channel.name}: RSS fetch failed — ${err instanceof Error ? err.message : err}`;
      errors.push(msg);
      console.error(msg);
      continue;
    }
```

Replace it with:

```ts
    let videos: Array<SubstackPost | Awaited<ReturnType<typeof fetchRecentVideos>>[number]>;
    try {
      if (channel.source === 'substack') {
        videos = await fetchSubstackPosts(channel.substackHandle!);
      } else {
        videos = await fetchRecentVideos(channel);
      }
    } catch (err) {
      const msg = `${channel.name}: fetch failed — ${err instanceof Error ? err.message : err}`;
      errors.push(msg);
      console.error(msg);
      continue;
    }
```

- [ ] **Step 4: Replace the transcript-acquisition block in the route**

Find this block inside the `for (const video of videos)` loop:

```ts
      let transcript: string;
      if (existing.transcript) {
        // transcript stored but extraction previously failed — reuse stored transcript
        transcript = existing.transcript;
      } else {
        // fresh video — fetch transcript and generate summary
        try {
          transcript = await fetchTranscript(video.videoId);
        } catch (err) {
          const msg = `${channel.name} / ${video.videoId}: transcript unavailable — ${err instanceof Error ? err.message : err}`;
          errors.push(msg);
          console.error(msg);
          continue;
        }
```

Replace it with:

```ts
      let transcript: string;
      if (existing.transcript) {
        // transcript stored but extraction previously failed — reuse stored transcript
        transcript = existing.transcript;
      } else {
        // fresh content — fetch transcript or use article text
        try {
          if (channel.source === 'substack') {
            const post = video as SubstackPost;
            const { youtubeVideoId, articleText } = extractSubstackContent(post.bodyHtml);
            if (youtubeVideoId) {
              try {
                transcript = await fetchTranscript(youtubeVideoId);
              } catch {
                if (!articleText) {
                  const msg = `${channel.name} / ${video.videoId}: no transcript and no article text — skipping`;
                  errors.push(msg);
                  console.error(msg);
                  continue;
                }
                console.warn(`${channel.name} / ${video.videoId}: YouTube transcript failed, falling back to article text`);
                transcript = articleText;
              }
            } else {
              if (!articleText) {
                const msg = `${channel.name} / ${video.videoId}: empty body — skipping`;
                errors.push(msg);
                console.error(msg);
                continue;
              }
              transcript = articleText;
            }
          } else {
            transcript = await fetchTranscript(video.videoId);
          }
        } catch (err) {
          const msg = `${channel.name} / ${video.videoId}: transcript unavailable — ${err instanceof Error ? err.message : err}`;
          errors.push(msg);
          console.error(msg);
          continue;
        }
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/kushshah/source/stock-signal-dashboard && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Run the full test suite**

```bash
cd /Users/kushshah/source/stock-signal-dashboard && npm test
```

Expected: all existing tests pass plus the 5 new substack tests

- [ ] **Step 7: Smoke-test end-to-end against the live API**

With the dev server stopped, run:

```bash
cd /Users/kushshah/source/stock-signal-dashboard && curl -s -X POST http://localhost:3000/api/fetch | python3 -m json.tool
```

First start the dev server in a separate terminal (`npm run dev`), then run the curl. Look for:
- `"videosProcessed"` count includes Robert Reynolds posts
- `"errors"` array is empty (or only contains pre-existing YouTube issues)
- No `"Substack API failed"` or `"SUBSTACK_SESSION_COOKIE is not set"` messages

Then verify in the leaderboard:

```bash
curl -s http://localhost:3000/api/leaderboard | python3 -m json.tool | head -40
```

Expected: tickers from Robert Reynolds' recent posts appear with `"channels"` containing `"Robert Reynolds"`.

- [ ] **Step 8: Commit**

```bash
cd /Users/kushshah/source/stock-signal-dashboard && git add app/api/fetch/route.ts && git commit -m "feat: wire Substack ingestion into fetch pipeline"
```

Note: `.env.local` is excluded by `.gitignore` — do not stage it. The cookie lives only on the local machine.
