import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import {
  getDb, getMemories, getRecentConversations,
  saveConversation, saveMemory,
} from '@/lib/db';
import { executeToolCall } from '@/lib/chat-tools';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_summaries',
    description: 'Search video summaries by topic, ticker, or channel. Use this first to find relevant videos.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query:   { type: 'string', description: 'Keywords to search for in summaries' },
        channel: { type: 'string', description: 'Optional: filter to a specific channel name' },
        days:    { type: 'number', description: 'How many days back to search (default 30)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_full_transcript',
    description: 'Get the full transcript for a specific video to find exact quotes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        video_id: { type: 'string', description: 'The video_id returned by search_summaries' },
      },
      required: ['video_id'],
    },
  },
  {
    name: 'save_memory',
    description: 'Save something Ray wants remembered in future conversations. Call this when Ray says "remember X".',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'The fact or preference to remember' },
      },
      required: ['content'],
    },
  },
];

const MAX_ITERATIONS = 5;

export async function POST(request: Request) {
  const body = await request.json() as { question?: string };
  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }

  const db = getDb();
  const memories = getMemories(db);
  const recent = getRecentConversations(db, 5);

  const systemPrompt = [
    "You are Ray's personal stock research assistant.",
    'Answer questions about stocks based on what YouTube creators have said in their recent videos.',
    'Always cite which channel and video your answer comes from.',
    'When Ray says "remember X", call the save_memory tool.',
    '',
    "What you know about Ray:",
    memories.length > 0 ? memories.map(m => `- ${m}`).join('\n') : '(no memories yet)',
    '',
    'Recent conversations:',
    recent.length > 0
      ? recent.map(c => `Q: ${c.question}\nA: ${c.answer}`).join('\n\n')
      : '(no prior conversations)',
  ].join('\n');

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text');
      const answer = textBlock?.type === 'text' ? textBlock.text : 'No answer found.';
      saveConversation(db, question, answer);
      extractAndSaveMemories(db, question, answer);
      return NextResponse.json({ answer });
    }

    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) break;

    const toolResults: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map(block => {
      if (block.type !== 'tool_use') return { type: 'tool_result' as const, tool_use_id: '', content: '' };
      const result = executeToolCall(block.name, block.input as Record<string, unknown>, db);
      return { type: 'tool_result' as const, tool_use_id: block.id, content: result };
    });

    messages.push(
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults },
    );
    iterations++;
  }

  return NextResponse.json({
    answer: "I couldn't find enough information to answer that confidently. Try asking about a specific ticker or channel.",
  });
}

function extractAndSaveMemories(db: ReturnType<typeof getDb>, question: string, answer: string): void {
  doExtractMemories(db, question, answer).catch(err =>
    console.error('[memory extraction] failed:', err)
  );
}

async function doExtractMemories(db: ReturnType<typeof getDb>, question: string, answer: string): Promise<void> {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: `Based on this Q&A, what did you learn about Ray's preferences or portfolio that should be remembered for future sessions? Return a JSON array of short strings, or [] if nothing new.\n\nQ: ${question}\nA: ${answer}`,
    }],
  });
  const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]';
  let items: unknown;
  try {
    items = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim());
  } catch { return; }
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (typeof item === 'string' && item.trim().length > 0) {
      saveMemory(db, item.trim(), 'extracted');
    }
  }
}
