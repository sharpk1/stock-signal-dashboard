import { describe, it, expect } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { initDb, saveChannel, saveVideo, updateVideoTranscript, getMemories } from '@/lib/db';
import { executeToolCall } from '@/lib/chat-tools';

async function makeTestDb(): Promise<Client> {
  const db = createClient({ url: ':memory:' });
  await initDb(db);
  return db;
}

describe('executeToolCall — search_summaries', () => {
  it('returns matching videos when summary contains query', async () => {
    const db = await makeTestDb();
    await saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Financial Education', weight: 0.5 });
    const vid = await saveVideo(db, { videoId: 'v1', channelId: 'UC123', title: 'Celsius is hot', publishedAt: new Date().toISOString() });
    await updateVideoTranscript(db, vid, 'transcript', 'CELH bullish target $50 by year end');
    const result = await executeToolCall('search_summaries', { query: 'CELH', days: 30 }, db);
    expect(result).toContain('CELH bullish');
    expect(result).toContain('Celsius is hot');
    expect(result).toContain('Financial Education');
  });

  it('returns no results message when nothing matches', async () => {
    const db = await makeTestDb();
    const result = await executeToolCall('search_summaries', { query: 'NONEXISTENT_TICKER_XYZ', days: 30 }, db);
    expect(result).toBe('No matching videos found.');
  });

  it('filters by channel when channel param provided', async () => {
    const db = await makeTestDb();
    await saveChannel(db, { id: 1, channelId: 'UC111', handle: '@fin', name: 'Financial Education', weight: 0.5 });
    await saveChannel(db, { id: 2, channelId: 'UC222', handle: '@dum', name: 'Dumb Money', weight: 0.5 });
    const v1 = await saveVideo(db, { videoId: 'v1', channelId: 'UC111', title: 'Jeremy on CELH', publishedAt: new Date().toISOString() });
    const v2 = await saveVideo(db, { videoId: 'v2', channelId: 'UC222', title: 'Ray on CELH', publishedAt: new Date().toISOString() });
    await updateVideoTranscript(db, v1, 't', 'CELH mentioned by Jeremy');
    await updateVideoTranscript(db, v2, 't', 'CELH mentioned by Ray');
    const result = await executeToolCall('search_summaries', { query: 'CELH', channel: 'Financial Education', days: 30 }, db);
    expect(result).toContain('Jeremy on CELH');
    expect(result).not.toContain('Ray on CELH');
  });
});

describe('executeToolCall — get_full_transcript', () => {
  it('returns transcript text for a known video', async () => {
    const db = await makeTestDb();
    await saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Test', weight: 0.5 });
    const vid = await saveVideo(db, { videoId: 'v1', channelId: 'UC123', title: 'Test Video', publishedAt: new Date().toISOString() });
    await updateVideoTranscript(db, vid, 'full transcript content here', 'summary');
    const result = await executeToolCall('get_full_transcript', { video_id: 'v1' }, db);
    expect(result).toContain('full transcript content here');
    expect(result).toContain('Test Video');
  });

  it('returns not found for unknown video_id', async () => {
    const db = await makeTestDb();
    const result = await executeToolCall('get_full_transcript', { video_id: 'nonexistent' }, db);
    expect(result).toBe('Video not found.');
  });

  it('returns unavailable message when transcript is null', async () => {
    const db = await makeTestDb();
    await saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Test', weight: 0.5 });
    await saveVideo(db, { videoId: 'v1', channelId: 'UC123', title: 'T', publishedAt: new Date().toISOString() });
    const result = await executeToolCall('get_full_transcript', { video_id: 'v1' }, db);
    expect(result).toBe('Transcript not available for this video.');
  });
});

describe('executeToolCall — save_memory', () => {
  it('stores the memory and returns confirmation', async () => {
    const db = await makeTestDb();
    const result = await executeToolCall('save_memory', { content: 'Ray prefers swing trades' }, db);
    expect(result).toBe('Memory saved.');
    expect(await getMemories(db)).toContain('Ray prefers swing trades');
  });
});

describe('executeToolCall — unknown tool', () => {
  it('returns unknown tool message for unrecognized name', async () => {
    const db = await makeTestDb();
    const result = await executeToolCall('does_not_exist', {}, db);
    expect(result).toBe('Unknown tool: does_not_exist');
  });
});
