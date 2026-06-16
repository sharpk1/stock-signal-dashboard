# Chat / AI Layer Design Spec

**Date:** 2026-06-12  
**Scope:** Core chat layer — transcript storage, summary generation, chat API with tool use, memory system, chat UI  
**Out of scope:** Email ingestion (Substack/newsletters), deployment

---

## Goal

Let Ray ask natural language questions against YouTube transcripts stored in the existing SQLite database. Claude uses tool calls to retrieve summaries and full transcripts, then returns precise answers with exact quotes. A memory system persists Ray's preferences and past conversations across sessions.

---

## Architecture

Five units, each with a single responsibility:

1. **Schema** — adds transcript/summary columns and two new tables to the existing DB
2. **Ingestion changes** — stores transcript + generates summary at Fetch time
3. **Memory system** — loads Ray's context into every chat session, saves new learnings
4. **Chat API** — `POST /api/chat` runs the Claude tool use loop
5. **Chat UI** — slide-in side panel in `app/page.tsx`

---

## Section 1: Schema

### Changes to `lib/db.ts`

Add two columns to `videos` (ALTER TABLE, swallow "column already exists" error):

```sql
ALTER TABLE videos ADD COLUMN transcript TEXT;
ALTER TABLE videos ADD COLUMN summary    TEXT;
```

Two new tables added to `initDb()`:

```sql
CREATE TABLE IF NOT EXISTS memories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  content    TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'explicit',  -- 'explicit' | 'extracted'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### New DB functions in `lib/db.ts`

```typescript
updateVideoTranscript(db, videoRowId: number, transcript: string, summary: string): void
// UPDATE videos SET transcript = ?, summary = ? WHERE id = ?

saveMemory(db, content: string, source: 'explicit' | 'extracted'): void
// INSERT INTO memories (content, source) VALUES (?, ?)

getMemories(db): string[]
// SELECT content FROM memories ORDER BY created_at DESC

saveConversation(db, question: string, answer: string): void
// INSERT INTO conversations (question, answer) VALUES (?, ?)

getRecentConversations(db, n: number = 5): { question: string; answer: string }[]
// SELECT question, answer FROM conversations ORDER BY created_at DESC LIMIT ?
```

---

## Section 2: Ingestion Pipeline Changes

### Deduplication rules

| Scenario | Behavior |
|---|---|
| Same `video_id` on second Fetch | `saveVideo()` returns existing row ID — no duplicate video row |
| Video exists, `transcript IS NULL` | Fetch transcript + generate summary, fill in both columns |
| Video exists, `transcript` already set | Skip transcript fetch and summary generation entirely |
| Same `(video_id, ticker)` pair | `INSERT OR IGNORE` — no duplicate mention row |

### New flow in `app/api/fetch/route.ts`

```
For each channel:
  1. Fetch RSS → filter to last 24h videos
  2. saveVideo() → returns videoRowId (existing or new)
  3. SELECT transcript FROM videos WHERE id = videoRowId
     → if NULL:
         a. fetch transcript text
         b. generateSummary(transcript) → Claude Haiku call
         c. updateVideoTranscript(db, videoRowId, transcript, summary)
     → if NOT NULL: skip steps a-c
  4. extractTickers(transcript) → Claude Haiku call (existing)
  5. saveMention() for each ticker (INSERT OR IGNORE, existing)
```

### New function in `lib/extract.ts`

```typescript
export async function generateSummary(transcript: string): Promise<string>
```

Claude Haiku call with this system prompt:

```
Summarize this YouTube transcript for a stock research assistant.
Extract: tickers mentioned with sentiment and thesis, key direct quotes,
price targets, timeline language (e.g. "by year end", "6-9 months"),
and overall conviction level.
Format as plain readable text optimized for keyword search.
Keep it under 400 words.
```

Cost: ~$0.001 per video at Haiku rates.

---

## Section 3: Memory System

### System prompt construction (at every chat request)

```typescript
const memories = getMemories(db);
const recent = getRecentConversations(db, 5);

const systemPrompt = `
You are Ray's personal stock research assistant. Answer questions about 
stocks based on what YouTube creators have said in their recent videos.
Always cite which channel and video your answer comes from.
When Ray says "remember X", call the save_memory tool.

What you know about Ray:
${memories.length > 0 ? memories.map(m => `- ${m}`).join('\n') : '(no memories yet)'}

Recent conversations:
${recent.length > 0
  ? recent.map(c => `Q: ${c.question}\nA: ${c.answer}`).join('\n\n')
  : '(no prior conversations)'}
`.trim();
```

### Memory write triggers

1. **Explicit:** Ray says "remember X" → Claude calls `save_memory` tool → `INSERT INTO memories (content, source) VALUES (?, 'explicit')`
2. **Extracted:** After every conversation, a background Haiku call runs:
   ```
   "Based on this Q&A, what did you learn about Ray's preferences or 
   portfolio that should be remembered for future sessions?
   Return a JSON array of strings, or an empty array if nothing new."
   ```
   Each returned string is saved with `source = 'extracted'`. Fire-and-forget (does not block the response).

---

## Section 4: Chat API

### File: `app/api/chat/route.ts`

**Request:** `POST /api/chat` with body `{ question: string }`  
**Response:** `{ answer: string }`

### Tools

```typescript
const tools = [
  {
    name: 'search_summaries',
    description: 'Search video summaries by topic, ticker, or channel. Use this first to find relevant videos.',
    input_schema: {
      type: 'object',
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
      type: 'object',
      properties: {
        video_id: { type: 'string', description: 'The video_id from search_summaries results' },
      },
      required: ['video_id'],
    },
  },
  {
    name: 'save_memory',
    description: "Save something Ray wants remembered in future conversations.",
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact or preference to remember' },
      },
      required: ['content'],
    },
  },
];
```

### Tool execution (SQL)

**`search_summaries`:**
```sql
SELECT title, summary, video_id, published_at, c.name AS channel_name
FROM videos v
JOIN channels c ON v.channel_id = c.channel_id
WHERE v.summary LIKE '%' || ? || '%'
  AND rtrim(replace(v.published_at, 'T', ' '), 'Z') >= datetime('now', '-' || ? || ' days')
  [AND c.name = ?]   -- only if channel provided
