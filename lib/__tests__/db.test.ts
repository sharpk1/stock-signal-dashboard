import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDb, saveChannel, saveVideo, saveMention, getLeaderboard, getMentionDetails } from '@/lib/db';

function makeTestDb() {
  const db = new Database(':memory:');
  initDb(db);
  return db;
}

describe('initDb', () => {
  it('creates channels table', () => {
    const db = makeTestDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('channels');
    expect(names).toContain('videos');
    expect(names).toContain('ticker_mentions');
  });
});

describe('saveChannel', () => {
  it('inserts a channel', () => {
    const db = makeTestDb();
    saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Test Channel', weight: 0.5 });
    const row = db.prepare('SELECT * FROM channels WHERE channel_id = ?').get('UC123') as { name: string };
    expect(row.name).toBe('Test Channel');
  });

  it('upserts on conflict', () => {
    const db = makeTestDb();
    saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Old Name', weight: 0.5 });
    saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'New Name', weight: 0.5 });
    const rows = db.prepare('SELECT * FROM channels WHERE channel_id = ?').all('UC123') as unknown[];
    expect(rows).toHaveLength(1);
  });
});

describe('saveVideo', () => {
  it('inserts a video and returns its row id', () => {
    const db = makeTestDb();
    saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Test', weight: 0.5 });
    const rowId = saveVideo(db, {
      videoId: 'vid1',
      channelId: 'UC123',
      title: 'Test Video',
      publishedAt: '2026-06-10T12:00:00Z',
    });
    expect(typeof rowId).toBe('number');
    expect(rowId).toBeGreaterThan(0);
  });

  it('returns existing row id on duplicate video_id', () => {
    const db = makeTestDb();
    saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Test', weight: 0.5 });
    const id1 = saveVideo(db, { videoId: 'vid1', channelId: 'UC123', title: 'T', publishedAt: '2026-06-10T12:00:00Z' });
    const id2 = saveVideo(db, { videoId: 'vid1', channelId: 'UC123', title: 'T', publishedAt: '2026-06-10T12:00:00Z' });
    expect(id1).toBe(id2);
  });
});

describe('saveMention', () => {
  it('inserts a ticker mention', () => {
    const db = makeTestDb();
    saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Test', weight: 0.5 });
    const videoRowId = saveVideo(db, { videoId: 'vid1', channelId: 'UC123', title: 'T', publishedAt: '2026-06-10T12:00:00Z' });
    saveMention(db, { videoRowId, ticker: 'CRM', company: 'Salesforce', sentiment: 'bullish', conviction: 'high', quote: 'buying CRM' });
    const rows = db.prepare('SELECT * FROM ticker_mentions WHERE ticker = ?').all('CRM') as { ticker: string }[];
    expect(rows).toHaveLength(1);
  });
});

describe('getLeaderboard', () => {
  it('returns tickers sorted by weighted score', () => {
    const db = makeTestDb();
    saveChannel(db, { id: 1, channelId: 'UC123', handle: '@c1', name: 'C1', weight: 0.5 });
    saveChannel(db, { id: 2, channelId: 'UC456', handle: '@c2', name: 'C2', weight: 0.5 });

    const v1 = saveVideo(db, { videoId: 'v1', channelId: 'UC123', title: 'T1', publishedAt: new Date().toISOString() });
    const v2 = saveVideo(db, { videoId: 'v2', channelId: 'UC456', title: 'T2', publishedAt: new Date().toISOString() });

    saveMention(db, { videoRowId: v1, ticker: 'CRM', company: 'Salesforce', sentiment: 'bullish', conviction: 'high', quote: '' });
    saveMention(db, { videoRowId: v2, ticker: 'CRM', company: 'Salesforce', sentiment: 'bullish', conviction: 'high', quote: '' });
    saveMention(db, { videoRowId: v1, ticker: 'NOW', company: 'ServiceNow', sentiment: 'neutral', conviction: 'low', quote: '' });

    const rows = getLeaderboard(db);
    expect(rows[0].ticker).toBe('CRM');
    expect(rows[0].channel_count).toBe(2);
    expect(rows[1].ticker).toBe('NOW');
  });

  it('excludes mentions from videos older than 24h', () => {
    const db = makeTestDb();
    saveChannel(db, { id: 1, channelId: 'UC123', handle: '@c1', name: 'C1', weight: 0.5 });
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const v = saveVideo(db, { videoId: 'v1', channelId: 'UC123', title: 'Old', publishedAt: oldDate });
    saveMention(db, { videoRowId: v, ticker: 'AAPL', company: 'Apple', sentiment: 'bullish', conviction: 'high', quote: '' });
    const rows = getLeaderboard(db);
    expect(rows.find(r => r.ticker === 'AAPL')).toBeUndefined();
  });
});
