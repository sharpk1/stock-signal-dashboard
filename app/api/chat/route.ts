import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getDb, saveConversation } from '@/lib/db';
import { chatModel } from '@/lib/models';
import { recordUsage } from '@/lib/usage';
import { itemUrl } from '@/lib/item-url';

export interface ChatSource {
  /** The label the model cites, e.g. "S3". */
  label: string;
  title: string;
  channelName: string;
  publishedAt: string;
  url: string;
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(request: Request) {
  const body = await request.json() as { question?: string; channelName?: string };
  const question = body.question?.trim();
  const channelName = body.channelName?.trim();
  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }

  const db = await getDb();
  const channelFilter = channelName ? 'AND c.name = ?' : '';
  const channelParams = channelName ? [channelName] : [];

  const rows = (await db.execute({
    sql: `
    SELECT tm.ticker, tm.company, tm.sentiment, tm.conviction, tm.quote,
           v.title, v.published_at, c.name AS channel_name
    FROM ticker_mentions tm
    JOIN videos v ON v.id = tm.video_id
    JOIN channels c ON c.channel_id = v.channel_id
    WHERE 1=1 ${channelFilter}
    ORDER BY v.published_at DESC
    LIMIT ${channelName ? 200 : 100}
  `,
    args: channelParams,
  })).rows as unknown as {
    ticker: string; company: string; sentiment: string; conviction: number;
    quote: string; title: string; published_at: string; channel_name: string;
  }[];

  const summaryRows = (await db.execute({
    sql: `
    SELECT v.video_id, v.title, v.published_at, v.summary,
           c.name AS channel_name, c.channel_id
    FROM videos v
    JOIN channels c ON c.channel_id = v.channel_id
    WHERE v.summary IS NOT NULL AND v.summary != '' ${channelFilter}
    ORDER BY v.published_at DESC
    LIMIT ${channelName ? 50 : 20}
  `,
    args: channelParams,
  })).rows as unknown as {
    video_id: string; title: string; published_at: string; summary: string;
    channel_name: string; channel_id: string;
  }[];

  // Label each summary so the model can cite it and we can turn the citation
  // back into a link. Only summaries get labels: they are whole items with a
  // url, where a ticker mention is one line out of one.
  const sources: ChatSource[] = summaryRows.map((r, i) => ({
    label: `S${i + 1}`,
    title: r.title,
    channelName: r.channel_name,
    publishedAt: r.published_at.slice(0, 10),
    url: itemUrl(r.channel_id, r.video_id),
  }));

  const tickerContext = rows.length === 0
    ? 'No stock mentions found in the database.'
    : rows.map(r =>
        `[${r.channel_name}] "${r.title}" (${r.published_at.slice(0, 10)}) — ${r.ticker} (${r.company}): ${r.sentiment}, conviction ${r.conviction}%` +
        (r.quote ? `\n  Quote: "${r.quote}"` : '')
      ).join('\n');

  const summaryContext = summaryRows.length === 0
    ? ''
    : '\n\n--- VIDEO SUMMARIES (full thesis and reasoning) ---\n' +
      summaryRows.map((r, i) =>
        `[${sources[i].label}] [${r.channel_name}] "${r.title}" (${r.published_at.slice(0, 10)}):\n${r.summary}`
      ).join('\n\n');

  const citationRule = sources.length > 0
    ? ` Each video summary is tagged with a label like [S1]. When you use one, cite it inline with that exact label, e.g. "he is backing NVDA into earnings [S2]." Cite every item you drew on, and never cite a label that is not in the data.`
    : '';

  const model = chatModel();
  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system: (channelName
      ? `You are a research assistant for ${channelName}'s content only. Answer based solely on their videos. Always cite the video title and date. Do not reference other channels.`
      : 'You are a stock research assistant. Answer questions based only on the data provided. Always cite the channel and video title. For questions about an analyst\'s thesis or reasoning, prefer the video summaries section over ticker mentions.') + citationRule,
    messages: [{
      role: 'user',
      content: `Stock mention data from recent videos:\n\n${tickerContext}${summaryContext}\n\nQuestion: ${question}`,
    }],
  });

  recordUsage(model, response.usage.input_tokens, response.usage.output_tokens);
  const answer = response.content[0].type === 'text' ? response.content[0].text : 'No answer found.';
  await saveConversation(db, question, answer);
  // Return only what the answer actually cited, so the list under it is the
  // items it used rather than everything it was shown.
  return NextResponse.json({ answer, sources: citedSources(answer, sources) });
}

/** The sources whose labels appear in the answer, in the order cited. */
export function citedSources(answer: string, sources: ChatSource[]): ChatSource[] {
  const byLabel = new Map(sources.map(s => [s.label, s]));
  const seen = new Set<string>();
  const cited: ChatSource[] = [];
  for (const match of answer.matchAll(/\[(S\d+)\]/g)) {
    const label = match[1];
    const source = byLabel.get(label);
    if (source && !seen.has(label)) {
      seen.add(label);
      cited.push(source);
    }
  }
  return cited;
}
