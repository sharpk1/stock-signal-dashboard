import { describe, it, expect } from 'vitest';
import { ETORO_SNAPSHOTS, getHoldingIndex } from '@/lib/etoro';
import { CHANNELS } from '@/lib/channels';

describe('eToro snapshots', () => {
  it('belong to channels that exist', () => {
    const ids = new Set(CHANNELS.map((c) => c.channelId));
    for (const s of ETORO_SNAPSHOTS) expect(ids.has(s.channelId)).toBe(true);
  });

  it('have one row per ticker and plausible weights', () => {
    for (const s of ETORO_SNAPSHOTS) {
      const tickers = s.positions.map((p) => p.ticker);
      expect(new Set(tickers).size).toBe(tickers.length);
      const invested = s.positions.reduce((a, p) => a + p.investedPct, 0);
      expect(invested).toBeGreaterThan(0);
      expect(invested).toBeLessThanOrEqual(100.5);
      expect(s.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('matches mentions by US ticker, including foreign listings', () => {
    const index = getHoldingIndex();
    expect(index.get('thepopularinvestor|CCOI')?.invested_pct).toBe(8.11);
    expect(index.get('thepopularinvestor|NVO')?.invested_pct).toBe(3.19);
    expect(index.get('thepopularinvestor|T')?.value_pct).toBe(5.07);
  });

  it('has no entry for what is not held, rather than a zero', () => {
    const index = getHoldingIndex();
    expect(index.get('thepopularinvestor|NVDA')).toBeUndefined();
    expect(index.get('UCnMn36GT_H0X-w5_ckLtlgQ|ADBE')).toBeUndefined();
  });
});

describe('holdings as the page shows them', () => {
  const snapshot = ETORO_SNAPSHOTS.find(s => s.channelId === 'thepopularinvestor')!;

  it('has a snapshot for Robert Reynolds to display', () => {
    expect(snapshot).toBeDefined();
    expect(snapshot.positions.length).toBeGreaterThan(0);
  });

  it('carries an invested % for every position, which is what it ranks by', () => {
    for (const position of snapshot.positions) {
      expect(typeof position.investedPct).toBe('number');
      expect(position.investedPct).toBeGreaterThan(0);
    }
  });

  it('ranks by invested %, heaviest first', () => {
    const ranked = [...snapshot.positions].sort((a, b) => b.investedPct - a.investedPct);
    expect(ranked[0].ticker).toBe('CCOI');
    expect(ranked[0].investedPct).toBe(8.11);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].investedPct).toBeGreaterThanOrEqual(ranked[i].investedPct);
    }
  });

  it('carries the date it was last updated', () => {
    expect(snapshot.asOf).toBe('2026-09-29');
  });

  it('names the eToro account the holdings were copied from', () => {
    expect(snapshot.etoroUser.toLowerCase()).toBe('robertmerc');
  });
});
