import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'crypto';
import { createClient, type Client } from '@libsql/client';

vi.mock('@/lib/extract', () => ({
  extractTickers: vi.fn(async (text: string) =>
    text.includes('$NVDA') ? [{ ticker: 'NVDA', sentiment: 'bullish', conviction: 80, quote: 'NVDA' }] : []),
  generateSummary: vi.fn(async () => 'a summary'),
}));

import { initDb, getSourceStatuses, getSourceAlertStates } from '@/lib/db';
import { runXSources, type XRunContext } from '@/lib/x-fetch';
import { saveXAccount, saveXToken, listXAccounts } from '@/lib/x-store';
import { extractTickers, generateSummary } from '@/lib/extract';
import { BudgetReachedError } from '@/lib/budget';

const KEY = randomBytes(32);
const TOKEN = 'secret-bearer-token';
const NOW = new Date('2026-10-30T12:00:00Z');
const CAMILLO = { id: '42', username: 'ChrisCamillo', name: 'Chris Camillo', avatarUrl: null };

async function makeDb(withToken = true): Promise<Client> {
  const db = createClient({ url: ':memory:' });
  await initDb(db);
  await saveXAccount(db, CAMILLO);
  if (withToken) await saveXToken(db, TOKEN, KEY);
  return db;
}

function ctx(db: Client, over: Partial<XRunContext> = {}): XRunContext {
  return {
    db, deadline: Date.now() + 60_000, disabled: new Set(), errors: [],
    checkBudget: async () => true, noteBudgetReached: () => {},
    tokenKey: () => KEY, now: NOW, ...over,
  };
}

function post(id: string, text: string) {
  return { id, text, created_at: '2026-10-29T15:00:00.000Z' };
}

