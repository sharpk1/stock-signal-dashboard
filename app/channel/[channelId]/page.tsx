'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CHANNELS } from '@/lib/channels';
import { ETORO_SNAPSHOTS, type EtoroSnapshot } from '@/lib/etoro';
import { PASTE_TYPE_LABELS, isPasteType } from '@/lib/paste';
import { TranscriptPanel } from '@/app/components/TranscriptPanel';
import type { ChannelVideo } from '@/app/api/videos/route';
import { itemKind, type ItemKind } from '@/lib/item-kind';
import type { ChatSource } from '@/app/api/chat/route';
import { PasswordProtection } from '@/app/components/PasswordProtection';

function formatAsOf(asOf: string): string {
  const date = new Date(`${asOf}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? asOf
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * What this person actually owns, ranked the way eToro ranks it — by the share
 * of the portfolio put in at cost. Hand-maintained in lib/etoro.ts: eToro
 * publishes no portfolio API, so a refresh is an edit to that file.
 */
function EtoroHoldings({ snapshot }: { snapshot: EtoroSnapshot }) {
  const positions = [...snapshot.positions].sort((a, b) => b.investedPct - a.investedPct);
  const totalInvested = positions.reduce((sum, p) => sum + p.investedPct, 0);
  const widest = positions[0]?.investedPct || 1;

  return (
    <div className="mb-6 bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm text-gray-800">eToro holdings</span>
          <span className="text-xs text-gray-400">{positions.length} positions · {totalInvested.toFixed(1)}% invested</span>
        </div>
        <a
          href={`https://www.etoro.com/people/${snapshot.etoroUser.toLowerCase()}/portfolio`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-violet-800 hover:underline"
        >
          Last updated {formatAsOf(snapshot.asOf)} →
        </a>
      </div>
      <ul className="divide-y divide-gray-100">
        {positions.map(position => (
          <li key={position.ticker} className="px-5 py-2.5 flex items-center gap-3">
            <span className="font-mono text-xs font-semibold text-gray-800 w-14 shrink-0">{position.ticker}</span>
            <span className="text-sm text-gray-600 truncate flex-1 min-w-0">
              {position.name}
              {position.etoroSymbol && (
                <span className="text-xs text-gray-400"> · {position.etoroSymbol}</span>
              )}
            </span>
            <span className="hidden sm:block w-24 shrink-0" aria-hidden="true">
              <span className="block h-1.5 rounded-full bg-violet-100">
                <span
                  className="block h-1.5 rounded-full bg-violet-500"
                  style={{ width: `${Math.max(4, (position.investedPct / widest) * 100)}%` }}
                />
              </span>
            </span>
            <span className="text-sm font-semibold text-gray-800 w-14 text-right shrink-0">
              {position.investedPct.toFixed(2)}%
            </span>
          </li>
        ))}
      </ul>
      <p className="px-5 py-2 text-[11px] text-gray-400 border-t border-gray-100">
        Invested % is the share of the portfolio put in at cost, as eToro reports it.
      </p>
    </div>
  );
}

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const styles: Record<string, string> = {
    bullish: 'bg-emerald-50 text-emerald-800 border border-emerald-300',
    bearish: 'bg-red-50 text-red-800 border border-red-300',
    neutral: 'bg-gray-100 text-gray-700 border border-gray-300',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${styles[sentiment] ?? styles.neutral}`}>
      {sentiment}
    </span>
  );
}

const MEDIA_STYLES: Record<ItemKind, string> = {
  YouTube: 'bg-red-50 text-red-700 border-red-200',
  'Substack video': 'bg-orange-50 text-orange-700 border-orange-200',
  'Substack article': 'bg-amber-50 text-amber-800 border-amber-200',
  Substack: 'bg-orange-50 text-orange-700 border-orange-200',
  Pasted: 'bg-gray-50 text-gray-600 border-gray-200',
};

/** Whether an item is a YouTube video, or a Substack video or article. */
function MediaLabel({ kind }: { kind: ItemKind }) {
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${MEDIA_STYLES[kind]}`}>{kind}</span>;
}

