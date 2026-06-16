# Chat System Architecture — Research Notes

**Date:** June 11, 2026  
**Context:** Planning a conversational AI layer on top of the stock signals dashboard so Ray can query YouTube transcripts, Substack posts, and newsletters naturally.

---

## What Ray Wants

1. **Conversational queries** — "What's Jeremy saying about Celsius?" "What's the consensus on SOFI?"
2. **Exact quotes** — retrieve the actual verbatim snippet from the transcript
3. **Non-YouTube sources** — Robert Reynolds' Substack, Royce Jacobs' daily newsletter
4. **Memory** — system remembers Ray's preferences, portfolio positions, and past conclusions across sessions
5. **Teaching** — feed in Ray's notes and investment framework as a baseline

**Ray's Key Influencers (weighted):**
- Robert Reynolds (Substack, unlisted YouTube) — #1, ~85% of conviction
- Financial Education (Jeremy) — #2
- Dumb Money — #3
- Royce Jacobs (YouTube, Teachable newsletter, options trader) — #4

---

## Option A: Claude API + Tool Use (Recommended)

### How It Works

Claude doesn't directly touch the database. Your application code is the middleman:

```
User asks question
  → /api/chat endpoint
  → Send question + tool definitions to Claude API
  → Claude returns: "call search_summaries with these args"
  → Your code runs the SQL query
  → Send result back to Claude
  → Claude returns: "call get_full_transcript for video abc123"
  → Your code fetches transcript
  → Claude returns final answer with exact quote
```

### Tools Defined

```typescript
const tools = [
  {
    name: "search_summaries",
    description: "Search video/document summaries by channel, topic, or date range",
    input_schema: {
      properties: {
        query:   { type: "string" },
        channel: { type: "string" },
        days:    { type: "number" }
      }
    }
  },
  {
    name: "get_full_transcript",
    description: "Get full transcript to extract exact quotes",
    input_schema: {
      properties: { video_id: { type: "string" } }
    }
  },
  {
    name: "save_memory",
    description: "Save something Ray wants remembered for future conversations",
    input_schema: {
      properties: { content: { type: "string" } }
    }
  }
]
```

### The Tool Use Loop

```typescript
const messages = [{ role: "user", content: question }];

while (true) {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    tools,
    messages,
  });

  if (response.stop_reason === "end_turn") {
    // Claude is done — return the answer
    return response.content.find(b => b.type === "text")?.text;
  }

  // Claude wants to call a tool — execute the SQL and feed result back
  const toolUse = response.content.find(b => b.type === "tool_use");
  const result = executeTool(toolUse.name, toolUse.input, db);

  messages.push(
    { role: "assistant", content: response.content },
    { role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: result }] }
  );
}
```

Typically 2–3 tool calls per question, ~5–10 seconds total response time.

---

## Database Changes Required

### Add to `videos` table (already exists)

```sql
ALTER TABLE videos ADD COLUMN transcript TEXT;   -- full raw transcript
ALTER TABLE videos ADD COLUMN summary    TEXT;   -- AI-generated structured summary
```

### New `documents` table (Substack, newsletters)

```sql
CREATE TABLE documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id   TEXT NOT NULL REFERENCES channels(channel_id),
  source_type  TEXT NOT NULL,   -- 'substack', 'newsletter', 'email'
  source_url   TEXT,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,   -- raw text
  summary      TEXT,
  published_at TEXT NOT NULL,
  fetched_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### New `memories` table

```sql
CREATE TABLE memories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  content    TEXT NOT NULL,   -- "Ray prefers 6-12 month swing trades"
  source     TEXT NOT NULL,   -- 'explicit' or 'extracted'
  created_at TEXT DEFAULT (datetime('now'))
);
```

### New `conversations` table

```sql
CREATE TABLE conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

## Summary Generation (at Ingestion Time)

After fetching each transcript, run a Claude Haiku call to generate a structured summary (~$0.001/video):

```
Source: Financial Education — "Top Picks for Q3" (Jun 10)
Tickers: CELH (bullish, $50 target, 12mo), CRM (hold), SOFI (adding)
Key quotes: "Celsius is my highest conviction pick right now"
Timeline: "end of year", "6-9 month setup"
```

