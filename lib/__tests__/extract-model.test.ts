import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture what the SDK is actually asked for, so "summaries use the new model"
// is verified against the request rather than by reading the source.
const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create };
  },
}));

const reply = (text: string) => ({
  content: [{ type: 'text', text }],
  usage: { input_tokens: 100, output_tokens: 20 },
});

beforeEach(() => {
  create.mockReset();
  delete process.env.SUMMARY_MODEL;
  delete process.env.EXTRACT_MODEL;
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