ORDER BY v.published_at DESC
LIMIT 10
```

**`get_full_transcript`:**
```sql
SELECT transcript, title, c.name AS channel_name, published_at
FROM videos v
JOIN channels c ON v.channel_id = c.channel_id
WHERE v.video_id = ?
```

**`save_memory`:** calls `saveMemory(db, content, 'explicit')`

### Loop

```typescript
const MAX_TOOL_ITERATIONS = 5;
const messages = [{ role: 'user', content: question }];
let iterations = 0;

while (iterations < MAX_TOOL_ITERATIONS) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    tools,
    messages,
  });

  if (response.stop_reason === 'end_turn') {
    const answer = response.content.find(b => b.type === 'text')?.text ?? 'No answer found.';
    saveConversation(db, question, answer);
    // fire-and-forget: extract memories in background
    extractAndSaveMemories(db, question, answer);
    return NextResponse.json({ answer });
  }

  // execute all tool calls in this response
  const toolResults = await executeToolCalls(response.content, db);
  messages.push(
    { role: 'assistant', content: response.content },
    { role: 'user', content: toolResults },
  );
  iterations++;
}

// cap hit — force a graceful answer
return NextResponse.json({
  answer: "I couldn't find enough information to answer that confidently. Try asking about a specific ticker or channel.",
});
```

---

## Section 5: Chat UI

### Changes to `app/page.tsx`

**New state:**
```typescript
const [chatOpen, setChatOpen] = useState(false);
const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
const [chatInput, setChatInput] = useState('');
const [chatLoading, setChatLoading] = useState(false);
```

**Header change:** Add a Chat button next to Fetch Latest:
```tsx
<button onClick={() => setChatOpen(true)} className="...">
  Chat
</button>
```

**Side panel** (fixed, right side, slides in with CSS transition):
```tsx
<div className={`fixed inset-y-0 right-0 w-96 bg-white shadow-2xl border-l border-gray-200 
                 flex flex-col z-30 transition-transform duration-300
                 ${chatOpen ? 'translate-x-0' : 'translate-x-full'}`}>
  {/* Header */}
  <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
    <span className="font-semibold text-gray-900">Stock Signals AI</span>
    <button onClick={() => setChatOpen(false)}>✕</button>
  </div>

  {/* Messages */}
  <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
    {messages.map((m, i) => (
      <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm
          ${m.role === 'user'
            ? 'bg-blue-600 text-white'
            : 'bg-gray-100 text-gray-800'}`}>
          {m.content}
        </div>
      </div>
    ))}
    {chatLoading && <div className="text-gray-400 text-sm animate-pulse">Thinking…</div>}
  </div>

  {/* Input */}
  <div className="border-t border-gray-200 px-4 py-3 flex gap-2">
    <textarea
      value={chatInput}
      onChange={e => setChatInput(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
      placeholder="Ask anything…"
      rows={1}
      className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm"
    />
    <button onClick={handleSend} disabled={chatLoading} className="...">→</button>
  </div>
</div>
```

**`handleSend` function:**
```typescript
async function handleSend() {
  if (!chatInput.trim() || chatLoading) return;
  const question = chatInput.trim();
  setChatInput('');
  setMessages(prev => [...prev, { role: 'user', content: question }]);
  setChatLoading(true);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const { answer } = await res.json();
    setMessages(prev => [...prev, { role: 'assistant', content: answer }]);
  } finally {
    setChatLoading(false);
  }
}
```

Messages persist for the browser session. Cleared on page refresh. Long-term memory lives in the `conversations` table.

---

## Files Changed

| File | Change |
|---|---|
| `lib/db.ts` | ALTER TABLE + 2 new tables + 5 new functions |
| `lib/extract.ts` | Add `generateSummary()` |
| `app/api/fetch/route.ts` | Add transcript + summary step after saveVideo() |
| `app/api/chat/route.ts` | **New file** — tool use loop |
| `app/page.tsx` | Add chat state + Chat button + side panel |

---

## What This Does Not Cover

- Email ingestion (Substack / Royce Jacobs newsletters) — separate spec
- Deployment with persistent SQLite — separate spec
- Streaming chat responses — can add later if latency feels too long
- Multi-user support — not needed, Ray is the only user
