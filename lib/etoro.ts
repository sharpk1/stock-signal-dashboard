/**
 * eToro portfolio snapshots, copied by hand from each analyst's public
 * portfolio page (ALT-61).
 *
 * Kept in code rather than scraped or imported: eToro publishes no portfolio
 * API, its pages sit behind bot protection, and a portfolio changes weekly at
 * most. Updating one is an edit to this file and a deploy.
 *
 * A snapshot is replaced wholesale, never merged: a position that has been
 * sold must disappear rather than linger at its last known weight.
 */

export interface EtoroPosition {
  /** US ticker, as the extractor writes it, so mentions can be matched. */
  ticker: string;
  /** The symbol as eToro lists it, when it differs (e.g. "NOVO-B.CO"). */
  etoroSymbol?: string;
  name: string;
  /** eToro's "Invested" column: share of the portfolio put into it, at cost. */
  investedPct: number;
  /** eToro's "Value" column: share of the portfolio at today's prices. */
  valuePct: number;
}

export interface EtoroSnapshot {
  /** Our channel id for the analyst — see lib/channels.ts. */
  channelId: string;
  analyst: string;
  etoroUser: string;
  /** eToro's "Last updated on" date, YYYY-MM-DD. */
  asOf: string;
  positions: EtoroPosition[];
}

export const ETORO_SNAPSHOTS: EtoroSnapshot[] = [
  {
    channelId: 'thepopularinvestor',
    analyst: 'Robert Reynolds',
    etoroUser: 'RobertMERC',
    asOf: '2026-09-29',
    positions: [
      { ticker: 'CCOI', name: 'Cogent Communications Holdings Inc', investedPct: 8.11, valuePct: 5.76 },
      { ticker: 'ADBE', name: 'Adobe Systems Inc', investedPct: 7.2, valuePct: 7.44 },
      { ticker: 'AG', name: 'First Majestic Silver Corp', investedPct: 6.36, valuePct: 5.9 },
      { ticker: 'MOS', name: 'Mosaic Co', investedPct: 5.83, valuePct: 4.97 },
      { ticker: 'ETOR', name: 'eToro Group LTD', investedPct: 5.7, valuePct: 4.07 },
      { ticker: 'DUOL', name: 'Duolingo', investedPct: 5.6, valuePct: 6.12 },
      { ticker: 'BTBT', name: 'Bit Digital Inc', investedPct: 5.09, valuePct: 3.49 },
      { ticker: 'T', etoroSymbol: 'T.US', name: 'AT&T Inc', investedPct: 4.71, valuePct: 5.07 },
      // Held on the Oslo listing; EQNR is the US ADR the extractor will write.
      { ticker: 'EQNR', etoroSymbol: 'EQNR.OL', name: 'Equinor ASA', investedPct: 4.07, valuePct: 7.12 },
      { ticker: 'CCC', etoroSymbol: 'CCC.US', name: 'CCC Intelligent Solutions Holdings Inc', investedPct: 3.25, valuePct: 4.31 },
      // Held on the Copenhagen listing; NVO is the US ADR the extractor will write.
      { ticker: 'NVO', etoroSymbol: 'NOVO-B.CO', name: 'Novo Nordisk B A/S', investedPct: 3.19, valuePct: 3.09 },
      { ticker: 'TRIP', name: 'TripAdvisor Inc', investedPct: 3.13, valuePct: 3.02 },
      { ticker: 'INTU', name: 'Intuit Inc', investedPct: 3.0, valuePct: 2.82 },
      { ticker: 'OSCR', name: 'Oscar Health Inc', investedPct: 2.67, valuePct: 5.84 },
      { ticker: 'MVIS', name: 'MicroVision Inc', investedPct: 2.28, valuePct: 0.17 },
    ],
  },
];

export interface Holding {
  channel_id: string;
  ticker: string;
  invested_pct: number;
  value_pct: number;
  as_of: string;
}

/**
 * Holdings keyed by `channel_id|TICKER`, which is how the leaderboard asks the
 * question: does the person who just said this actually own it?
 */
export function getHoldingIndex(snapshots: EtoroSnapshot[] = ETORO_SNAPSHOTS): Map<string, Holding> {
  const index = new Map<string, Holding>();
  for (const s of snapshots) {
    for (const p of s.positions) {
      index.set(`${s.channelId}|${p.ticker.toUpperCase()}`, {
        channel_id: s.channelId,
        ticker: p.ticker.toUpperCase(),
        invested_pct: p.investedPct,
        value_pct: p.valuePct,
        as_of: s.asOf,
      });
    }
  }
  return index;
}
