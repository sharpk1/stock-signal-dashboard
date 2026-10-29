import { describe, it, expect, beforeEach } from 'vitest';
import { resetUsage, recordUsage, getUsage, priceFor, estimateCostUsd } from '@/lib/usage';

beforeEach(() => resetUsage());

describe('priceFor', () => {
  it('prices a known model', () => {
    expect(priceFor('claude-sonnet-5-5')).toEqual({ input: 2, output: 10 });
  });

  it('prices a dated model id by its prefix', () => {
    expect(priceFor('claude-haiku-4-5-20251001')).toEqual({ input: 1, output: 5 });
  });

  it('returns null for a model it does not know', () => {
    expect(priceFor('some-future-model')).toBeNull();
  });
});

describe('estimateCostUsd', () => {
  it('costs a million tokens at the published rate', () => {
    expect(estimateCostUsd('claude-sonnet-5-5', 1_000_000, 1_000_000)).toBeCloseTo(12, 6);
  });

  it('returns null when the model has no price', () => {
    expect(estimateCostUsd('some-future-model', 1000, 1000)).toBeNull();
  });
});

describe('run usage tally', () => {
  it('starts empty', () => {
    const usage = getUsage();
    expect(usage.calls).toBe(0);
    expect(usage.estimatedCostUsd).toBe(0);
    expect(usage.byModel).toEqual([]);
  });

  it('adds up calls across models', () => {
    recordUsage('claude-sonnet-5-5', 1000, 500);
    recordUsage('claude-sonnet-5-5', 2000, 400);
    recordUsage('claude-haiku-4-5-20251001', 5000, 100);
    const usage = getUsage();
    expect(usage.calls).toBe(3);
    expect(usage.inputTokens).toBe(8000);
    expect(usage.outputTokens).toBe(1000);
    expect(usage.byModel).toHaveLength(2);
  });

  it('ranks the most expensive model first', () => {
    recordUsage('claude-haiku-4-5-20251001', 1000, 100);
    recordUsage('claude-sonnet-5-5', 100_000, 10_000);
    expect(getUsage().byModel[0].model).toBe('claude-sonnet-5-5');
  });

  it('flags a total that is only a floor when a model has no price', () => {
    recordUsage('some-future-model', 1000, 100);
    const usage = getUsage();
    expect(usage.partialCost).toBe(true);
    expect(usage.byModel[0].estimatedCostUsd).toBeNull();
  });

  it('resets between runs', () => {
    recordUsage('claude-sonnet-5-5', 1000, 100);
    resetUsage();
    expect(getUsage().calls).toBe(0);
  });
});
