/**
 * Token accounting for one fetch run, so the cost of a run is visible in its
 * result and its logs.
 *
 * The tally is module-level because the Claude calls are several layers down
 * from runFetch and threading a counter through every one of them would be
 * noise. A run resets it at the start; the cron is serialised, so overlapping
 * runs aren't a concern in practice.
 */

/**
 * Published USD per million tokens, as of October 2026. Deliberately a plain
 * table rather than anything clever: it is an estimate for visibility, not a
 * billing record, and it cannot see spend from outside this app.
 */
const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-opus-5-5': { input: 4, output: 20 },
};

export interface ModelUsage {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Null when the model isn't in the price table above. */
  estimatedCostUsd: number | null;
}

export interface RunUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  /** True when some model had no published price, so the total is a floor. */
  partialCost: boolean;
  byModel: ModelUsage[];
}

interface Counter { calls: number; inputTokens: number; outputTokens: number }

let tally = new Map<string, Counter>();

export function resetUsage(): void {
  tally = new Map();
}

export function recordUsage(model: string, inputTokens: number, outputTokens: number): void {
  const entry = tally.get(model) ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
  entry.calls += 1;
  entry.inputTokens += inputTokens;
  entry.outputTokens += outputTokens;
  tally.set(model, entry);
}

/** Matches an exact id first, then the longest price-table prefix, so a dated
 *  id like `claude-haiku-4-5-20251001` still prices correctly. */
export function priceFor(model: string): { input: number; output: number } | null {
  if (PRICES_PER_MTOK[model]) return PRICES_PER_MTOK[model];
  const prefixes = Object.keys(PRICES_PER_MTOK)
    .filter(known => model.startsWith(known))
    .sort((a, b) => b.length - a.length);
  return prefixes.length > 0 ? PRICES_PER_MTOK[prefixes[0]] : null;
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = priceFor(model);
  if (!price) return null;
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

/**
 * What a call counts for against the monthly cap. A model missing from the
 * price table is charged at the dearest rate in it, so a new model id can't
 * slip past the cap at $0.
 */
export function chargeableCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const known = estimateCostUsd(model, inputTokens, outputTokens);
  if (known !== null) return known;
  const dearest = Object.values(PRICES_PER_MTOK).reduce(
    (max, p) => ({ input: Math.max(max.input, p.input), output: Math.max(max.output, p.output) }),
    { input: 0, output: 0 },
  );
  return (inputTokens / 1_000_000) * dearest.input + (outputTokens / 1_000_000) * dearest.output;
}

export function getUsage(): RunUsage {
  const byModel: ModelUsage[] = [...tally.entries()]
    .map(([model, counter]) => ({
      model,
      calls: counter.calls,
      inputTokens: counter.inputTokens,
      outputTokens: counter.outputTokens,
      estimatedCostUsd: estimateCostUsd(model, counter.inputTokens, counter.outputTokens),
    }))
    .sort((a, b) => (b.estimatedCostUsd ?? 0) - (a.estimatedCostUsd ?? 0));

  return {
    calls: byModel.reduce((sum, m) => sum + m.calls, 0),
    inputTokens: byModel.reduce((sum, m) => sum + m.inputTokens, 0),
    outputTokens: byModel.reduce((sum, m) => sum + m.outputTokens, 0),
    estimatedCostUsd: byModel.reduce((sum, m) => sum + (m.estimatedCostUsd ?? 0), 0),
    partialCost: byModel.some(m => m.estimatedCostUsd === null),
    byModel,
  };
}
