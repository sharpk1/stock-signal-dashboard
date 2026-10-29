'use client';

import { useState } from 'react';
import { formatTranscriptForCopy } from '@/lib/transcript';
import type { TranscriptResponse } from '@/app/api/transcript/route';

/**
 * Copy and read the source text behind an item. Ray checks summaries by pasting
 * the transcript into ChatGPT himself, so the copied text carries its title,
 * source, date and link.
 *
 * The transcript is fetched on demand: most items are never opened, and a long
 * livestream transcript is far too big to ship with every list.
 */
export function TranscriptPanel({ videoId }: { videoId: string }) {
  const [item, setItem] = useState<TranscriptResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load(): Promise<TranscriptResponse | null> {
    if (item) return item;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/transcript?videoId=${encodeURIComponent(videoId)}`);
      const data = await res.json() as TranscriptResponse & { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Could not load the transcript.');
        return null;
      }
      setItem(data);
      return data;
    } catch {
      setError('Could not reach the server.');
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    const loaded = await load();
    if (!loaded) return;
    try {
      await navigator.clipboard.writeText(formatTranscriptForCopy(loaded));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; showing the text is the way out.
      setError('Could not copy automatically — open the transcript and copy it by hand.');
      setShown(true);
    }
  }

  async function toggle() {
    if (shown) { setShown(false); return; }
    if (await load()) setShown(true);
  }

  return (
    <div className="mt-4 pt-3 border-t border-slate-200">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={copy}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"
        >
          {copied ? '✓ Copied' : loading ? 'Loading…' : 'Copy transcript'}
        </button>
        <button
          onClick={toggle}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:text-blue-600 disabled:opacity-50"
        >
          {shown ? 'Hide transcript' : 'View transcript'}
        </button>
        {item && (
          <span className="text-[11px] text-gray-400">
            {item.transcript.length.toLocaleString()} characters
          </span>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {shown && item && (
        <pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs leading-relaxed text-gray-700">
          {item.transcript}
        </pre>
      )}
    </div>
  );
}
