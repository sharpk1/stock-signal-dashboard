import { describe, it, expect } from 'vitest';
import { monthKey, monthlyBudgetUsd, budgetReached, crossedLevel, decideBudgetAlert, levelsCovered,
         BudgetReachedError, DEFAULT_MONTHLY_BUDGET_USD, type BudgetAlertLevel } from '@/lib/budget';
import { detectCreditProblem } from '@/lib/alerts';

describe('monthKey', () => {
  it('buckets by calendar month', () => {
    expect(monthKey(new Date('2026-10-29T12:00:00Z'))).toBe('2026-10');
  });

  it('uses UTC, not local time, at the month boundary', () => {
    // 11:30pm on Oct 31 in Denver is already November in UTC.
    expect(monthKey(new Date('2026-10-31T23:30:00-06:00'))).toBe('2026-11');
    expect(monthKey(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11');
    expect(monthKey(new Date('2026-10-31T23:59:59.999Z'))).toBe('2026-10');
  });

  it('rolls over the year', () => {
    expect(monthKey(new Date('2027-01-01T00:00:00Z'))).toBe('2027-01');
  });
});

describe('monthlyBudgetUsd', () => {
  it('defaults to $50 when unset or blank', () => {
    expect(monthlyBudgetUsd(undefined)).toBe(DEFAULT_MONTHLY_BUDGET_USD);
    expect(monthlyBudgetUsd('  ')).toBe(50);
  });

  it('reads a configured cap', () => {
    expect(monthlyBudgetUsd('75')).toBe(75);
    expect(monthlyBudgetUsd(' 12.5 ')).toBe(12.5);
  });

  it('allows zero, which stops all AI calls', () => {
    expect(monthlyBudgetUsd('0')).toBe(0);
  });

  it('falls back to the default on a typo or a negative, rather than lifting the cap', () => {
    expect(monthlyBudgetUsd('$50')).toBe(50);
    expect(monthlyBudgetUsd('-10')).toBe(50);
  });
});

describe('budgetReached', () => {
  it('is reached at the cap, not only past it', () => {
    expect(budgetReached(49.99, 50)).toBe(false);
    expect(budgetReached(50, 50)).toBe(true);
    expect(budgetReached(51, 50)).toBe(true);
  });

  it('is always reached with a zero cap', () => {
    expect(budgetReached(0, 0)).toBe(true);
  });
});

describe('crossedLevel', () => {
  it('is null below 80%', () => {
    expect(crossedLevel(39.99, 50)).toBeNull();
  });

  it('is 80 from 80% up to the cap', () => {
    expect(crossedLevel(40, 50)).toBe(80);
    expect(crossedLevel(49.99, 50)).toBe(80);
  });

  it('is 100 at the cap', () => {
    expect(crossedLevel(50, 50)).toBe(100);
  });
});

describe('decideBudgetAlert', () => {
  const none = new Set<BudgetAlertLevel>();

  it('sends nothing below 80%', () => {
    expect(decideBudgetAlert('2026-10', 10, 50, none)).toBeNull();
  });

  it('sends the 80% alert when spend first crosses it', () => {
    expect(decideBudgetAlert('2026-10', 41, 50, none)).toEqual({ level: 80, month: '2026-10', spentUsd: 41, capUsd: 50 });
  });

  it('sends the 80% alert only once a month', () => {
    // The cron runs every three hours; each later run sees it already sent.
    const sent = new Set<BudgetAlertLevel>([80]);
    expect(decideBudgetAlert('2026-10', 42, 50, sent)).toBeNull();
    expect(decideBudgetAlert('2026-10', 45, 50, sent)).toBeNull();
  });

  it('still sends the 100% alert after the 80% one', () => {
    const alert = decideBudgetAlert('2026-10', 50.2, 50, new Set<BudgetAlertLevel>([80]));
    expect(alert?.level).toBe(100);
  });

  it('sends the 100% alert only once', () => {
    expect(decideBudgetAlert('2026-10', 55, 50, new Set<BudgetAlertLevel>([80, 100]))).toBeNull();
  });

  it('skips straight to 100% when a month jumps past both, and that covers 80% too', () => {
    const alert = decideBudgetAlert('2026-10', 60, 50, none);
    expect(alert?.level).toBe(100);
    expect(levelsCovered(alert!)).toEqual([80, 100]);
  });

  it('records only 80% for an 80% alert', () => {
    expect(levelsCovered({ level: 80, month: '2026-10', spentUsd: 41, capUsd: 50 })).toEqual([80]);
  });
});

describe('BudgetReachedError', () => {
  it('says the monthly budget is reached, with the figures', () => {
    const err = new BudgetReachedError(50.123, 50);
    expect(err.message).toContain('Monthly AI budget reached');
    expect(err.message).toContain('$50.12 of $50.00');
  });

  it('is not mistaken for running out of credit', () => {
    // That alert is about Anthropic's balance; a capped month is a separate email.
    expect(detectCreditProblem([new BudgetReachedError(50, 50).message])).toBeNull();
  });
});