This is what `search_summaries` queries against. Summaries allow querying months of content without hitting context window limits (~500 tokens/summary vs ~8,000 tokens/full transcript).

---

## Memory System

At the start of every chat session, inject memories and recent conversation history into the system prompt:

```typescript
const memories = db.prepare('SELECT content FROM memories ORDER BY created_at DESC').all();
const recent = db.prepare('SELECT question, answer FROM conversations ORDER BY created_at DESC LIMIT 5').all();

const systemPrompt = `
You are Ray's personal stock research assistant.

What you know about Ray:
${memories.map(m => `- ${m.content}`).join('\n')}

Recent conversations:
${recent.map(c => `Q: ${c.question}\nA: ${c.answer}`).join('\n\n')}
`;
```

**Three ways memory gets written:**
1. Ray says "remember X" → Claude calls `save_memory` tool explicitly
2. Background Claude call after each conversation extracts implicit learnings
3. Ray says "update that" → replaces the old memory entry

**What Ray's memory looks like after a few weeks:**
```
- Ray prefers 6-12 month swing trades, not day trades
- Ray is long CELH and SOFI with 2+ year horizon
- Ray weights Financial Education and Robert Reynolds highest
- Robert Reynolds' timelines run long — Ray accounts for this
- Ray is not interested in crypto or biotech
- Ray wants options ideas from Royce Jacobs specifically
```

---

## Non-YouTube Source Ingestion

### Robert Reynolds (Substack)
- Ray forwards each newsletter email to a dedicated address
- Postmark inbound webhook parses the email body and POSTs to `/api/inbound-email`
- Route saves content to `documents` table + generates summary

### Royce Jacobs (Daily newsletter/alerts)
- Same pattern — email forwarding → Postmark inbound → `documents` table

Both sources use the same summary format and feed into the same `search_summaries` tool.

---

## Option B: RAG Layer

Build a vector database of all transcript chunks. On query, embed the question, retrieve the most semantically similar chunks, send to Claude.

**Stack:** Embedding model (OpenAI `text-embedding-3-small`) + vector DB (Chroma local, Pinecone managed, or pgvector)

| | Approach A (Tool Use) | RAG |
|---|---|---|
| Build time | 2–3 days | 2 weeks |
| Content volume fit | Perfect for this scale | Overkill |
| Narrative context | ✅ Full transcript | ❌ Loses context in chunks |
| Semantic search | ❌ Keyword only | ✅ Understands meaning |
| Memory | ✅ Designed above | ❌ Still need to build |
| Maintenance | Simple | Complex |
| Cost | ~$0.016/query (Haiku) | ~$0.0006/query at scale |

---

## Limitations of Approach A

| Limitation | Severity | Notes |
|---|---|---|
| Keyword search only | Medium | Minor for ticker-based queries; tickers are exact matches |
| No memory across sessions | Fixed | Memory layer above solves this |
| Latency (2–3 tool calls) | Low | ~5–10s, acceptable |
| Teaching is manual | Medium | System prompt notes maintained by hand |
| Summary quality bottleneck | Medium | Missed summary = missed retrieval |

---

## What "OpenClaw" Likely Means

Otter.ai transcription artifact. Most likely refers to **Ollama** — running open-source LLMs (Llama 3, Mistral) locally on a dedicated Mac 24/7.

**Ollama pros:** Zero API costs, data stays local, runs continuously in background  
**Ollama cons:** Local models significantly weaker than Claude at financial nuance, slower, Mac tied up

For stock research where conviction/sentiment accuracy matters, Claude via API is the better choice over a local model.

---

## Recommended Build Order

1. Add `transcript` + `summary` columns to `videos` table
2. Store full transcripts at ingestion time (already fetching them)
3. Generate summaries via Claude Haiku at ingestion time
4. Add `memories` and `conversations` tables
5. Build `/api/chat` endpoint with tool use loop
6. Add chat UI panel to existing dashboard
7. Set up Postmark inbound webhook for email sources
8. Add `documents` table + ingestion for Substack/newsletter

**Total new infrastructure: zero.** Everything runs on Next.js, SQLite, Anthropic SDK, and Postmark — all already in use.
