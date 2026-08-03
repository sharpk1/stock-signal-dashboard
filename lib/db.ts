import type { Client } from '@libsql/client';
import path from 'path';
import { Channel } from '@/lib/channels';

export type Db = Client;

let _client: Client | null = null;
let _initPromise: Promise<void> | null = null;

export async function getDb(): Promise<Client> {
  if (!_client) {
    // .trim() guards against trailing newlines/whitespace from pasted env vars —
    // an untrimmed token becomes an invalid HTTP Authorization header value.
    const url = (
      process.env.TURSO_DATABASE_URL ??
      `file:${path.join(process.cwd(), 'data', 'signals.db')}`
    ).trim();
    const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
    // Remote (libsql:// / https) uses the pure-JS web client — no native addon,
    // which is what serverless (Vercel) needs. Local file: uses the native node
    // client for embedded SQLite. Dynamic import so the native client is never
    // loaded in a remote/serverless environment.
    const { createClient } = url.startsWith('file:')
      ? await import('@libsql/client')
      : await import('@libsql/client/web');
    _client = createClient({ url, authToken });
  }
  if (!_initPromise) _initPromise = initDb(_client);
  await _initPromise;
  return _client;
}

export async function initDb(db: Client): Promise<void> {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS channels (
      id         INTEGER PRIMARY KEY,
      channel_id TEXT NOT NULL UNIQUE,
      handle     TEXT NOT NULL,
      name       TEXT NOT NULL,
      weight     REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS videos (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id     TEXT NOT NULL UNIQUE,
      channel_id   TEXT NOT NULL,
      title        TEXT NOT NULL,
      published_at TEXT NOT NULL,
      fetched_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ticker_mentions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id   INTEGER NOT NULL REFERENCES videos(id),
      ticker     TEXT NOT NULL,
      company    TEXT,
      sentiment  TEXT CHECK(sentiment IN ('bullish','bearish','neutral')),
      conviction INTEGER NOT NULL DEFAULT 50,
      quote      TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(video_id, ticker)
    );
  `);

  // Add transcript/summary/pinned columns if not yet present (idempotent)
  for (const stmt of [
    'ALTER TABLE videos ADD COLUMN transcript TEXT',
    'ALTER TABLE videos ADD COLUMN summary TEXT',
    'ALTER TABLE videos ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0',
  ]) {
    try {
      await db.execute(stmt);
    } catch {
      /* column already exists */
    }
  }

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS convergence_alerts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker     TEXT NOT NULL,
      channels   TEXT NOT NULL,
      quotes     TEXT,
      read       INTEGER NOT NULL DEFAULT 0,
      alerted_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(ticker, channels)
    );

    CREATE TABLE IF NOT EXISTS memories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      content    TEXT NOT NULL,
      source     TEXT NOT NULL DEFAULT 'explicit',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      question   TEXT NOT NULL,
      answer     TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export async function saveChannel(db: Client, channel: Channel): Promise<void> {
  await db.execute({
    sql: `
      INSERT INTO channels (id, channel_id, handle, name, weight)
      VALUES (:id, :channelId, :handle, :name, :weight)
      ON CONFLICT(channel_id) DO UPDATE SET
        handle = excluded.handle,
        name   = excluded.name,
        weight = excluded.weight
    `,
    args: {
      id: channel.id,
      channelId: channel.channelId,
      handle: channel.handle,
      name: channel.name,
      weight: channel.weight,
    },
  });
}

export async function saveVideo(
  db: Client,
  video: { videoId: string; channelId: string; title: string; publishedAt: string }
): Promise<number> {
  const existing = await db.execute({
    sql: 'SELECT id FROM videos WHERE video_id = ?',
    args: [video.videoId],
  });
  if (existing.rows.length > 0) return Number(existing.rows[0].id);

  const result = await db.execute({
    sql: `
      INSERT INTO videos (video_id, channel_id, title, published_at)
      VALUES (:videoId, :channelId, :title, :publishedAt)
    `,
    args: {
      videoId: video.videoId,
      channelId: video.channelId,
      title: video.title,
      publishedAt: video.publishedAt,
    },
  });
  return Number(result.lastInsertRowid);
}

export async function saveMention(
  db: Client,
  mention: {
    videoRowId: number;
    ticker: string;
    company: string | null;
    sentiment: string;
    conviction: number;
    quote: string | null;
  }
): Promise<void> {
  await db.execute({
    sql: `
      INSERT OR IGNORE INTO ticker_mentions (video_id, ticker, company, sentiment, conviction, quote)
      VALUES (:videoRowId, :ticker, :company, :sentiment, :conviction, :quote)
    `,
    args: {
      videoRowId: mention.videoRowId,
      ticker: mention.ticker,
      company: mention.company,
      sentiment: mention.sentiment,
      conviction: mention.conviction,
      quote: mention.quote,
    },
  });
}

export interface LeaderboardRow {
  ticker: string;
  company: string | null;
  channel_count: number;
  mention_count: number;
  weighted_score: number;
  channels: string;
  rr_mentions: number;
}

export async function getLeaderboard(db: Client, channelName?: string, days: number = 7): Promise<LeaderboardRow[]> {
  const channelFilter = channelName ? 'AND c.name = ?' : '';
  const params = channelName ? [channelName] : [];
  const result = await db.execute({
    sql: `
      SELECT
        tm.ticker,
        tm.company,
        COUNT(DISTINCT v.channel_id)  AS channel_count,
        COUNT(*)                       AS mention_count,
        CAST(ROUND(SUM(tm.conviction * c.weight) / SUM(c.weight)) AS INTEGER) AS weighted_score,
        GROUP_CONCAT(DISTINCT c.name)  AS channels,
        SUM(CASE WHEN c.name = 'Robert Reynolds' THEN 1 ELSE 0 END) AS rr_mentions
      FROM ticker_mentions tm
      JOIN videos v   ON tm.video_id  = v.id
      JOIN channels c ON v.channel_id = c.channel_id
      WHERE (rtrim(replace(v.published_at, 'T', ' '), 'Z') >= datetime('now', '-${days} days') OR v.pinned = 1)
      ${channelFilter}
      GROUP BY tm.ticker
      ORDER BY weighted_score DESC
    `,
    args: params,
  });
  return result.rows as unknown as LeaderboardRow[];
}

export interface MentionDetail {
  ticker: string;
  sentiment: string;
  conviction: number;
  quote: string | null;
  channel_name: string;
  video_title: string;
  video_id: string;
  fetched_at: string;
}

export async function getMentionDetails(db: Client, channelName?: string, days: number = 7): Promise<MentionDetail[]> {
  const channelFilter = channelName ? 'AND c.name = ?' : '';
  const params = channelName ? [channelName] : [];
  const result = await db.execute({
    sql: `
      SELECT
        tm.ticker,
        tm.sentiment,
        tm.conviction,
        tm.quote,
        c.name      AS channel_name,
        v.title     AS video_title,
        v.video_id,
        v.fetched_at
      FROM ticker_mentions tm
      JOIN videos v   ON tm.video_id  = v.id
      JOIN channels c ON v.channel_id = c.channel_id
      WHERE (rtrim(replace(v.published_at, 'T', ' '), 'Z') >= datetime('now', '-${days} days') OR v.pinned = 1)
      ${channelFilter}
      ORDER BY tm.ticker, c.weight DESC
    `,
    args: params,
  });
  return result.rows as unknown as MentionDetail[];
}

export async function toggleVideoPin(db: Client, videoId: string): Promise<boolean> {
  const result = await db.execute({
    sql: 'SELECT id, pinned FROM videos WHERE video_id = ?',
    args: [videoId],
  });
  if (result.rows.length === 0) throw new Error(`Video not found: ${videoId}`);
  const row = result.rows[0] as unknown as { id: number; pinned: number };
  const newPinned = row.pinned ? 0 : 1;
  await db.execute({ sql: 'UPDATE videos SET pinned = ? WHERE id = ?', args: [newPinned, row.id] });
  return newPinned === 1;
}

export interface ConvergenceAlert {
  id: number;
  ticker: string;
  channels: string;
  quotes: string | null;
  read: number;
  alerted_at: string;
}

export async function saveConvergenceAlert(
  db: Client,
  ticker: string,
  channels: string,
  quotes: string
): Promise<boolean> {
  const result = await db.execute({
    sql: `
      INSERT OR IGNORE INTO convergence_alerts (ticker, channels, quotes)
      VALUES (?, ?, ?)
    `,
    args: [ticker, channels, quotes],
  });
  return result.rowsAffected > 0;
}

export async function getAlerts(db: Client): Promise<{ alerts: ConvergenceAlert[]; unreadCount: number }> {
  const result = await db.execute('SELECT * FROM convergence_alerts ORDER BY alerted_at DESC');
  const alerts = result.rows as unknown as ConvergenceAlert[];
  const unreadCount = alerts.filter(a => a.read === 0).length;
  return { alerts, unreadCount };
}

export async function markAlertRead(db: Client, id: number): Promise<void> {
  await db.execute({ sql: 'UPDATE convergence_alerts SET read = 1 WHERE id = ?', args: [id] });
}

export async function updateVideoTranscript(
  db: Client,
  videoRowId: number,
  transcript: string,
  summary: string
): Promise<void> {
  const result = await db.execute({
    sql: 'UPDATE videos SET transcript = ?, summary = ? WHERE id = ?',
    args: [transcript, summary, videoRowId],
  });
  if (result.rowsAffected === 0) throw new Error(`No video row found for id ${videoRowId}`);
}

export async function saveMemory(
  db: Client,
  content: string,
  source: 'explicit' | 'extracted'
): Promise<void> {
  await db.execute({ sql: 'INSERT INTO memories (content, source) VALUES (?, ?)', args: [content, source] });
}

export async function getMemories(db: Client): Promise<string[]> {
  const result = await db.execute('SELECT content FROM memories ORDER BY created_at DESC');
  return result.rows.map(r => r.content as string);
}

export async function saveConversation(db: Client, question: string, answer: string): Promise<void> {
  await db.execute({ sql: 'INSERT INTO conversations (question, answer) VALUES (?, ?)', args: [question, answer] });
}

export async function getRecentConversations(
  db: Client,
  n: number = 5
): Promise<{ question: string; answer: string }[]> {
  const result = await db.execute({
    sql: 'SELECT question, answer FROM conversations ORDER BY id DESC LIMIT ?',
    args: [n],
  });
  return result.rows as unknown as { question: string; answer: string }[];
}
