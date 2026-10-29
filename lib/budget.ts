/**
 * The monthly AI spending cap (A1). The app calls Anthropic with Ray's key,
 * and an ordinary API key cannot read the account's spend, so the cap is
 * enforced here, against the cost the app estimates for each of its own calls
 * (lib/usage.ts). Spend outside this app is invisible to it.
 *
 * Everything in this file is pure; the spend itself lives in the ai_spend
 * table (lib/db.ts).
 */

export const DEFAULT_MONTHLY_BUDGET_USD = 50;

/** The two points at which Kush is emailed, as a percentage of the cap. */
export type BudgetAlertLevel = 80 | 100;
export const BUDGET_ALERT_LEVELS: BudgetAlertLevel[] = [80, 100];

/** The calendar month a moment falls in, in UTC, as "YYYY-MM". */
export function monthKey(at: Date = new Date()): string {
  return at.toISOString().slice(0, 7);
}

/**
 * MONTHLY_AI_BUDGET_USD, or $50 when it is unset or unreadable. Zero is
 * allowed and means no AI calls at all; a typo falls back to the default
 * rather than silently lifting the cap.
 */
export function monthlyBudgetUsd(raw: string | undefined = process.env.MONTHLY_AI_BUDGET_USD): number {
  const value = Number(raw?.trim());
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(value) || value < 0) {
    return DEFAULT_MONTHLY_BUDGET_USD;
  }
  return value;
}

export function budgetReached(spentUsd: number, capUsd: number): boolean {
  return spentUsd >= capUsd;
}

/** The highest alert level the spend has crossed, or null below 80%. */
export function crossedLevel(spentUsd: number, capUsd: number): BudgetAlertLevel | null {
  if (budgetReached(spentUsd, capUsd)) return 100;
  if (spentUsd >= capUsd * 0.8) return 80;
  return null;
}

export interface BudgetAlert {
  level: BudgetAlertLevel;
  month: string;
  spentUsd: number;
  capUsd: number;
}

/**
 * The budget email this run should send, if any. Each level goes out once a
 * month: `alreadySent` is what this month has already had. A month that jumps
 * straight past 100% gets only the 100% email — the 80% one would arrive
 * already out of date.
 */
export function decideBudgetAlert(
  month: string,
  spentUsd: number,
  capUsd: number,
  alreadySent: ReadonlySet<BudgetAlertLevel>,
): BudgetAlert | null {
  const level = crossedLevel(spentUsd, capUsd);
  if (level === null || alreadySent.has(level)) return null;
  return { level, month, spentUsd, capUsd };
}

/** Levels to record as sent once `alert` has gone out: a 100% email covers 80% too. */
export function levelsCovered(alert: BudgetAlert): BudgetAlertLevel[] {
  return BUDGET_ALERT_LEVELS.filter(level => level <= alert.level);
}

/**
 * Thrown in place of an AI call once the month's cap is reached, so callers
 * can tell "skipped on purpose" from a real failure.
 */
export class BudgetReachedError extends Error {
  constructor(public spentUsd: number, public capUsd: number) {
    super(budgetReachedMessage(spentUsd, capUsd));
    this.name = 'BudgetReachedError';
  }
}

/** Worded to stay clear of the credit-problem patterns in lib/alerts.ts. */
export function budgetReachedMessage(spentUsd: number, capUsd: number): string {
  return `Monthly AI budget reached ($${spentUsd.toFixed(2)} of $${capUsd.toFixed(2)}). AI summaries, ticker extraction and chat are paused until next month (UTC) or until MONTHLY_AI_BUDGET_USD is raised.`;
}

export interface BudgetStatus {
  month: string;
  spentUsd: number;
  capUsd: number;
  calls: number;
  reached: boolean;
}
