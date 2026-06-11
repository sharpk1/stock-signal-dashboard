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
  } catch {
    return [];
  }
}

export async function extractTickers(transcript: string, videoTitle: string): Promise<TickerMention[]> {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
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
        content: `Video title: ${videoTitle}\n\nTranscript:\n${transcript.slice(0, 60000)}`,
      },
    ],
  });

  const raw = message.content[0].type === 'text' ? message.content[0].text : '';
  return parseExtractionResponse(raw);
}
