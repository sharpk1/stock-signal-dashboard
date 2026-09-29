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
