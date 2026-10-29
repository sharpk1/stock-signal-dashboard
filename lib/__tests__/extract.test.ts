import { describe, it, expect } from 'vitest';
import { parseExtractionResponse, chunkTranscript, mergeMentions, responseText, type TickerMention } from '@/lib/extract';

describe('parseExtractionResponse', () => {
  it('parses valid JSON array from Claude response', () => {
    const raw = JSON.stringify([
      { ticker: 'CRM', company: 'Salesforce', sentiment: 'bullish', conviction: 85, quote: "I'm buying CRM" },
      { ticker: 'NOW', company: 'ServiceNow', sentiment: 'bullish', conviction: 60, quote: 'ServiceNow looks great' },
    ]);
    const result = parseExtractionResponse(raw);
    expect(result).toHaveLength(2);
    expect(result[0].ticker).toBe('CRM');
    expect(result[1].conviction).toBe(60);
  });

  it('returns empty array for malformed JSON', () => {
    expect(parseExtractionResponse('not json at all')).toEqual([]);
  });

  it('returns empty array for empty JSON array', () => {
    expect(parseExtractionResponse('[]')).toEqual([]);
  });

  it('strips markdown code blocks if Claude wraps in ```json', () => {
    const raw = '```json\n[{"ticker":"AAPL","company":"Apple","sentiment":"bullish","conviction":30,"quote":"mentioned Apple"}]\n```';
    const result = parseExtractionResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].ticker).toBe('AAPL');
  });

  it('filters out entries missing required fields', () => {
    const raw = JSON.stringify([
      { ticker: 'CRM', company: 'Salesforce', sentiment: 'bullish', conviction: 90, quote: 'q' },
      { company: 'No Ticker', sentiment: 'bullish', conviction: 90, quote: 'q' },
      { ticker: '', company: 'Empty Ticker', sentiment: 'bullish', conviction: 90, quote: 'q' },
    ]);
    const result = parseExtractionResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].ticker).toBe('CRM');
  });

  it('filters out entries with non-numeric conviction', () => {
    const raw = JSON.stringify([
      { ticker: 'AAPL', company: 'Apple', sentiment: 'bullish', conviction: 'high', quote: 'q' },
      { ticker: 'MSFT', company: 'Microsoft', sentiment: 'bullish', conviction: 75, quote: 'q' },
    ]);
    const result = parseExtractionResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].ticker).toBe('MSFT');
  });
});

describe('chunkTranscript', () => {
  it('leaves a short transcript in one piece', () => {
    expect(chunkTranscript('short enough')).toEqual(['short enough']);
  });

  it('splits a long transcript instead of truncating it', () => {
    // A three-hour livestream runs past 150k characters; nothing may be lost.
    const transcript = 'word '.repeat(40_000).trim(); // 199,999 chars
    const chunks = chunkTranscript(transcript);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(c => c.length <= 60_000)).toBe(true);
    expect(chunks.join(' ')).toBe(transcript);
  });

  it('breaks on whitespace so no word is cut in half', () => {
    const transcript = Array.from({ length: 50 }, (_, i) => `token${i}`).join(' ');
    const chunks = chunkTranscript(transcript, 40);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      for (const token of chunk.split(' ')) {
        expect(token).toMatch(/^token\d+$/);
      }
    }
    expect(chunks.join(' ')).toBe(transcript);
  });

  it('covers the whole transcript when it divides exactly', () => {
    const transcript = 'abcde fghij';
    expect(chunkTranscript(transcript, 11).join(' ')).toBe(transcript);
  });
});

describe('mergeMentions', () => {
  const mention = (ticker: string, conviction: number, quote: string): TickerMention => ({
    ticker,
    company: ticker,
    sentiment: 'bullish',
    conviction,
    quote,
  });

  it('keeps the highest-conviction pass for a ticker repeated across chunks', () => {
    const merged = mergeMentions([
      [mention('NVDA', 40, 'might look at it')],
      [mention('NVDA', 90, 'I am buying more today')],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].conviction).toBe(90);
    expect(merged[0].quote).toBe('I am buying more today');
  });

  it('unions tickers from different chunks, ranked by conviction', () => {
    const merged = mergeMentions([
      [mention('AAPL', 50, 'a')],
      [mention('TSLA', 80, 'b')],
    ]);
    expect(merged.map(m => m.ticker)).toEqual(['TSLA', 'AAPL']);
  });

  it('treats the same ticker in different cases as one', () => {
    const merged = mergeMentions([[mention('msft', 30, 'a')], [mention('MSFT', 70, 'b')]]);
    expect(merged).toHaveLength(1);
    expect(merged[0].ticker).toBe('MSFT');
  });

  it('returns an empty list when no chunk found anything', () => {
    expect(mergeMentions([[], []])).toEqual([]);
  });
});

describe('responseText', () => {
  it('skips a leading thinking block and reads the text after it', () => {
    const message = {
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: 'The summary.', citations: null },
      ],
    } as unknown as Parameters<typeof responseText>[0];
    expect(responseText(message)).toBe('The summary.');
  });

  it('joins several text blocks', () => {
    const message = {
      content: [
        { type: 'text', text: 'Part one. ', citations: null },
        { type: 'text', text: 'Part two.', citations: null },
      ],
    } as unknown as Parameters<typeof responseText>[0];
    expect(responseText(message)).toBe('Part one. Part two.');
  });

  it('returns an empty string when there is no text block', () => {
    const message = {
      content: [{ type: 'thinking', thinking: '', signature: 'sig' }],
    } as unknown as Parameters<typeof responseText>[0];
    expect(responseText(message)).toBe('');
  });
});

describe('parseExtractionResponse with trailing commentary', () => {
  it('reads the fenced array and ignores the explanation after it', () => {
    const raw = '```json\n[{"ticker":"TSLA","company":"Tesla","sentiment":"bullish","conviction":72,"quote":"q"}]\n```\n\nThe content mentions Tesla once.';
    expect(parseExtractionResponse(raw).map(m => m.ticker)).toEqual(['TSLA']);
  });

  it('still reads an empty fenced array followed by prose', () => {
    expect(parseExtractionResponse('```json\n[]\n```\n\nNo specific stocks are discussed.')).toEqual([]);
  });
});
