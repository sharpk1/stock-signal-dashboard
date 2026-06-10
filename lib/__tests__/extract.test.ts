import { describe, it, expect } from 'vitest';
import { parseExtractionResponse, type TickerMention } from '@/lib/extract';

describe('parseExtractionResponse', () => {
  it('parses valid JSON array from Claude response', () => {
    const raw = JSON.stringify([
      { ticker: 'CRM', company: 'Salesforce', sentiment: 'bullish', conviction: 'high', quote: "I'm buying CRM" },
      { ticker: 'NOW', company: 'ServiceNow', sentiment: 'bullish', conviction: 'medium', quote: 'ServiceNow looks great' },
    ]);
    const result = parseExtractionResponse(raw);
    expect(result).toHaveLength(2);
    expect(result[0].ticker).toBe('CRM');
    expect(result[1].conviction).toBe('medium');
  });

  it('returns empty array for malformed JSON', () => {
    expect(parseExtractionResponse('not json at all')).toEqual([]);
  });

  it('returns empty array for empty JSON array', () => {
    expect(parseExtractionResponse('[]')).toEqual([]);
  });

  it('strips markdown code blocks if Claude wraps in ```json', () => {
    const raw = '```json\n[{"ticker":"AAPL","company":"Apple","sentiment":"bullish","conviction":"low","quote":"mentioned Apple"}]\n```';
    const result = parseExtractionResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].ticker).toBe('AAPL');
  });

  it('filters out entries missing required fields', () => {
    const raw = JSON.stringify([
      { ticker: 'CRM', company: 'Salesforce', sentiment: 'bullish', conviction: 'high', quote: 'q' },
      { company: 'No Ticker', sentiment: 'bullish', conviction: 'high', quote: 'q' },
      { ticker: '', company: 'Empty Ticker', sentiment: 'bullish', conviction: 'high', quote: 'q' },
    ]);
    const result = parseExtractionResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].ticker).toBe('CRM');
  });
});
