import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getDb, saveConversation } from '@/lib/db';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(request: Request) {
  const body = await request.json() as { question?: string; channelName?: string };
  const question = body.question?.trim();
  const channelName = body.channelName?.trim();
  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }

  const db = getDb();
  const channelFilter = channelName ? 'AND c.name = ?' : '';
  const channelParams = channelName ? [channelName] : [];

  const rows = db.prepare(`
    SELECT tm.ticker, tm.company, tm.sentiment, tm.conviction, tm.quote,
           v.title, v.published_at, c.name AS channel_name
    FROM ticker_mentions tm
    JOIN videos v ON v.id = tm.video_id
    JOIN channels c ON c.channel_id = v.channel_id
    WHERE 1=1 ${channelFilter}
    ORDER BY v.published_at DESC
    LIMIT ${channelName ? 200 : 100}
  `).all(...channelParams) as {
    ticker: string; company: string; sentiment: string; conviction: number;
    quote: string; title: string; published_at: string; channel_name: string;
  }[];

  const summaryRows = db.prepare(`
    SELECT v.title, v.published_at, v.summary, c.name AS channel_name
    FROM videos v
    JOIN channels c ON c.channel_id = v.channel_id
    WHERE v.summary IS NOT NULL AND v.summary != '' ${channelFilter}
    ORDER BY v.published_at DESC
    LIMIT ${channelName ? 50 : 20}
  `).all(...channelParams) as {
    title: string; published_at: string; summary: string; channel_name: string;
  }[];

  const tickerContext = rows.length === 0
    ? 'No stock mentions found in the database.'
    : rows.map(r =>
        `[${r.channel_name}] "${r.title}" (${r.published_at.slice(0, 10)}) — ${r.ticker} (${r.company}): ${r.sentiment}, conviction ${r.conviction}%` +
        (r.quote ? `\n  Quote: "${r.quote}"` : '')
      ).join('\n');

  const summaryContext = summaryRows.length === 0
    ? ''
    : '\n\n--- VIDEO SUMMARIES (full thesis and reasoning) ---\n' +
      summaryRows.map(r =>
        `[${r.channel_name}] "${r.title}" (${r.published_at.slice(0, 10)}):\n${r.summary}`
      ).join('\n\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: channelName
      ? `You are a research assistant for ${channelName}'s content only. Answer based solely on their videos. Always cite the video title and date. Do not reference other channels.`
      : 'You are a stock research assistant. Answer questions based only on the data provided. Always cite the channel and video title. For questions about an analyst\'s thesis or reasoning, prefer the video summaries section over ticker mentions.',
    messages: [{
      role: 'user',
      content: `Stock mention data from recent videos:\n\n${tickerContext}${summaryContext}\n\nQuestion: ${question}`,
    }],
  });

  const answer = response.content[0].type === 'text' ? response.content[0].text : 'No answer found.';
  saveConversation(db, question, answer);
  return NextResponse.json({ answer });
}
