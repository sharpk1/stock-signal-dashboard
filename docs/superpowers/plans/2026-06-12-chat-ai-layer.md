# Chat / AI Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Claude-powered chat panel to the stock dashboard so Ray can ask natural language questions and get answers with exact quotes pulled from stored YouTube transcripts.

**Architecture:** Five sequential tasks: (1) DB schema + helper functions, (2) summary generation at ingestion, (3) fetch route update to store transcripts + summaries, (4) chat API with tool use loop, (5) chat UI side panel. Each task is independently testable and committed before moving on.

**Tech Stack:** Next.js 16 (App Router), TypeScript, SQLite via `better-sqlite3`, Anthropic SDK (`@anthropic-ai/sdk`), Vitest, Tailwind CSS v4.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `lib/db.ts` | Modify | Add ALTER TABLE, 2 new tables, 5 new functions |
| `lib/extract.ts` | Modify | Add `generateSummary()` |
| `lib/chat-tools.ts` | **Create** | Tool executor for chat API (testable in isolation) |
| `app/api/fetch/route.ts` | Modify | Store transcript + summary after saveVideo() |
| `app/api/chat/route.ts` | **Create** | Claude tool use loop |
| `app/page.tsx` | Modify | Chat state + button + side panel |
| `lib/__tests__/db.test.ts` | Modify | Tests for 5 new DB functions |
| `lib/__tests__/chat-tools.test.ts` | **Create** | Tests for tool executor |

---

## Task 1: DB Schema + Helper Functions

**Files:**
- Modify: `lib/db.ts`
- Modify: `lib/__tests__/db.test.ts`

- [ ] **Step 1: Write failing tests for new DB functions**

Add these tests at the bottom of `lib/__tests__/db.test.ts`:

```typescript
describe('updateVideoTranscript', () => {
  it('stores transcript and summary on a video row', () => {
    const db = makeTestDb();
    saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Test', weight: 0.5 });
    const videoRowId = saveVideo(db, { videoId: 'v1', channelId: 'UC123', title: 'T', publishedAt: new Date().toISOString() });
    updateVideoTranscript(db, videoRowId, 'full transcript text', 'summary text');
    const row = db.prepare('SELECT transcript, summary FROM videos WHERE id = ?').get(videoRowId) as { transcript: string; summary: string };
    expect(row.transcript).toBe('full transcript text');
    expect(row.summary).toBe('summary text');
  });
});

describe('saveMemory and getMemories', () => {
  it('saves a memory and retrieves it', () => {
    const db = makeTestDb();
    saveMemory(db, 'Ray prefers swing trades', 'explicit');
    saveMemory(db, 'Ray is long CELH', 'extracted');
    const memories = getMemories(db);
    expect(memories).toHaveLength(2);
    expect(memories).toContain('Ray prefers swing trades');
    expect(memories).toContain('Ray is long CELH');
  });

  it('returns empty array when no memories exist', () => {
    const db = makeTestDb();
    expect(getMemories(db)).toEqual([]);
  });
});

describe('saveConversation and getRecentConversations', () => {
  it('saves a conversation and retrieves it', () => {
    const db = makeTestDb();
    saveConversation(db, 'What is Jeremy saying?', 'Jeremy is bullish on CELH.');
    const convs = getRecentConversations(db);
    expect(convs).toHaveLength(1);
    expect(convs[0].question).toBe('What is Jeremy saying?');
    expect(convs[0].answer).toBe('Jeremy is bullish on CELH.');
  });

  it('returns at most n conversations in reverse chronological order', () => {
    const db = makeTestDb();
    saveConversation(db, 'Q1', 'A1');
    saveConversation(db, 'Q2', 'A2');
    saveConversation(db, 'Q3', 'A3');
    const convs = getRecentConversations(db, 2);
    expect(convs).toHaveLength(2);
    expect(convs[0].question).toBe('Q3'); // most recent first
  });
});
```

Also update the import line at the top of `lib/__tests__/db.test.ts` to include the new functions:

```typescript
import { initDb, saveChannel, saveVideo, saveMention, getLeaderboard, getMentionDetails,
         updateVideoTranscript, saveMemory, getMemories, saveConversation, getRecentConversations } from '@/lib/db';
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /path/to/stock-signal-dashboard && npm test
```

Expected: FAIL — `updateVideoTranscript is not a function` (and similar for the other new imports).

