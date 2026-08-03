import { describe, it, expect } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { initDb, saveChannel, saveVideo, saveMention, getLeaderboard, getMentionDetails,
         updateVideoTranscript, saveMemory, getMemories, saveConversation, getRecentConversations } from '@/lib/db';

async function makeTestDb(): Promise<Client> {
  const db = createClient({ url: ':memory:' });
  await initDb(db);
  return db;
}

describe('initDb', () => {
  it('creates channels table', async () => {
    const db = await makeTestDb();
    const tables = (await db.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows as unknown as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('channels');
    expect(names).toContain('videos');
    expect(names).toContain('ticker_mentions');
  });
});

describe('saveChannel', () => {
  it('inserts a channel', async () => {
    const db = await makeTestDb();
    await saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Test Channel', weight: 0.5 });
    const row = (await db.execute({ sql: 'SELECT * FROM channels WHERE channel_id = ?', args: ['UC123'] })).rows[0] as unknown as { name: string };
    expect(row.name).toBe('Test Channel');
  });

  it('upserts on conflict', async () => {
    const db = await makeTestDb();
    await saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Old Name', weight: 0.5 });
    await saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'New Name', weight: 0.5 });
    const rows = (await db.execute({ sql: 'SELECT * FROM channels WHERE channel_id = ?', args: ['UC123'] })).rows;
    expect(rows).toHaveLength(1);
  });
});

describe('saveVideo', () => {
  it('inserts a video and returns its row id', async () => {
    const db = await makeTestDb();
    await saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Test', weight: 0.5 });
    const rowId = await saveVideo(db, {
      videoId: 'vid1',
      channelId: 'UC123',
      title: 'Test Video',
      publishedAt: '2026-06-10T12:00:00Z',
    });
    expect(typeof rowId).toBe('number');
    expect(rowId).toBeGreaterThan(0);
  });

  it('returns existing row id on duplicate video_id', async () => {
    const db = await makeTestDb();
    await saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Test', weight: 0.5 });
    const id1 = await saveVideo(db, { videoId: 'vid1', channelId: 'UC123', title: 'T', publishedAt: '2026-06-10T12:00:00Z' });
    const id2 = await saveVideo(db, { videoId: 'vid1', channelId: 'UC123', title: 'T', publishedAt: '2026-06-10T12:00:00Z' });
    expect(id1).toBe(id2);
  });
});

describe('saveMention', () => {
  it('inserts a ticker mention', async () => {
    const db = await makeTestDb();
    await saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Test', weight: 0.5 });
    const videoRowId = await saveVideo(db, { videoId: 'vid1', channelId: 'UC123', title: 'T', publishedAt: '2026-06-10T12:00:00Z' });
    await saveMention(db, { videoRowId, ticker: 'CRM', company: 'Salesforce', sentiment: 'bullish', conviction: 90, quote: 'buying CRM' });
    const rows = (await db.execute({ sql: 'SELECT * FROM ticker_mentions WHERE ticker = ?', args: ['CRM'] })).rows;
    expect(rows).toHaveLength(1);
  });
});

describe('getLeaderboard', () => {
  it('returns tickers sorted by weighted score', async () => {
    const db = await makeTestDb();
    await saveChannel(db, { id: 1, channelId: 'UC123', handle: '@c1', name: 'C1', weight: 0.5 });
    await saveChannel(db, { id: 2, channelId: 'UC456', handle: '@c2', name: 'C2', weight: 0.5 });

    const v1 = await saveVideo(db, { videoId: 'v1', channelId: 'UC123', title: 'T1', publishedAt: new Date().toISOString() });
    const v2 = await saveVideo(db, { videoId: 'v2', channelId: 'UC456', title: 'T2', publishedAt: new Date().toISOString() });

    await saveMention(db, { videoRowId: v1, ticker: 'CRM', company: 'Salesforce', sentiment: 'bullish', conviction: 90, quote: '' });
    await saveMention(db, { videoRowId: v2, ticker: 'CRM', company: 'Salesforce', sentiment: 'bullish', conviction: 90, quote: '' });
    await saveMention(db, { videoRowId: v1, ticker: 'NOW', company: 'ServiceNow', sentiment: 'neutral', conviction: 25, quote: '' });

    const rows = await getLeaderboard(db);
    expect(rows[0].ticker).toBe('CRM');
    expect(rows[0].channel_count).toBe(2);
    expect(rows[1].ticker).toBe('NOW');
  });

  it('excludes mentions from videos older than the default 7-day window', async () => {
    const db = await makeTestDb();
    await saveChannel(db, { id: 1, channelId: 'UC123', handle: '@c1', name: 'C1', weight: 0.5 });
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const v = await saveVideo(db, { videoId: 'v1', channelId: 'UC123', title: 'Old', publishedAt: oldDate });
    await saveMention(db, { videoRowId: v, ticker: 'AAPL', company: 'Apple', sentiment: 'bullish', conviction: 90, quote: '' });
    const rows = await getLeaderboard(db);
    expect(rows.find(r => r.ticker === 'AAPL')).toBeUndefined();
  });
});

