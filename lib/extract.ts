import Anthropic from '@anthropic-ai/sdk';
import { summaryModel, extractModel } from '@/lib/models';
import { recordUsage } from '@/lib/usage';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface TickerMention {
  ticker: string;
  company: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  conviction: number; // 0-100
  quote: string;
}

/**
 * The text of a reply, from every text block. Sonnet 5.5 thinks by default, so
 * `content[0]` is a thinking block and reading only it returned '' — every
 * summary came back empty, and the "What changed" pass then sent that empty
 * string back and got a 400.
 */
export function responseText(message: Pick<Anthropic.Message, 'content'>): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim();
}

export function parseExtractionResponse(raw: string): TickerMention[] {
  try {
    // The model sometimes fences the array and then explains itself, so take
    // what is inside the fence rather than trimming fences off the ends.
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const cleaned = (fenced ? fenced[1] : raw).trim();
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

export async function extractTickers(
  transcript: string,
  videoTitle: string,
  sourceLabel: string = 'Video title',
): Promise<TickerMention[]> {
  const chunks = chunkTranscript(transcript);
  const perChunk: TickerMention[][] = [];
  const failures: unknown[] = [];

  for (const [index, chunk] of chunks.entries()) {
    // Tell Claude it is seeing part of a longer stream so it doesn't read the
    // opening of a chunk as the start of the show.
    const part = chunks.length > 1 ? ` (part ${index + 1} of ${chunks.length})` : '';
    try {
      perChunk.push(await extractTickersFromChunk(chunk, `${videoTitle}${part}`, sourceLabel));
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

async function extractTickersFromChunk(
  transcript: string,
  videoTitle: string,
  sourceLabel: string,
): Promise<TickerMention[]> {
  const model = extractModel();
  const message = await client.messages.create({
    model,
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
        content: `${sourceLabel}: ${videoTitle}\n\nContent:\n${transcript}`,
      },
    ],
  });

  recordUsage(model, message.usage.input_tokens, message.usage.output_tokens);
  return parseExtractionResponse(responseText(message));
}

const SUMMARY_SYSTEM_PROMPT = `You are summarising one piece of a stock commentator's output for a research dashboard. Write for a reader deciding whether this is worth their time and what the person actually thinks.

Cover, in this order, as plain readable prose under clear short headings:

1. Thesis — the central argument in two or three sentences. What is this person actually claiming?
2. Key arguments — the reasoning that supports it, including the evidence they lean on and any caveats or contradictions they raise themselves.
3. Tickers — for each one they make a real point about: the direction they lean (bullish, bearish, neutral), the rough time horizon they imply ("by year end", "6-9 months", "long term", or none stated), and the catalyst they expect to move it. Say plainly when they state no horizon or no catalyst rather than inventing one.
4. Notable quotes — a few verbatim lines that carry the call, with no paraphrasing.

Rules:
- Plain readable text. No markdown tables, no JSON, no bullet soup — short paragraphs and simple lists a person can read straight through.
- Stay with what they said. Do not add your own market view, price target or recommendation.
- Where they hedge, say they hedge. Conviction matters as much as direction.
- Keep it under 450 words.`;

/**
 * Appended when the channel has an earlier summary. Ray wants to see movement,
 * not just a fresh snapshot each time — what has changed since this person last
 * spoke is often the whole signal.
 */
function changeSincePrompt(previousSummary: string): string {
  return `\n\nThis person's previous summary follows. End your summary with a short "What changed" section: new positions or tickers, anything they have reversed or softened on, and arguments they have dropped. If nothing meaningful has changed, say so in one line — do not manufacture a difference.\n\n--- PREVIOUS SUMMARY ---\n${previousSummary}`;
}

export async function generateSummary(
  transcript: string,
  previousSummary?: string | null,
): Promise<string> {
  const chunks = chunkTranscript(transcript);
  // Only the final pass gets the previous summary: a per-chunk comparison would
  // report the same changes several times over.
  const perChunkPrompt = SUMMARY_SYSTEM_PROMPT;
  const change = previousSummary ? changeSincePrompt(previousSummary) : '';

  const partials: string[] = [];
  for (const chunk of chunks) {
    partials.push(await summarizeChunk(chunk, perChunkPrompt));
  }

  if (partials.length === 1) {
    if (!change) return partials[0];
    // One more pass, purely to add the "What changed" section against the
    // previous summary.
    return summarizeChunk(
      partials[0],
      `${SUMMARY_SYSTEM_PROMPT}\n\nThe input is a finished summary of this person's latest piece. Return it unchanged except for adding the section described below.${change}`,
    );
  }

  // Condense the per-part summaries so a long stream still gets one summary of
  // the same shape and length as a short video's.
  return summarizeChunk(
    partials.join('\n\n'),
    `${SUMMARY_SYSTEM_PROMPT}\n\nThe input is a sequence of summaries of consecutive parts of one long stream. Merge them into a single summary, keeping every ticker and quote.${change}`,
  );
}

async function summarizeChunk(transcript: string, system: string): Promise<string> {
  const model = summaryModel();
  const message = await client.messages.create({
    model,
    max_tokens: 2048,
    system,
    messages: [{ role: 'user', content: transcript }],
  });
  recordUsage(model, message.usage.input_tokens, message.usage.output_tokens);
  const text = responseText(message);
  // Fail loudly here: an empty summary saved quietly is what hid this for days.
  if (!text) throw new Error(`summary came back with no text (stop_reason: ${message.stop_reason})`);
  return text;
}