- [ ] **Step 3: Add ALTER TABLE calls and new tables to `initDb()` in `lib/db.ts`**

In `lib/db.ts`, after the existing `db.exec(...)` call inside `initDb()`, add:

```typescript
// Add transcript/summary columns if not yet present (idempotent)
try { db.exec('ALTER TABLE videos ADD COLUMN transcript TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE videos ADD COLUMN summary TEXT'); } catch { /* already exists */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    content    TEXT NOT NULL,
    source     TEXT NOT NULL DEFAULT 'explicit',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    question   TEXT NOT NULL,
    answer     TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
```

- [ ] **Step 4: Add the 5 new exported functions to `lib/db.ts`**

Add these after the existing `getMentionDetails` function:

```typescript
export function updateVideoTranscript(
  db: DatabaseType,
  videoRowId: number,
  transcript: string,
  summary: string
): void {
  db.prepare('UPDATE videos SET transcript = ?, summary = ? WHERE id = ?')
    .run(transcript, summary, videoRowId);
}

export function saveMemory(
  db: DatabaseType,
  content: string,
  source: 'explicit' | 'extracted'
): void {
  db.prepare('INSERT INTO memories (content, source) VALUES (?, ?)').run(content, source);
}

export function getMemories(db: DatabaseType): string[] {
  const rows = db.prepare('SELECT content FROM memories ORDER BY created_at DESC').all() as { content: string }[];
  return rows.map(r => r.content);
}

export function saveConversation(db: DatabaseType, question: string, answer: string): void {
  db.prepare('INSERT INTO conversations (question, answer) VALUES (?, ?)').run(question, answer);
}

export function getRecentConversations(
  db: DatabaseType,
  n: number = 5
): { question: string; answer: string }[] {
  return db.prepare(
    'SELECT question, answer FROM conversations ORDER BY created_at DESC LIMIT ?'
  ).all(n) as { question: string; answer: string }[];
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test
```

Expected: all new tests PASS. Pre-existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts lib/__tests__/db.test.ts
git commit -m "feat: add transcript/summary schema and memory/conversation DB functions"
```

---

## Task 2: Summary Generation

**Files:**
- Modify: `lib/extract.ts`

- [ ] **Step 1: Add `generateSummary` to `lib/extract.ts`**

Add this function after the existing `extractTickers` function. No new imports needed — `client` is already defined at the top of the file.

```typescript
export async function generateSummary(transcript: string): Promise<string> {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: `Summarize this YouTube transcript for a stock research assistant.
Extract: tickers mentioned with sentiment and thesis, key direct quotes,
price targets, timeline language (e.g. "by year end", "6-9 months"),
and overall conviction level.
Format as plain readable text optimized for keyword search.
Keep it under 400 words.`,
    messages: [{ role: 'user', content: transcript.slice(0, 60000) }],
  });
  return message.content[0].type === 'text' ? message.content[0].text : '';
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/extract.ts
git commit -m "feat: add generateSummary to extract pipeline"
```

---

## Task 3: Fetch Route — Transcript + Summary Ingestion

**Files:**
- Modify: `app/api/fetch/route.ts`

The current route fetches a transcript first, then saves the video. We need to flip this: save the video first, then check if transcript is already stored before fetching.

**Dedup logic:**
- If `videos.transcript IS NOT NULL` for this row → skip entirely (ticker mentions also already exist)
- If `videos.transcript IS NULL` → fetch transcript, generate summary, store both, then extract tickers

- [ ] **Step 1: Update `app/api/fetch/route.ts`**

Replace the entire file with:

```typescript
import { NextResponse } from 'next/server';
import { CHANNELS } from '@/lib/channels';
import { getDb, saveChannel, saveVideo, saveMention, updateVideoTranscript } from '@/lib/db';
import { fetchRecentVideos, fetchTranscript } from '@/lib/youtube';
import { extractTickers, generateSummary } from '@/lib/extract';

export const maxDuration = 300;

