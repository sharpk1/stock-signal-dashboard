import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import { Channel } from '@/lib/channels';

let _db: DatabaseType | null = null;

export function getDb(): DatabaseType {
  if (!_db) {
    const dbPath = path.join(process.cwd(), 'data', 'signals.db');
    _db = new Database(dbPath);
    initDb(_db);
  }
  return _db;
}

export function initDb(db: DatabaseType): void {
  db.exec(`
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

  // Add transcript/summary columns if not yet present (idempotent)
  try { db.exec('ALTER TABLE videos ADD COLUMN transcript TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE videos ADD COLUMN summary TEXT'); } catch { /* already exists */ }

  try { db.exec('ALTER TABLE videos ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }

  db.exec(`
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

export function saveChannel(db: DatabaseType, channel: Channel): void {
  db.prepare(`
    INSERT INTO channels (id, channel_id, handle, name, weight)
    VALUES (@id, @channelId, @handle, @name, @weight)
    ON CONFLICT(channel_id) DO UPDATE SET
      handle = excluded.handle,
      name   = excluded.name,
      weight = excluded.weight
  `).run(channel);
}

export function saveVideo(
  db: DatabaseType,
  video: { videoId: string; channelId: string; title: string; publishedAt: string }
): number {
  const existing = db.prepare('SELECT id FROM videos WHERE video_id = ?').get(video.videoId) as { id: number } | undefined;
  if (existing) return existing.id;
  const result = db.prepare(`
    INSERT INTO videos (video_id, channel_id, title, published_at)
    VALUES (@videoId, @channelId, @title, @publishedAt)
  `).run(video);
  return Number(result.lastInsertRowid);
}

export function saveMention(
  db: DatabaseType,
  mention: {
    videoRowId: number;
    ticker: string;
    company: string | null;
    sentiment: string;
    conviction: number;
    quote: string | null;
  }
): void {
  db.prepare(`
    INSERT OR IGNORE INTO ticker_mentions (video_id, ticker, company, sentiment, conviction, quote)
    VALUES (@videoRowId, @ticker, @company, @sentiment, @conviction, @quote)
  `).run(mention);
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

export function getLeaderboard(db: DatabaseType, channelName?: string, days: number = 7): LeaderboardRow[] {
  const channelFilter = channelName ? 'AND c.name = ?' : '';
  const params = channelName ? [channelName] : [];
  return db.prepare(`
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
  `).all(...params) as LeaderboardRow[];
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

export function getMentionDetails(db: DatabaseType, channelName?: string, days: number = 7): MentionDetail[] {
  const channelFilter = channelName ? 'AND c.name = ?' : '';
  const params = channelName ? [channelName] : [];
  return db.prepare(`
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
  `).all(...params) as MentionDetail[];
}

export function toggleVideoPin(db: DatabaseType, videoId: string): boolean {
  const row = db.prepare('SELECT id, pinned FROM videos WHERE video_id = ?').get(videoId) as { id: number; pinned: number } | undefined;
  if (!row) throw new Error(`Video not found: ${videoId}`);
  const newPinned = row.pinned ? 0 : 1;
  db.prepare('UPDATE videos SET pinned = ? WHERE id = ?').run(newPinned, row.id);
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

export function saveConvergenceAlert(
  db: DatabaseType,
  ticker: string,
  channels: string,
  quotes: string
): boolean {
  const result = db.prepare(`
    INSERT OR IGNORE INTO convergence_alerts (ticker, channels, quotes)
    VALUES (?, ?, ?)
  `).run(ticker, channels, quotes);
  return result.changes > 0;
}

export function getAlerts(db: DatabaseType): { alerts: ConvergenceAlert[]; unreadCount: number } {
  const alerts = db.prepare('SELECT * FROM convergence_alerts ORDER BY alerted_at DESC').all() as ConvergenceAlert[];
  const unreadCount = alerts.filter(a => a.read === 0).length;
  return { alerts, unreadCount };
}

export function markAlertRead(db: DatabaseType, id: number): void {
  db.prepare('UPDATE convergence_alerts SET read = 1 WHERE id = ?').run(id);
}

export function updateVideoTranscript(
  db: DatabaseType,
  videoRowId: number,
  transcript: string,
  summary: string
): void {
  const result = db.prepare('UPDATE videos SET transcript = ?, summary = ? WHERE id = ?')
    .run(transcript, summary, videoRowId);
  if (result.changes === 0) throw new Error(`No video row found for id ${videoRowId}`);
}

export function saveMemory(
  db: DatabaseType,
  content: string,
  source: 'explicit' | 'extracted'
): void {
  db.prepare('INSERT INTO memories (content, source) VALUES (?, ?)').run(content, source);
}

export function getMemories(db: DatabaseType): string[] {
  const rows = db.prepare('SELECT content FROM memories ORDER BY created_at DESC').all() as { content: string }[];
  return rows.map(r => r.content);
}

export function saveConversation(db: DatabaseType, question: string, answer: string): void {
  db.prepare('INSERT INTO conversations (question, answer) VALUES (?, ?)').run(question, answer);
}

export function getRecentConversations(
  db: DatabaseType,
  n: number = 5
): { question: string; answer: string }[] {
  return db.prepare(
    'SELECT question, answer FROM conversations ORDER BY id DESC LIMIT ?'
  ).all(n) as { question: string; answer: string }[];
}
