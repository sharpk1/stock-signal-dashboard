/**
 * Imports an analyst's portfolio from a CSV.
 *
 *   npx tsx scripts/import-holdings.ts <channelHandle> <file.csv> [--as-of 2026-09-28]
 *   npx tsx scripts/import-holdings.ts @FinancialEducation jeremy.csv
 *
 * The CSV needs a ticker column and a weight column; header names are matched
 * loosely because eToro's export and a hand-typed sheet do not agree on them.
 *
 * Why an import rather than a scraper: eToro publishes no portfolio API, and
 * the profile pages are JavaScript-rendered behind bot protection. A scraper
 * would be a permanent repair job, and a copy portfolio changes weekly at
 * most. Ray already sends the link by hand — a human is in this loop either
 * way, so the honest version is a paste rather than a fragile crawl.
 */
import { readFileSync } from 'node:fs';
import { getDb, savePortfolioHoldings } from '../lib/db';
import { CHANNELS } from '../lib/channels';

const TICKER_KEYS = ['ticker', 'symbol', 'instrument', 'asset', 'name'];
const WEIGHT_KEYS = ['weight', 'weight_pct', 'allocation', 'invested', 'percent', '%', 'value'];

function pick(header: string[], candidates: string[]): number {
  const lower = header.map((h) => h.trim().toLowerCase().replace(/[^a-z%_]/g, ''));
  for (const c of candidates) {
    const i = lower.findIndex((h) => h === c || h.includes(c));
    if (i !== -1) return i;
  }
  return -1;
}

function parseCsv(text: string): { ticker: string; weightPct: number }[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('empty file');

  const header = lines[0].split(',');
  const tickerAt = pick(header, TICKER_KEYS);
  const weightAt = pick(header, WEIGHT_KEYS);
  if (tickerAt === -1 || weightAt === -1) {
    throw new Error(`could not find a ticker and a weight column in: ${header.join(', ')}`);
  }

  const out: { ticker: string; weightPct: number }[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const ticker = (cells[tickerAt] ?? '').trim().replace(/^\$/, '').toUpperCase();
    // eToro writes "4.12%"; a hand-typed sheet writes 4.12. Both should work.
    const weight = parseFloat((cells[weightAt] ?? '').replace(/[%$,\s]/g, ''));
    if (!ticker || !Number.isFinite(weight)) continue;
    out.push({ ticker, weightPct: weight });
  }
  if (!out.length) throw new Error('no usable rows');
  return out;
}

async function main() {
  const [handle, file] = process.argv.slice(2);
  const asOfArg = process.argv.indexOf('--as-of');
  const asOf = asOfArg !== -1 ? process.argv[asOfArg + 1] : new Date().toISOString().slice(0, 10);

  if (!handle || !file) {
    console.error('usage: import-holdings.ts <channelHandle> <file.csv> [--as-of YYYY-MM-DD]');
    process.exit(1);
  }

  const channel = CHANNELS.find(
    (c) => c.handle.toLowerCase() === handle.toLowerCase() || c.name.toLowerCase() === handle.toLowerCase(),
  );
  if (!channel) {
    console.error(`no channel matching "${handle}". Known: ${CHANNELS.map((c) => c.handle).join(', ')}`);
    process.exit(1);
  }

  const holdings = parseCsv(readFileSync(file, 'utf8'));
  const total = holdings.reduce((a, h) => a + h.weightPct, 0);

  console.log(`${channel.name} (${channel.handle})  as of ${asOf}`);
  for (const h of holdings.sort((a, b) => b.weightPct - a.weightPct)) {
    console.log(`  ${h.ticker.padEnd(8)} ${h.weightPct.toFixed(2)}%`);
  }
  console.log(`  ${holdings.length} positions, ${total.toFixed(1)}% total`);
  // Not an error: a portfolio can hold cash, and a partial paste is still
  // useful. Worth saying out loud so a silently truncated file is noticed.
  if (total < 90 || total > 110) console.log(`  note: weights sum to ${total.toFixed(1)}%, not ~100%`);

  const db = await getDb();
  await savePortfolioHoldings(db, channel.channelId, holdings, asOf);
  console.log(`\nsaved ${holdings.length} holdings for ${channel.name}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