export async function POST() {
  const db = getDb();
  const errors: string[] = [];
  let videosProcessed = 0;
  let tickersFound = 0;

  for (const channel of CHANNELS) {
    saveChannel(db, channel);

    let videos;
    try {
      videos = await fetchRecentVideos(channel);
    } catch (err) {
      const msg = `${channel.name}: RSS fetch failed — ${err instanceof Error ? err.message : err}`;
      errors.push(msg);
      console.error(msg);
      continue;
    }

    if (videos.length === 0) {
      console.log(`${channel.name}: no new videos in last 24h`);
      continue;
    }

    for (const video of videos) {
      const videoRowId = saveVideo(db, {
        videoId: video.videoId,
        channelId: channel.channelId,
        title: video.title,
        publishedAt: video.publishedAt,
      });

      // skip if already fully processed
      const existing = db.prepare('SELECT transcript FROM videos WHERE id = ?')
        .get(videoRowId) as { transcript: string | null };
      if (existing.transcript) {
        console.log(`Skipped (already processed): ${video.title}`);
        continue;
      }

      let transcript: string;
      try {
        transcript = await fetchTranscript(video.videoId);
      } catch (err) {
        const msg = `${channel.name} / ${video.videoId}: transcript unavailable — ${err instanceof Error ? err.message : err}`;
        errors.push(msg);
        console.error(msg);
        continue;
      }

      let summary = '';
      try {
        summary = await generateSummary(transcript);
      } catch (err) {
        console.error(`${channel.name} / ${video.title}: summary generation failed — ${err instanceof Error ? err.message : err}`);
        // store transcript without summary rather than failing the whole video
      }

      updateVideoTranscript(db, videoRowId, transcript, summary);

      let mentions;
      try {
        mentions = await extractTickers(transcript, video.title);
      } catch (err) {
        const msg = `${channel.name} / ${video.title}: Claude extraction failed — ${err instanceof Error ? err.message : err}`;
        errors.push(msg);
        console.error(msg);
        continue;
      }

      for (const mention of mentions) {
        saveMention(db, {
          videoRowId,
          ticker: mention.ticker.toUpperCase(),
          company: mention.company ?? null,
          sentiment: mention.sentiment,
          conviction: mention.conviction,
          quote: mention.quote ?? null,
        });
        tickersFound++;
      }

      videosProcessed++;
      console.log(`Processed: ${video.title} — ${mentions.length} tickers`);
    }
  }

  return NextResponse.json({ success: true, videosProcessed, tickersFound, errors });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run existing tests to confirm nothing broke**

```bash
npm test
```

Expected: all existing tests still PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/fetch/route.ts
git commit -m "feat: store transcript and summary during fetch, skip already-processed videos"
```

---

## Task 4: Chat API + Tool Executor

**Files:**
- Create: `lib/chat-tools.ts`
- Create: `lib/__tests__/chat-tools.test.ts`
- Create: `app/api/chat/route.ts`

Split into two parts: the tool executor (`lib/chat-tools.ts`) is pure logic testable without HTTP, and the route wires it into the Claude tool use loop.

### Part A: Tool Executor

- [ ] **Step 1: Write failing tests for the tool executor**

Create `lib/__tests__/chat-tools.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initDb, saveChannel, saveVideo, updateVideoTranscript, getMemories } from '@/lib/db';
import { executeToolCall } from '@/lib/chat-tools';

function makeTestDb() {
  const db = new Database(':memory:');
  initDb(db);
  return db;
}

describe('executeToolCall — search_summaries', () => {
  it('returns matching videos when summary contains query', () => {
    const db = makeTestDb();
    saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Financial Education', weight: 0.5 });
    const vid = saveVideo(db, { videoId: 'v1', channelId: 'UC123', title: 'Celsius is hot', publishedAt: new Date().toISOString() });
    updateVideoTranscript(db, vid, 'transcript', 'CELH bullish target $50 by year end');
    const result = executeToolCall('search_summaries', { query: 'CELH', days: 30 }, db);
    expect(result).toContain('CELH bullish');
    expect(result).toContain('Celsius is hot');
    expect(result).toContain('Financial Education');
  });

  it('returns no results message when nothing matches', () => {
    const db = makeTestDb();
    const result = executeToolCall('search_summaries', { query: 'NONEXISTENT_TICKER_XYZ', days: 30 }, db);
    expect(result).toBe('No matching videos found.');
  });

  it('filters by channel when channel param provided', () => {
    const db = makeTestDb();
    saveChannel(db, { id: 1, channelId: 'UC111', handle: '@fin', name: 'Financial Education', weight: 0.5 });
    saveChannel(db, { id: 2, channelId: 'UC222', handle: '@dum', name: 'Dumb Money', weight: 0.5 });
    const v1 = saveVideo(db, { videoId: 'v1', channelId: 'UC111', title: 'Jeremy on CELH', publishedAt: new Date().toISOString() });
    const v2 = saveVideo(db, { videoId: 'v2', channelId: 'UC222', title: 'Ray on CELH', publishedAt: new Date().toISOString() });
    updateVideoTranscript(db, v1, 't', 'CELH mentioned by Jeremy');
    updateVideoTranscript(db, v2, 't', 'CELH mentioned by Ray');
    const result = executeToolCall('search_summaries', { query: 'CELH', channel: 'Financial Education', days: 30 }, db);
    expect(result).toContain('Jeremy on CELH');
    expect(result).not.toContain('Ray on CELH');
  });
});