export default function ChannelPage() {
  const { channelId } = useParams<{ channelId: string }>();
  const channel = CHANNELS.find(c => c.channelId === channelId);
  const etoroSnapshot = ETORO_SNAPSHOTS.find(s => s.channelId === channelId);

  const [videos, setVideos] = useState<ChannelVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pinning, setPinning] = useState<string | null>(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string; sources?: ChatSource[] }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [urlInput, setUrlInput] = useState('');
  const [addingUrl, setAddingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const loadVideos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/videos?channelId=${channelId}&days=30`);
      const data = await res.json();
      setVideos(data);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => { loadVideos(); }, [loadVideos]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  async function togglePin(videoId: string) {
    setPinning(videoId);
    try {
      const res = await fetch('/api/videos/pin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
      const data = await res.json() as { pinned: boolean };
      setVideos(prev => prev.map(v =>
        v.video_id === videoId ? { ...v, pinned: data.pinned ? 1 : 0 } : v
      ));
    } finally {
      setPinning(null);
    }
  }

  async function handleAddUrl() {
    if (!urlInput.trim() || addingUrl) return;
    setAddingUrl(true);
    setUrlError(null);
    try {
      const res = await fetch('/api/fetch/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim(), channelId }),
      });
      const data = await res.json() as { error?: string; warning?: string | null };
      if (!res.ok) {
        setUrlError(data.error ?? 'Failed to add video');
      } else {
        setUrlInput('');
        // Added, but not analysed: the monthly AI budget is used up.
        if (data.warning) setUrlError(data.warning);
        await loadVideos();
      }
    } finally {
      setAddingUrl(false);
    }
  }

  async function handleSend() {
    if (!chatInput.trim() || chatLoading) return;
    const question = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: question }]);
    setChatLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, channelName: channel?.name }),
      });
      const data = await res.json() as { answer?: string; sources?: ChatSource[] };
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: data.answer ?? 'Something went wrong.',
        sources: data.sources,
      }]);
    } finally {
      setChatLoading(false);
    }
  }

  if (!channel) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 font-medium">Channel not found</p>
          <Link href="/" className="text-blue-600 text-sm hover:underline mt-2 inline-block">← Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <PasswordProtection>
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-gray-600 transition-colors text-sm">← Dashboard</Link>
            <span className="text-gray-300">/</span>
            <span className="font-semibold text-gray-900">{channel.name}</span>
          </div>
          <button
            onClick={() => setChatOpen(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3-3-3z" />
            </svg>
            Chat with {channel.name.split(' ')[0]}
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {etoroSnapshot && <EtoroHoldings snapshot={etoroSnapshot} />}

        {/* URL drop-in */}
        <div className="mb-6 flex gap-2">
          <input
            type="text"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddUrl()}
            placeholder="Paste a YouTube URL to pin it here…"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={handleAddUrl}
            disabled={addingUrl || !urlInput.trim()}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {addingUrl ? 'Adding…' : 'Add'}
          </button>
        </div>
        {urlError && <p className="text-red-500 text-sm mb-4">{urlError}</p>}

        {/* Video list */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <svg className="animate-spin h-6 w-6 text-blue-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span className="text-gray-400 text-sm">Loading videos…</span>
          </div>
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white border border-gray-200 shadow-sm flex items-center justify-center text-2xl">📺</div>
            <div>
              <p className="text-gray-800 font-medium">No videos yet</p>
              <p className="text-gray-500 text-sm mt-1">Videos will appear after the next auto-fetch</p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm bg-white divide-y divide-gray-100">
            {videos.map(video => {
              const isExpanded = expanded === video.video_id;
              const isPinned = video.pinned === 1;
              return (
                <div key={video.video_id}>
                  <div
                    className={`px-5 py-4 flex items-start gap-3 cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                    onClick={() => setExpanded(isExpanded ? null : video.video_id)}
                  >
                    <span className="text-gray-400 text-sm mt-0.5 w-4 shrink-0">{isExpanded ? '▼' : '▶'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 text-sm">{video.title}</span>
                        {video.item_type && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium text-violet-800 bg-violet-50 border border-violet-200">
                            {isPasteType(video.item_type) ? PASTE_TYPE_LABELS[video.item_type] : video.item_type}
                          </span>
                        )}
                        {isPinned && <span className="text-xs text-amber-600 font-medium">📌 pinned</span>}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                        {video.published_at.slice(0, 10)}
                        {!video.item_type && <MediaLabel kind={itemKind(video.channel_name, video.video_id, video.media)} />}
                      </p>
                      {video.mentions.length > 0 && !isExpanded && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {video.mentions.slice(0, 5).map((m, i) => (
                            <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono font-bold text-blue-700 bg-blue-50 border border-blue-100">
                              {m.ticker}
                            </span>
                          ))}
                          {video.mentions.length > 5 && <span className="text-[11px] text-gray-400">+{video.mentions.length - 5} more</span>}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); togglePin(video.video_id); }}
                      disabled={pinning === video.video_id}
                      className={`shrink-0 p-1.5 rounded-lg transition-colors ${isPinned ? 'text-amber-500 hover:bg-amber-50' : 'text-gray-300 hover:text-amber-400 hover:bg-amber-50'}`}
                      title={isPinned ? 'Unpin' : 'Pin permanently'}
                    >
                      📌
                    </button>
                    {video.url && <a
                      href={video.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="shrink-0 text-gray-400 hover:text-blue-600 text-sm pt-0.5"
                    >
                      ↗
                    </a>}
                  </div>

                  {isExpanded && (
                    <div className="bg-slate-50 border-t border-slate-100 px-5 py-4">
                      {video.summary ? (
                        <div className="mb-4">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Summary</p>
                          <div className="text-sm text-gray-700 leading-relaxed">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                h1: ({ children }) => <p className="font-bold text-gray-900 mt-3 mb-1 text-[15px] first:mt-0">{children}</p>,
                                h2: ({ children }) => <p className="font-bold text-gray-900 mt-3 mb-1 first:mt-0">{children}</p>,
                                h3: ({ children }) => <p className="font-semibold text-gray-900 mt-2 mb-1 first:mt-0">{children}</p>,
                                strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
                                ul: ({ children }) => <ul className="list-disc list-inside space-y-0.5 my-1">{children}</ul>,
                                ol: ({ children }) => <ol className="list-decimal list-inside space-y-0.5 my-1">{children}</ol>,
                                li: ({ children }) => <li className="ml-1">{children}</li>,
                                p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                              }}
                            >
                              {video.summary}
                            </ReactMarkdown>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400 italic mb-4">No summary available</p>
                      )}
                      {video.mentions.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Tickers mentioned</p>
                          <div className="flex flex-wrap gap-2">
                            {video.mentions.map((m, i) => (
                              <span key={i} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white border border-gray-200 text-xs">
                                <span className="font-mono font-bold text-blue-600">{m.ticker}</span>
                                <SentimentBadge sentiment={m.sentiment} />
                                <span className="text-gray-400">{m.conviction}%</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <TranscriptPanel videoId={video.video_id} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Chat backdrop */}
      {chatOpen && (
        <div className="fixed inset-0 bg-black/20 z-20" onClick={() => setChatOpen(false)} />
      )}

      {/* Chat panel */}
      <div className={`fixed inset-y-0 right-0 w-[560px] bg-white shadow-2xl border-l border-gray-200 flex flex-col z-30 transition-transform duration-300 ${chatOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center">
              <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3-3-3z" />
              </svg>
            </div>
            <span className="font-semibold text-gray-900 text-sm">{channel.name} AI</span>
          </div>
          <button onClick={() => setChatOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {chatMessages.length === 0 && (
            <div className="text-center text-gray-400 text-sm mt-8 px-4">
              <p className="font-medium text-gray-600 mb-1">Ask about {channel.name}&apos;s content</p>
              <p className="text-xs leading-relaxed">Only uses {channel.name}&apos;s videos as context</p>
            </div>
          )}
          {chatMessages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
                {m.role === 'user' ? m.content : (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                      strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
                      ul: ({ children }) => <ul className="list-disc list-inside space-y-0.5 my-1">{children}</ul>,
                    }}
                  >
                    {m.content}
                  </ReactMarkdown>
                )}
                {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-300">
                    <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Sources</div>
                    <ul className="space-y-0.5">
                      {m.sources.map(s => (
                        <li key={s.label}>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline break-words"
                          >
                            [{s.label}] {s.channelName} — {s.title}
                          </a>
                          <span className="text-[11px] text-gray-400"> · {s.publishedAt}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))}
          {chatLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-xl px-3 py-2 text-sm text-gray-400 animate-pulse">Thinking…</div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-gray-200 px-4 py-3 flex gap-2 shrink-0">
          <textarea
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={`Ask about ${channel.name}'s content…`}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={handleSend}
            disabled={chatLoading || !chatInput.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors"
          >
            →
          </button>
        </div>
      </div>
    </div>
    </PasswordProtection>
  );
}