function stubX(status: number, body: unknown) {
  const fn = vi.fn(async (..._args: [string]) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('runXSources', () => {
  it('stores each post as an X item with tickers, then moves since_id', async () => {
    const db = await makeDb();
    const fn = stubX(200, {
      data: [post('1851000000000000002', 'Loading up on $NVDA here'), post('1851000000000000001', 'gm')],
      meta: { newest_id: '1851000000000000002' },
    });
    const c = ctx(db);
    const result = await runXSources(c);

    expect(new URL(fn.mock.calls[0][0]).searchParams.get('start_time')).toBe('2026-10-23T12:00:00.000Z');
    expect(result.processed).toBe(2);
    expect(result.tickersFound).toBe(1);
    expect(result.newVideos.find(v => v.tickers.length)).toMatchObject({
      channelName: 'Chris Camillo', url: 'https://x.com/ChrisCamillo/status/1851000000000000002', tickers: ['NVDA'],
    });

    const items = (await db.execute("SELECT video_id, channel_id, title, transcript, extracted_at FROM videos ORDER BY video_id")).rows;
    expect(items.map(i => i.video_id)).toEqual(['x-ChrisCamillo-1851000000000000001', 'x-ChrisCamillo-1851000000000000002']);
    expect(items.every(i => i.channel_id === 'x-42' && i.extracted_at)).toBe(true);
    expect((await listXAccounts(db))[0].sinceId).toBe('1851000000000000002');

    const [status] = (await getSourceStatuses(db)).filter(s => s.channelId === 'x-42');
    expect(status).toMatchObject({ lastRunOk: true, lastSuccessItems: 2 });
    expect(c.errors).toEqual([]);
  });

  it('asks only for posts after since_id on the next pull', async () => {
    const db = await makeDb();
    stubX(200, { data: [post('1851000000000000002', 'first')], meta: { newest_id: '1851000000000000002' } });
    await runXSources(ctx(db));

    const fn = stubX(200, { meta: { result_count: 0 } });
    await runXSources(ctx(db));
    const url = new URL(fn.mock.calls[0][0]);
    expect(url.searchParams.get('since_id')).toBe('1851000000000000002');
    expect(url.searchParams.get('start_time')).toBeNull();
    // Already analysed: not sent to extraction again.
    expect(extractTickers).toHaveBeenCalledTimes(1);
  });

  it('summarises long posts only', async () => {
    const db = await makeDb();
    stubX(200, { data: [post('1851000000000000002', 'x'.repeat(500)), post('1851000000000000001', 'short')] });
    await runXSources(ctx(db));
    expect(generateSummary).toHaveBeenCalledTimes(1);
    expect(extractTickers).toHaveBeenCalledTimes(2);
  });

  it('a 401 is a failed run with a clear error, so the alert fires', async () => {
    const db = await makeDb();
    stubX(401, { title: 'Unauthorized', detail: 'Unauthorized' });
    const c = ctx(db);
    await runXSources(c);

    expect(c.errors[0]).toMatch(/^Chris Camillo: fetch failed — X rejected the token \(HTTP 401\)/);
    expect(c.errors.join()).not.toContain(TOKEN);
    const [state] = (await getSourceAlertStates(db)).filter(s => s.channelId === 'x-42');
    expect(state).toMatchObject({ latestOk: false });
    expect(state.latestError).toMatch(/HTTP 401/);
  });

  it('a 429 is a failed run, and the other accounts are not asked', async () => {
    const db = await makeDb();
    await saveXAccount(db, { id: '43', username: 'HolySmokas', name: 'Holy Smokas', avatarUrl: null });
    const fn = stubX(429, { title: 'Too Many Requests' });
    const c = ctx(db);
    await runXSources(c);

    expect(fn).toHaveBeenCalledTimes(1);
    const states = (await getSourceAlertStates(db)).filter(s => s.channelId.startsWith('x-'));
    expect(states).toHaveLength(2);
    for (const s of states) {
      expect(s.latestOk).toBe(false);
      expect(s.latestError).toMatch(/rate limit hit \(HTTP 429\)/);
    }
  });

  it('no token saved: skipped quietly, nothing recorded as failing', async () => {
    const db = await makeDb(false);
    const fn = stubX(200, {});
    const c = ctx(db);
    const result = await runXSources(c);

    expect(fn).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
    expect(c.errors).toEqual([]);
    expect((await db.execute('SELECT COUNT(*) AS n FROM source_runs')).rows[0].n).toBe(0);
  });

  it('a token that cannot be decrypted is a failed run', async () => {
    const db = await makeDb();
    const fn = stubX(200, {});
    const c = ctx(db, { tokenKey: () => randomBytes(32) });
    await runXSources(c);

    expect(fn).not.toHaveBeenCalled();
    expect(c.errors[0]).toMatch(/can't be decrypted/);
    const [state] = (await getSourceAlertStates(db)).filter(s => s.channelId === 'x-42');
    expect(state.latestOk).toBe(false);
  });

  it('a switched-off account is skipped without calling X', async () => {
    const db = await makeDb();
    const fn = stubX(200, {});
    const result = await runXSources(ctx(db, { disabled: new Set(['x-42']) }));
    expect(fn).not.toHaveBeenCalled();
    expect(result.skippedChannels).toEqual(['Chris Camillo']);
  });

  it('once the budget cap is reached, posts are saved but left for a later run', async () => {
    const db = await makeDb();
    stubX(200, { data: [post('1851000000000000001', '$NVDA')], meta: { newest_id: '1851000000000000001' } });
    vi.mocked(extractTickers).mockRejectedValueOnce(new BudgetReachedError(20, 20));
    const noteBudgetReached = vi.fn();
    await runXSources(ctx(db, { noteBudgetReached }));

    expect(noteBudgetReached).toHaveBeenCalled();
    const row = (await db.execute('SELECT extracted_at, transcript_attempts FROM videos')).rows[0];
    expect(row).toMatchObject({ extracted_at: null, transcript_attempts: 0 });

    // The next run picks it up from the database, without re-reading it from X.
    stubX(200, { meta: { result_count: 0 } });
    const result = await runXSources(ctx(db));
    expect(result.tickersFound).toBe(1);
  });
});