describe('executeToolCall — get_full_transcript', () => {
  it('returns transcript text for a known video', () => {
    const db = makeTestDb();
    saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Test', weight: 0.5 });
    const vid = saveVideo(db, { videoId: 'v1', channelId: 'UC123', title: 'Test Video', publishedAt: new Date().toISOString() });
    updateVideoTranscript(db, vid, 'full transcript content here', 'summary');
    const result = executeToolCall('get_full_transcript', { video_id: 'v1' }, db);
    expect(result).toContain('full transcript content here');
    expect(result).toContain('Test Video');
  });

  it('returns not found for unknown video_id', () => {
    const db = makeTestDb();
    const result = executeToolCall('get_full_transcript', { video_id: 'nonexistent' }, db);
    expect(result).toBe('Video not found.');
  });

  it('returns unavailable message when transcript is null', () => {
    const db = makeTestDb();
    saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Test', weight: 0.5 });
    saveVideo(db, { videoId: 'v1', channelId: 'UC123', title: 'T', publishedAt: new Date().toISOString() });
    const result = executeToolCall('get_full_transcript', { video_id: 'v1' }, db);
    expect(result).toBe('Transcript not available for this video.');
  });
});

describe('executeToolCall — save_memory', () => {
  it('stores the memory and returns confirmation', () => {
    const db = makeTestDb();
    const result = executeToolCall('save_memory', { content: 'Ray prefers swing trades' }, db);
    expect(result).toBe('Memory saved.');
    expect(getMemories(db)).toContain('Ray prefers swing trades');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: FAIL — `Cannot find module '@/lib/chat-tools'`.

- [ ] **Step 3: Create `lib/chat-tools.ts`**

```typescript
import { Database as DatabaseType } from 'better-sqlite3';
import { saveMemory } from '@/lib/db';

export function executeToolCall(
  name: string,
  input: Record<string, unknown>,
  db: DatabaseType
): string {
  if (name === 'search_summaries') {
    const { query, channel, days = 30 } = input as { query: string; channel?: string; days?: number };
    const channelFilter = channel ? 'AND c.name = ?' : '';
    const params: unknown[] = [`%${query}%`, String(days)];
    if (channel) params.push(channel);

    const rows = db.prepare(`
      SELECT v.title, v.summary, v.video_id, v.published_at, c.name AS channel_name
      FROM videos v
      JOIN channels c ON v.channel_id = c.channel_id
      WHERE v.summary LIKE ?
        AND rtrim(replace(v.published_at, 'T', ' '), 'Z') >= datetime('now', '-' || ? || ' days')
        ${channelFilter}
      ORDER BY v.published_at DESC
      LIMIT 10
    `).all(...params) as {
      title: string; summary: string | null; video_id: string;
      published_at: string; channel_name: string;
    }[];

    if (rows.length === 0) return 'No matching videos found.';
    return rows.map(r =>
      `[${r.channel_name}] "${r.title}" (${r.published_at.slice(0, 10)}) — video_id: ${r.video_id}\n${r.summary ?? '(no summary)'}`
    ).join('\n\n');
  }

  if (name === 'get_full_transcript') {
    const { video_id } = input as { video_id: string };
    const row = db.prepare(`
      SELECT v.transcript, v.title, c.name AS channel_name, v.published_at
      FROM videos v
      JOIN channels c ON v.channel_id = c.channel_id
      WHERE v.video_id = ?
    `).get(video_id) as {
      transcript: string | null; title: string; channel_name: string; published_at: string;
    } | undefined;

    if (!row) return 'Video not found.';
    if (!row.transcript) return 'Transcript not available for this video.';
    return `[${row.channel_name}] "${row.title}" (${row.published_at.slice(0, 10)})\n\nTranscript:\n${row.transcript}`;
  }

  if (name === 'save_memory') {
    const { content } = input as { content: string };
    saveMemory(db, content, 'explicit');
    return 'Memory saved.';
  }

  return `Unknown tool: ${name}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all new chat-tools tests PASS. All prior tests still PASS.

### Part B: Chat Route

- [ ] **Step 5: Create `app/api/chat/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import {
  getDb, getMemories, getRecentConversations,
  saveConversation, saveMemory,
} from '@/lib/db';
import { executeToolCall } from '@/lib/chat-tools';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_summaries',
    description: 'Search video summaries by topic, ticker, or channel. Use this first to find relevant videos.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query:   { type: 'string', description: 'Keywords to search for in summaries' },
        channel: { type: 'string', description: 'Optional: filter to a specific channel name' },
        days:    { type: 'number', description: 'How many days back to search (default 30)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_full_transcript',
    description: 'Get the full transcript for a specific video to find exact quotes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        video_id: { type: 'string', description: 'The video_id returned by search_summaries' },
      },
      required: ['video_id'],
    },
  },
  {
    name: 'save_memory',
    description: 'Save something Ray wants remembered in future conversations. Call this when Ray says "remember X".',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'The fact or preference to remember' },
      },
      required: ['content'],
    },
  },
];

const MAX_ITERATIONS = 5;

export async function POST(request: Request) {
  const body = await request.json() as { question?: string };
  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }

  const db = getDb();
  const memories = getMemories(db);
  const recent = getRecentConversations(db, 5);

  const systemPrompt = [
    "You are Ray's personal stock research assistant.",
    'Answer questions about stocks based on what YouTube creators have said in their recent videos.',
    'Always cite which channel and video your answer comes from.',
    'When Ray says "remember X", call the save_memory tool.',
    '',
    "What you know about Ray:",
    memories.length > 0 ? memories.map(m => `- ${m}`).join('\n') : '(no memories yet)',
    '',
    'Recent conversations:',
    recent.length > 0
      ? recent.map(c => `Q: ${c.question}\nA: ${c.answer}`).join('\n\n')
      : '(no prior conversations)',
  ].join('\n');

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text');
      const answer = textBlock?.type === 'text' ? textBlock.text : 'No answer found.';
      saveConversation(db, question, answer);
      extractAndSaveMemories(db, question, answer);
      return NextResponse.json({ answer });
    }

    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) break;

    const toolResults: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map(block => {
      if (block.type !== 'tool_use') return { type: 'tool_result' as const, tool_use_id: '', content: '' };
      const result = executeToolCall(block.name, block.input as Record<string, unknown>, db);
      return { type: 'tool_result' as const, tool_use_id: block.id, content: result };
    });

    messages.push(
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults },
    );
    iterations++;
  }

  return NextResponse.json({
    answer: "I couldn't find enough information to answer that confidently. Try asking about a specific ticker or channel.",
  });
}

function extractAndSaveMemories(db: ReturnType<typeof getDb>, question: string, answer: string): void {
  doExtractMemories(db, question, answer).catch(err =>
    console.error('[memory extraction] failed:', err)
  );
}

async function doExtractMemories(db: ReturnType<typeof getDb>, question: string, answer: string): Promise<void> {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: `Based on this Q&A, what did you learn about Ray's preferences or portfolio that should be remembered for future sessions? Return a JSON array of short strings, or [] if nothing new.\n\nQ: ${question}\nA: ${answer}`,
    }],
  });
  const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]';
  let items: unknown;
  try {
    items = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim());
  } catch { return; }
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (typeof item === 'string' && item.trim().length > 0) {
      saveMemory(db, item.trim(), 'extracted');
    }
  }
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Run all tests**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/chat-tools.ts lib/__tests__/chat-tools.test.ts app/api/chat/route.ts
git commit -m "feat: add chat API with Claude tool use loop and tool executor"
```

---

## Task 5: Chat UI

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add `useRef` to the React import in `app/page.tsx`**

Find the existing import line (line 3):
```typescript
import { useState, useEffect, useCallback } from 'react';
```

Replace with:
```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
```

- [ ] **Step 2: Add chat state variables in `app/page.tsx`**

After the existing `const [modalQuote, setModalQuote] = useState<string | null>(null);` line, add:

```typescript
const [chatOpen, setChatOpen] = useState(false);
const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
const [chatInput, setChatInput] = useState('');
const [chatLoading, setChatLoading] = useState(false);
const chatScrollRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 3: Add auto-scroll effect in `app/page.tsx`**

