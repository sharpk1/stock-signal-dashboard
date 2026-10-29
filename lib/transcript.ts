export interface TranscriptItem {
  title: string;
  channelName: string;
  publishedAt: string;
  /** Empty for a hand-pasted item, which has no public page. */
  url: string;
  transcript: string;
}

/**
 * The text the Copy button puts on the clipboard. Ray pastes this straight into
 * ChatGPT to check a summary himself, so the source has to travel with it —
 * a wall of transcript with no title or date is unverifiable.
 */
export function formatTranscriptForCopy(item: TranscriptItem): string {
  const header = [
    item.title,
    `${item.channelName} · ${item.publishedAt.slice(0, 10)}`,
    item.url || null,
  ].filter(Boolean).join('\n');

  return `${header}\n\n${item.transcript.trim()}\n`;
}
