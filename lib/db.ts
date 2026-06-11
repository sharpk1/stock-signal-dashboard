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
}

export function getLeaderboard(db: DatabaseType, channelName?: string): LeaderboardRow[] {
  const channelFilter = channelName ? 'AND c.name = ?' : '';
  const params = channelName ? [channelName] : [];
  return db.prepare(`
    SELECT
      tm.ticker,
      tm.company,
      COUNT(DISTINCT v.channel_id)  AS channel_count,
      COUNT(*)                       AS mention_count,
      CAST(ROUND(AVG(tm.conviction)) AS INTEGER) AS weighted_score,
      GROUP_CONCAT(DISTINCT c.name)  AS channels
    FROM ticker_mentions tm
    JOIN videos v   ON tm.video_id  = v.id
    JOIN channels c ON v.channel_id = c.channel_id
    WHERE rtrim(replace(v.published_at, 'T', ' '), 'Z') >= datetime('now', '-24 hours')
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

export function getMentionDetails(db: DatabaseType, channelName?: string): MentionDetail[] {
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
    WHERE rtrim(replace(v.published_at, 'T', ' '), 'Z') >= datetime('now', '-24 hours')
    ${channelFilter}
    ORDER BY tm.ticker, c.weight DESC
  `).all(...params) as MentionDetail[];
}
