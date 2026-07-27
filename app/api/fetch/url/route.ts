import { NextResponse } from 'next/server';
import { getDb, saveVideo, saveMention, updateVideoTranscript } from '@/lib/db';
import { fetchTranscript } from '@/lib/youtube';
import { extractTickers, generateSummary } from '@/lib/extract';

export const maxDuration = 120;

function parseYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
  } catch {
    // not a valid URL
  }
  return null;
}

async function fetchVideoTitle(videoId: string): Promise<string> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://youtube.com/watch?v=${videoId}&format=json`);
    if (res.ok) {
      const data = await res.json() as { title?: string };
      if (data.title) return data.title;
    }
  } catch { /* fall through */ }
  return videoId;
}

export async function POST(request: Request) {
  const body = await request.json() as { url?: string; channelId?: string };
  const { url, channelId } = body;

  if (!url || !channelId) {
    return NextResponse.json({ error: 'url and channelId are required' }, { status: 400 });
  }

  const videoId = parseYouTubeId(url);
  if (!videoId) {
    return NextResponse.json({ error: 'Could not parse a YouTube video ID from that URL' }, { status: 400 });
  }

  const db = getDb();

  const existing = db.prepare('SELECT id FROM videos WHERE video_id = ?').get(videoId) as { id: number } | undefined;
  if (existing) {
    // Already in DB — just pin it
    db.prepare('UPDATE videos SET pinned = 1 WHERE id = ?').run(existing.id);
    return NextResponse.json({ ok: true, alreadyExisted: true });
  }

  const title = await fetchVideoTitle(videoId);

  let transcript: string;
  try {
    transcript = await fetchTranscript(videoId);
  } catch (err) {
    return NextResponse.json(
      { error: `Could not fetch transcript: ${err instanceof Error ? err.message : err}` },
      { status: 422 }
    );
  }

  const [summary, mentions] = await Promise.all([
    generateSummary(transcript).catch(() => ''),
    extractTickers(transcript, title).catch(() => []),
  ]);

  const videoRowId = db.prepare(`
    INSERT INTO videos (video_id, channel_id, title, published_at, pinned)
    VALUES (?, ?, ?, datetime('now'), 1)
  `).run(videoId, channelId, title).lastInsertRowid as number;

  if (transcript) {
    db.prepare('UPDATE videos SET transcript = ?, summary = ? WHERE id = ?').run(transcript, summary, videoRowId);
  }

  for (const mention of mentions) {
    saveMention(db, {
      videoRowId,
      ticker: mention.ticker.toUpperCase(),
      company: mention.company ?? null,
      sentiment: mention.sentiment,
      conviction: mention.conviction,
      quote: mention.quote ?? null,
    });
  }

  return NextResponse.json({ ok: true, title, tickersFound: mentions.length });
}
