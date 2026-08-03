import type { Client } from '@libsql/client';
import { saveMemory } from '@/lib/db';

function getString(input: Record<string, unknown>, key: string): { value: string } | { error: string } {
  const val = input[key];
  if (typeof val !== 'string' || val.length === 0) return { error: `Missing required field: ${key}` };
  return { value: val };
}

export async function executeToolCall(
  name: string,
  input: Record<string, unknown>,
  db: Client
): Promise<string> {
  if (name === 'search_summaries') {
    const queryResult = getString(input, 'query');
    if ('error' in queryResult) return queryResult.error;
    const { value: query } = queryResult;
    const channel = typeof input['channel'] === 'string' ? input['channel'] : undefined;
    const daysNum = Math.max(1, Math.floor(Number(input['days'] ?? 30)));
    const safedays = Number.isFinite(daysNum) ? daysNum : 30;
    const channelFilter = channel ? 'AND c.name = ?' : '';
    const params: (string | number)[] = [`%${query}%`, `%${query}%`, query, `%${query}%`, safedays];
    if (channel) params.push(channel);
    const rows = (await db.execute({
      sql: `
      SELECT DISTINCT v.title, v.summary, v.video_id, v.published_at, c.name AS channel_name
      FROM videos v
      JOIN channels c ON v.channel_id = c.channel_id
      LEFT JOIN ticker_mentions tm ON tm.video_id = v.id
      WHERE (
        v.summary LIKE ?
        OR v.title LIKE ?
        OR UPPER(tm.ticker) = UPPER(?)
        OR tm.company LIKE ?
      )
        AND rtrim(replace(v.published_at, 'T', ' '), 'Z') >= datetime('now', '-' || ? || ' days')
        ${channelFilter}
      ORDER BY v.published_at DESC
      LIMIT 10
    `,
      args: params,
    })).rows as unknown as {
      title: string; summary: string | null; video_id: string;
      published_at: string; channel_name: string;
    }[];

    if (rows.length === 0) return 'No matching videos found.';
    return rows.map(r =>
      `[${r.channel_name}] "${r.title}" (${r.published_at.slice(0, 10)}) — video_id: ${r.video_id}\n${r.summary ?? '(no summary)'}`
    ).join('\n\n');
  }

  if (name === 'get_full_transcript') {
    const videoIdResult = getString(input, 'video_id');
    if ('error' in videoIdResult) return videoIdResult.error;
    const { value: video_id } = videoIdResult;
    const row = (await db.execute({
      sql: `
      SELECT v.transcript, v.title, c.name AS channel_name, v.published_at
      FROM videos v
      JOIN channels c ON v.channel_id = c.channel_id
      WHERE v.video_id = ?
    `,
      args: [video_id],
    })).rows[0] as unknown as {
      transcript: string | null; title: string; channel_name: string; published_at: string;
    } | undefined;

    if (!row) return 'Video not found.';
    if (!row.transcript) return 'Transcript not available for this video.';
    return `[${row.channel_name}] "${row.title}" (${row.published_at.slice(0, 10)})\n\nTranscript:\n${row.transcript}`;
  }

  if (name === 'save_memory') {
    const contentResult = getString(input, 'content');
    if ('error' in contentResult) return contentResult.error;
    const { value: content } = contentResult;
    await saveMemory(db, content, 'explicit');
    return 'Memory saved.';
  }

  return `Unknown tool: ${name}`;
}
