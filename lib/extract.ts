import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface TickerMention {
  ticker: string;
  company: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  conviction: 'high' | 'medium' | 'low';
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
      typeof item?.ticker === 'string' && item.ticker.length > 0
    );
  } catch {
    return [];
  }
}

export async function extractTickers(transcript: string, videoTitle: string): Promise<TickerMention[]> {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: `You are a stock research assistant. Extract every stock ticker the host is making a meaningful point about. Ignore casual market references. Resolve company names to tickers.

Return strict JSON array:
[
  {
    "ticker": "CRM",
    "company": "Salesforce",
    "sentiment": "bullish" | "bearish" | "neutral",
    "conviction": "high" | "medium" | "low",
    "quote": "<verbatim short quote supporting the call>"
  }
]

Conviction rubric:
- high: host explicitly recommends buying/selling, gives price target, or says "I'm buying this"
- medium: host discusses positively/negatively with analysis but no explicit action
- low: mentioned in passing or as part of a list

Return only the JSON array, no other text.`,
    messages: [
      {
        role: 'user',
        content: `Video title: ${videoTitle}\n\nTranscript:\n${transcript.slice(0, 8000)}`,
      },
    ],
  });

  const raw = message.content[0].type === 'text' ? message.content[0].text : '';
  return parseExtractionResponse(raw);
}