After the existing `useEffect(() => { loadLeaderboard(null); }, [loadLeaderboard]);` line, add:

```typescript
useEffect(() => {
  if (chatScrollRef.current) {
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }
}, [chatMessages, chatLoading]);
```

- [ ] **Step 4: Add `handleSend` function in `app/page.tsx`**

After the existing `handleFetch` function, add:

```typescript
async function handleSend() {
  if (!chatInput.trim() || chatLoading) return;
  const question = chatInput.trim();
  setChatInput('');
  setChatMessages(prev => [...prev, { role: 'user', content: question }]);
  setChatLoading(true);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const { answer } = await res.json();
    setChatMessages(prev => [...prev, { role: 'assistant', content: answer }]);
  } finally {
    setChatLoading(false);
  }
}
```

- [ ] **Step 5: Add Chat button to the header in `app/page.tsx`**

Find the existing Fetch Latest button in the header. It starts with:
```tsx
<button
  onClick={handleFetch}
  disabled={fetching}
  className="flex items-center gap-2 bg-blue-600 ...
```

Add a Chat button immediately before it:

```tsx
<button
  onClick={() => setChatOpen(true)}
  className="flex items-center gap-2 bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
>
  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
  Chat
</button>
```

- [ ] **Step 6: Add backdrop and chat panel to `app/page.tsx`**