describe('getMentionDetails', () => {
  it('returns mention details with channel and video info', async () => {
    const db = await makeTestDb();
    await saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Test Channel', weight: 0.5 });
    const videoRowId = await saveVideo(db, { videoId: 'vid1', channelId: 'UC123', title: 'My Video', publishedAt: new Date().toISOString() });
    await saveMention(db, { videoRowId, ticker: 'CRM', company: 'Salesforce', sentiment: 'bullish', conviction: 90, quote: 'love this stock' });

    const details = await getMentionDetails(db);
    expect(details).toHaveLength(1);
    expect(details[0].ticker).toBe('CRM');
    expect(details[0].channel_name).toBe('Test Channel');
    expect(details[0].video_title).toBe('My Video');
    expect(details[0].quote).toBe('love this stock');
  });
});

describe('updateVideoTranscript', () => {
  it('stores transcript and summary on a video row', async () => {
    const db = await makeTestDb();
    await saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Test', weight: 0.5 });
    const videoRowId = await saveVideo(db, { videoId: 'v1', channelId: 'UC123', title: 'T', publishedAt: new Date().toISOString() });
    await updateVideoTranscript(db, videoRowId, 'full transcript text', 'summary text');
    const row = (await db.execute({ sql: 'SELECT transcript, summary FROM videos WHERE id = ?', args: [videoRowId] })).rows[0] as unknown as { transcript: string; summary: string };
    expect(row.transcript).toBe('full transcript text');
    expect(row.summary).toBe('summary text');
  });

  it('throws when videoRowId does not exist', async () => {
    const db = await makeTestDb();
    await expect(updateVideoTranscript(db, 999, 'transcript', 'summary')).rejects.toThrow('No video row found for id 999');
  });
});

describe('saveMemory and getMemories', () => {
  it('saves a memory and retrieves it', async () => {
    const db = await makeTestDb();
    await saveMemory(db, 'Ray prefers swing trades', 'explicit');
    await saveMemory(db, 'Ray is long CELH', 'extracted');
    const memories = await getMemories(db);
    expect(memories).toHaveLength(2);
    expect(memories).toContain('Ray prefers swing trades');
    expect(memories).toContain('Ray is long CELH');
  });

  it('returns empty array when no memories exist', async () => {
    const db = await makeTestDb();
    expect(await getMemories(db)).toEqual([]);
  });
});

describe('saveConversation and getRecentConversations', () => {
  it('saves a conversation and retrieves it', async () => {
    const db = await makeTestDb();
    await saveConversation(db, 'What is Jeremy saying?', 'Jeremy is bullish on CELH.');
    const convs = await getRecentConversations(db);
    expect(convs).toHaveLength(1);
    expect(convs[0].question).toBe('What is Jeremy saying?');
    expect(convs[0].answer).toBe('Jeremy is bullish on CELH.');
  });

  it('returns at most n conversations in reverse chronological order', async () => {
    const db = await makeTestDb();
    await saveConversation(db, 'Q1', 'A1');
    await saveConversation(db, 'Q2', 'A2');
    await saveConversation(db, 'Q3', 'A3');
    const convs = await getRecentConversations(db, 2);
    expect(convs).toHaveLength(2);
    expect(convs[0].question).toBe('Q3'); // most recent first
  });
});
