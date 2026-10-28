import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface TickerMention {
  ticker: string;
  company: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  conviction: number; // 0-100
  quote: string;
}

export function parseExtractionResponse(raw: string): TickerMention[] {
  try {
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is TickerMention =>
      typeof item?.ticker === 'string' && item.ticker.length > 0 &&
      typeof item?.conviction === 'number'
    );
  } catch (e) {
    console.error('[parseExtractionResponse] JSON parse failed:', e instanceof Error ? e.message : e, '— raw (first 200):', raw.slice(0, 200));
    return [];
  }
}

/**
 * Claude sees the transcript in chunks of at most this many characters. A
 * three-hour Dumb Money livestream runs well past 150k characters, so a single
 * request had to cut it off — and everything the host said after the first hour
 * was simply lost. Chunking keeps the whole stream in play.
 */
const MAX_CHUNK_CHARS = 60_000;

export function chunkTranscript(transcript: string, maxChars = MAX_CHUNK_CHARS): string[] {
  if (transcript.length <= maxChars) return [transcript];

  const chunks: string[] = [];
  let start = 0;
  while (start < transcript.length) {
    let end = Math.min(start + maxChars, transcript.length);
    if (end < transcript.length) {
      // Break on whitespace so a chunk never ends mid-word.
      const lastSpace = transcript.lastIndexOf(' ', end);
      if (lastSpace > start) end = lastSpace;
    }
    const chunk = transcript.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    start = end;
  }
  return chunks;
}

/**
 * Fold per-chunk extractions into one list. A long stream revisits the same
 * name repeatedly, so keep the highest-conviction pass per ticker — that is the
 * one whose quote carries the host's strongest statement of the call.
 */
export function mergeMentions(lists: TickerMention[][]): TickerMention[] {
  const byTicker = new Map<string, TickerMention>();
  for (const list of lists) {
    for (const mention of list) {
      const ticker = mention.ticker.toUpperCase();
      const seen = byTicker.get(ticker);
      if (!seen || mention.conviction > seen.conviction) {
        byTicker.set(ticker, { ...mention, ticker });
      }
    }
  }
  return [...byTicker.values()].sort((a, b) => b.conviction - a.conviction);
}

export async function extractTickers(transcript: string, videoTitle: string): Promise<TickerMention[]> {
  const chunks = chunkTranscript(transcript);
  const perChunk: TickerMention[][] = [];
  const failures: unknown[] = [];

  for (const [index, chunk] of chunks.entries()) {
    // Tell Claude it is seeing part of a longer stream so it doesn't read the
    // opening of a chunk as the start of the show.
    const part = chunks.length > 1 ? ` (part ${index + 1} of ${chunks.length})` : '';
    try {
      perChunk.push(await extractTickersFromChunk(chunk, `${videoTitle}${part}`));
    } catch (err) {
      failures.push(err);
      console.error(
        `[extractTickers] part ${index + 1}/${chunks.length} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Salvage what came back: one failed chunk shouldn't throw away the rest of a
  // three-hour stream. Only a total failure is worth reporting upward.
  if (failures.length === chunks.length) {
    const first = failures[0];
    throw first instanceof Error ? first : new Error(String(first));
  }

  return mergeMentions(perChunk);
}

async function extractTickersFromChunk(transcript: string, videoTitle: string): Promise<TickerMention[]> {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: `You are a stock research assistant. Extract every stock ticker the host is making a meaningful point about. Ignore casual market references. Resolve company names to tickers.

Return strict JSON array:
[
  {
    "ticker": "CRM",
    "company": "Salesforce",
    "sentiment": "bullish" | "bearish" | "neutral",
    "conviction": <integer 0-100>,
    "quote": "<verbatim short quote supporting the call>"
  }
]

Conviction score (0-100):
- 90-100: Explicit strong buy/sell, large personal position disclosed, ambitious price target (2x+), multiple analyses, "definitely buying/holding", willing to add
- 75-89: Clear recommendation with commitment, meaningful position mentioned, price target 1.5x-2x, solid analysis, minor caveats
- 50-74: Positive/negative analysis but less committed, no/vague position, hedging language ("could be", "might"), would act but not urgently
- 25-49: Brief mention with some reasoning, unclear recommendation, significant caveats, mentioned mainly as example
- 0-24: "I don't know", explicitly dismissive, no meaningful analysis, casual passing reference

Key factors that raise conviction: skin in the game (position size), specificity (price targets, timeframes), depth (multiple supporting points), certainty language ("will" vs "could"), willingness to act.
Key factors that lower conviction: caveats, contradictions, hedging.

Return only the JSON array, no other text.`,
    messages: [
      {
        role: 'user',
        content: `Video title: ${videoTitle}\n\nTranscript:\n${transcript}`,
      },
    ],
  });

  const raw = message.content[0].type === 'text' ? message.content[0].text : '';
  return parseExtractionResponse(raw);
}

const SUMMARY_SYSTEM_PROMPT = `Summarize this YouTube transcript for a stock research assistant.
Extract: tickers mentioned with sentiment and thesis, key direct quotes,
price targets, timeline language (e.g. "by year end", "6-9 months"),
and overall conviction level.
Format as plain readable text optimized for keyword search.
Keep it under 400 words.`;

export async function generateSummary(transcript: string): Promise<string> {
  const chunks = chunkTranscript(transcript);
  const partials: string[] = [];

  for (const chunk of chunks) {
    partials.push(await summarizeChunk(chunk, SUMMARY_SYSTEM_PROMPT));
  }

  if (partials.length === 1) return partials[0];

  // Condense the per-part summaries so a long stream still gets one searchable
  // summary of the same shape and length as a short video's.
  return summarizeChunk(
    partials.join('\n\n'),
    `${SUMMARY_SYSTEM_PROMPT}\n\nThe input is a sequence of summaries of consecutive parts of one long stream. Merge them into a single summary, keeping every ticker and quote.`,
  );
}

async function summarizeChunk(transcript: string, system: string): Promise<string> {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: transcript }],
  });
  return message.content[0].type === 'text' ? message.content[0].text : '';
}