Find the existing Quote modal block near the bottom:
```tsx
{/* Quote modal */}
{modalQuote && (
```

Add the chat backdrop and panel immediately before the quote modal block:

```tsx
{/* Chat backdrop */}
{chatOpen && (
  <div
    className="fixed inset-0 bg-black/20 z-20"
    onClick={() => setChatOpen(false)}
  />
)}

{/* Chat side panel */}
<div className={`fixed inset-y-0 right-0 w-96 bg-white shadow-2xl border-l border-gray-200 flex flex-col z-30 transition-transform duration-300 ${chatOpen ? 'translate-x-0' : 'translate-x-full'}`}>
  <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
    <div className="flex items-center gap-2">
      <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center text-xs font-bold text-white">S</div>
      <span className="font-semibold text-gray-900 text-sm">Stock Signals AI</span>
    </div>
    <button
      onClick={() => setChatOpen(false)}
      className="text-gray-400 hover:text-gray-700 transition-colors text-lg leading-none"
    >
      ✕
    </button>
  </div>

  <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
    {chatMessages.length === 0 && (
      <p className="text-gray-400 text-sm text-center pt-8">Ask anything about recent videos…</p>
    )}
    {chatMessages.map((m, i) => (
      <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
          m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'
        }`}>
          {m.content}
        </div>
      </div>
    ))}
    {chatLoading && (
      <div className="flex justify-start">
        <div className="bg-gray-100 rounded-xl px-3 py-2 text-sm text-gray-400 animate-pulse">Thinking…</div>
      </div>
    )}
  </div>

  <div className="border-t border-gray-200 px-4 py-3 flex gap-2">
    <textarea
      value={chatInput}
      onChange={e => setChatInput(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
      }}
      placeholder="Ask anything…"
      rows={1}
      className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
    />
    <button
      onClick={handleSend}
      disabled={chatLoading || !chatInput.trim()}
      className="flex items-center justify-center w-9 h-9 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors shrink-0"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
      </svg>
    </button>
  </div>
</div>
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Run all tests**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 9: Start dev server and manually verify**

```bash
npm run dev
```

Open `http://localhost:3000`. Verify:
1. "Chat" button appears in the header next to "Fetch Latest"
2. Clicking "Chat" slides in the right panel
3. Clicking the backdrop (dark overlay) closes the panel
4. Typing a message and pressing Enter sends it
5. "Thinking…" pulse appears while waiting
6. Answer appears in a gray bubble on the left
7. Shift+Enter creates a new line instead of sending
8. Send button is disabled when input is empty or loading

- [ ] **Step 10: Run Fetch then test a chat query end-to-end**

1. Click "Fetch Latest" — wait for it to complete
2. Open Chat panel
3. Type: `What stocks were mentioned in the last 24 hours?`
4. Verify Claude calls `search_summaries`, finds videos, and returns an answer citing channel names and video titles

- [ ] **Step 11: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add chat side panel with slide-in animation and message bubbles"
```
