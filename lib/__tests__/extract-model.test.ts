import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture what the SDK is actually asked for, so "summaries use the new model"
// is verified against the request rather than by reading the source.
const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create };
  },
}));

// Every call now logs its spend for the monthly cap, so give it an in-memory
// database rather than letting getDb() fall back to the tracked data/signals.db.
vi.mock('@/lib/db', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  const { createClient } = await import('@libsql/client');
  let db: import('@libsql/client').Client | null = null;
  return {
    ...actual,
    getDb: async () => {
      if (!db) {
        db = createClient({ url: ':memory:' });
        await actual.initDb(db);
      }
      return db;
    },
  };
});

const reply = (text: string) => ({
  content: [{ type: 'text', text }],
  usage: { input_tokens: 100, output_tokens: 20 },
});

beforeEach(() => {
  create.mockReset();
  delete process.env.SUMMARY_MODEL;
  delete process.env.EXTRACT_MODEL;
  delete process.env.MONTHLY_AI_BUDGET_USD;
});
afterEach(() => vi.resetModules());

describe('which model each job uses', () => {
  it('sends summaries to Sonnet', async () => {
    const { generateSummary } = await import('@/lib/extract');
    create.mockResolvedValue(reply('a summary'));
    await generateSummary('a short transcript');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].model).toBe('claude-sonnet-5-5');
  });

  it('keeps ticker extraction on Haiku', async () => {
    const { extractTickers } = await import('@/lib/extract');
    create.mockResolvedValue(reply('[]'));
    await extractTickers('a short transcript', 'A video');
    expect(create.mock.calls[0][0].model).toContain('haiku');
  });

  it('honours a SUMMARY_MODEL override', async () => {
    process.env.SUMMARY_MODEL = 'claude-opus-5-5';
    const { generateSummary } = await import('@/lib/extract');
    create.mockResolvedValue(reply('a summary'));
    await generateSummary('a short transcript');
    expect(create.mock.calls[0][0].model).toBe('claude-opus-5-5');
  });

  it('asks the summary prompt for thesis, arguments, tickers and quotes', async () => {
    const { generateSummary } = await import('@/lib/extract');
    create.mockResolvedValue(reply('a summary'));
    await generateSummary('a short transcript');
    const system: string = create.mock.calls[0][0].system;
    for (const expected of ['Thesis', 'Key arguments', 'catalyst', 'horizon', 'Notable quotes']) {
      expect(system).toContain(expected);
    }
  });

  it('asks what changed only when there is a previous summary', async () => {
    const { generateSummary } = await import('@/lib/extract');
    create.mockResolvedValue(reply('a summary'));

    await generateSummary('a short transcript');
    expect(create.mock.calls[0][0].system).not.toContain('What changed');

    create.mockClear();
    await generateSummary('a short transcript', 'what they said last time');
    const systems = create.mock.calls.map(c => c[0].system as string);
    expect(systems.some(s => s.includes('What changed'))).toBe(true);
    expect(systems.some(s => s.includes('what they said last time'))).toBe(true);
  });

  it('records token usage for the run', async () => {
    const { generateSummary } = await import('@/lib/extract');
    const { resetUsage, getUsage } = await import('@/lib/usage');
    resetUsage();
    create.mockResolvedValue(reply('a summary'));
    await generateSummary('a short transcript');
    const usage = getUsage();
    expect(usage.calls).toBe(1);
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(20);
    expect(usage.estimatedCostUsd).toBeGreaterThan(0);
  });
});

describe('monthly budget', () => {
  it('logs each call to the month it was made in', async () => {
    const { generateSummary } = await import('@/lib/extract');
    const { getDb, getMonthSpend } = await import('@/lib/db');
    const { monthKey } = await import('@/lib/budget');
    create.mockResolvedValue(reply('a summary'));
    // The in-memory database outlives a single test, so compare before and after.
    const before = await getMonthSpend(await getDb(), monthKey());
    await generateSummary('a short transcript');
    const after = await getMonthSpend(await getDb(), monthKey());
    expect(after.calls).toBe(before.calls + 1);
    expect(after.spentUsd).toBeGreaterThan(before.spentUsd);
  });

  it('makes no call once the cap is reached', async () => {
    process.env.MONTHLY_AI_BUDGET_USD = '0';
    const { generateSummary, extractTickers } = await import('@/lib/extract');
    const { BudgetReachedError } = await import('@/lib/budget');
    await expect(generateSummary('a short transcript')).rejects.toBeInstanceOf(BudgetReachedError);
    // Not swallowed as one failed chunk: callers need to know it was the cap.
    await expect(extractTickers('a short transcript', 'A video')).rejects.toBeInstanceOf(BudgetReachedError);
    expect(create).not.toHaveBeenCalled();
  });

  it('stops once spend recorded this month reaches the cap', async () => {
    const { generateSummary } = await import('@/lib/extract');
    const { getDb, recordAiSpend } = await import('@/lib/db');
    const { monthKey, BudgetReachedError } = await import('@/lib/budget');
    await recordAiSpend(await getDb(), {
      month: monthKey(), purpose: 'summary', model: 'claude-sonnet-5-5', inputTokens: 0, outputTokens: 0, costUsd: 50,
    });
    await expect(generateSummary('a short transcript')).rejects.toBeInstanceOf(BudgetReachedError);
    expect(create).not.toHaveBeenCalled();
  });
});
