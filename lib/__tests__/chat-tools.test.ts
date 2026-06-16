import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initDb, saveChannel, saveVideo, updateVideoTranscript, getMemories } from '@/lib/db';
import { executeToolCall } from '@/lib/chat-tools';

function makeTestDb() {
  const db = new Database(':memory:');
  initDb(db);
  return db;
}

describe('executeToolCall — search_summaries', () => {
  it('returns matching videos when summary contains query', () => {
    const db = makeTestDb();
    saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Financial Education', weight: 0.5 });
    const vid = saveVideo(db, { videoId: 'v1', channelId: 'UC123', title: 'Celsius is hot', publishedAt: new Date().toISOString() });
    updateVideoTranscript(db, vid, 'transcript', 'CELH bullish target $50 by year end');
    const result = executeToolCall('search_summaries', { query: 'CELH', days: 30 }, db);
    expect(result).toContain('CELH bullish');
    expect(result).toContain('Celsius is hot');
    expect(result).toContain('Financial Education');
  });

  it('returns no results message when nothing matches', () => {
    const db = makeTestDb();
    const result = executeToolCall('search_summaries', { query: 'NONEXISTENT_TICKER_XYZ', days: 30 }, db);
    expect(result).toBe('No matching videos found.');
  });

  it('filters by channel when channel param provided', () => {
    const db = makeTestDb();
    saveChannel(db, { id: 1, channelId: 'UC111', handle: '@fin', name: 'Financial Education', weight: 0.5 });
    saveChannel(db, { id: 2, channelId: 'UC222', handle: '@dum', name: 'Dumb Money', weight: 0.5 });
    const v1 = saveVideo(db, { videoId: 'v1', channelId: 'UC111', title: 'Jeremy on CELH', publishedAt: new Date().toISOString() });
    const v2 = saveVideo(db, { videoId: 'v2', channelId: 'UC222', title: 'Ray on CELH', publishedAt: new Date().toISOString() });
    updateVideoTranscript(db, v1, 't', 'CELH mentioned by Jeremy');
    updateVideoTranscript(db, v2, 't', 'CELH mentioned by Ray');
    const result = executeToolCall('search_summaries', { query: 'CELH', channel: 'Financial Education', days: 30 }, db);
    expect(result).toContain('Jeremy on CELH');
    expect(result).not.toContain('Ray on CELH');
  });
});

describe('executeToolCall — get_full_transcript', () => {
  it('returns transcript text for a known video', () => {
    const db = makeTestDb();
    saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Test', weight: 0.5 });
    const vid = saveVideo(db, { videoId: 'v1', channelId: 'UC123', title: 'Test Video', publishedAt: new Date().toISOString() });
    updateVideoTranscript(db, vid, 'full transcript content here', 'summary');
    const result = executeToolCall('get_full_transcript', { video_id: 'v1' }, db);
    expect(result).toContain('full transcript content here');
    expect(result).toContain('Test Video');
  });

  it('returns not found for unknown video_id', () => {
    const db = makeTestDb();
    const result = executeToolCall('get_full_transcript', { video_id: 'nonexistent' }, db);
    expect(result).toBe('Video not found.');
  });

  it('returns unavailable message when transcript is null', () => {
    const db = makeTestDb();
    saveChannel(db, { id: 1, channelId: 'UC123', handle: '@test', name: 'Test', weight: 0.5 });
    saveVideo(db, { videoId: 'v1', channelId: 'UC123', title: 'T', publishedAt: new Date().toISOString() });
    const result = executeToolCall('get_full_transcript', { video_id: 'v1' }, db);
    expect(result).toBe('Transcript not available for this video.');
  });
});

describe('executeToolCall — save_memory', () => {
  it('stores the memory and returns confirmation', () => {
    const db = makeTestDb();
    const result = executeToolCall('save_memory', { content: 'Ray prefers swing trades' }, db);
    expect(result).toBe('Memory saved.');
    expect(getMemories(db)).toContain('Ray prefers swing trades');
  });
});

describe('executeToolCall — unknown tool', () => {
  it('returns unknown tool message for unrecognized name', () => {
    const db = makeTestDb();
    const result = executeToolCall('does_not_exist', {}, db);
    expect(result).toBe('Unknown tool: does_not_exist');
  });
});
