import { describe, it, expect, afterEach } from 'vitest';
import { summaryModel, chatModel, extractModel,
         DEFAULT_SUMMARY_MODEL, DEFAULT_CHAT_MODEL, DEFAULT_EXTRACT_MODEL } from '@/lib/models';

const original = { ...process.env };
afterEach(() => {
  process.env.SUMMARY_MODEL = original.SUMMARY_MODEL;
  process.env.CHAT_MODEL = original.CHAT_MODEL;
  process.env.EXTRACT_MODEL = original.EXTRACT_MODEL;
});

describe('model selection', () => {
  it('summarises and chats on Sonnet by default', () => {
    delete process.env.SUMMARY_MODEL;
    delete process.env.CHAT_MODEL;
    expect(summaryModel()).toBe(DEFAULT_SUMMARY_MODEL);
    expect(chatModel()).toBe(DEFAULT_CHAT_MODEL);
    expect(DEFAULT_SUMMARY_MODEL).toContain('sonnet');
    expect(DEFAULT_CHAT_MODEL).toContain('sonnet');
  });

  it('leaves ticker extraction on the cheaper model', () => {
    delete process.env.EXTRACT_MODEL;
    expect(extractModel()).toBe(DEFAULT_EXTRACT_MODEL);
    expect(DEFAULT_EXTRACT_MODEL).toContain('haiku');
  });

  it('lets a deployment override each one', () => {
    process.env.SUMMARY_MODEL = 'claude-opus-5-5';
    process.env.CHAT_MODEL = 'claude-haiku-5-5';
    process.env.EXTRACT_MODEL = 'claude-sonnet-5-5';
    expect(summaryModel()).toBe('claude-opus-5-5');
    expect(chatModel()).toBe('claude-haiku-5-5');
    expect(extractModel()).toBe('claude-sonnet-5-5');
  });

  it('ignores an empty or blank override', () => {
    process.env.SUMMARY_MODEL = '   ';
    expect(summaryModel()).toBe(DEFAULT_SUMMARY_MODEL);
  });
});
