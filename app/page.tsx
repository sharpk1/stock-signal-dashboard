'use client';

import { useState, useEffect, useCallback } from 'react';
import React from 'react';
import type { LeaderboardEntry } from '@/app/api/leaderboard/route';
import { CHANNELS } from '@/lib/channels';

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const styles: Record<string, string> = {
    bullish: 'bg-emerald-50 text-emerald-800 border border-emerald-300',
    bearish: 'bg-red-50 text-red-800 border border-red-300',
    neutral: 'bg-gray-100 text-gray-700 border border-gray-300',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${styles[sentiment] ?? styles.neutral}`}>
      {sentiment}
    </span>
  );
}

function ConvictionBadge({ conviction }: { conviction: number }) {
  const [color, label] =
    conviction >= 90 ? ['bg-emerald-50 text-emerald-800 border border-emerald-300', 'Max'] :
    conviction >= 75 ? ['bg-emerald-50 text-emerald-800 border border-emerald-300', 'High'] :
    conviction >= 50 ? ['bg-blue-50 text-blue-800 border border-blue-300', 'Medium'] :
    conviction >= 25 ? ['bg-amber-50 text-amber-800 border border-amber-300', 'Low'] :
    ['bg-gray-100 text-gray-600 border border-gray-300', 'Weak'];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${color}`}>
      {label} <span className="opacity-60">{conviction}%</span>
    </span>
  );
}

function formatFetchedAt(dateStr: string): string {
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const QUOTE_TRUNCATE = 120;

export default function Page() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [fetchResult, setFetchResult] = useState<{ videosProcessed: number; tickersFound: number; errors: string[] } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [modalQuote, setModalQuote] = useState<string | null>(null);

  const loadLeaderboard = useCallback(async (channel?: string | null) => {
    setLoading(true);
    try {
      const url = channel ? `/api/leaderboard?channel=${encodeURIComponent(channel)}` : '/api/leaderboard';
      const res = await fetch(url);
      const data = await res.json();
      setEntries(data);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleChannelFilter(channel: string | null) {
    setSelectedChannel(channel);
    setExpanded(null);
    loadLeaderboard(channel);
  }

  useEffect(() => { loadLeaderboard(null); }, [loadLeaderboard]);

  async function handleFetch() {
    setFetching(true);
    setFetchResult(null);
    try {
      const res = await fetch('/api/fetch', { method: 'POST' });
      const data = await res.json();
      setFetchResult(data);
      setLastFetched(new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
      await loadLeaderboard(selectedChannel);
    } finally {
      setFetching(false);
    }
  }

  function topSentiment(entry: LeaderboardEntry): string {
    if (!entry.details.length) return 'neutral';
    const counts = entry.details.reduce<Record<string, number>>((acc, d) => {
      acc[d.sentiment] = (acc[d.sentiment] ?? 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral';
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-xs font-bold text-white">S</div>
            <span className="font-semibold text-gray-900 tracking-tight">Stock Signals</span>
            {lastFetched && (
              <span className="text-xs text-gray-400 hidden sm:block">· Updated {lastFetched}</span>
            )}
          </div>
          <button
            onClick={handleFetch}
            disabled={fetching}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {fetching ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Fetching…
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Fetch Latest
              </>
            )}
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Fetch result banner */}
        {fetchResult && (
          <div className="mb-5 flex items-start gap-3 p-4 rounded-xl bg-white border border-gray-200 shadow-sm text-sm">
            <div className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
            <div>
              <span className="text-gray-700">
                Processed <span className="font-semibold text-gray-900">{fetchResult.videosProcessed}</span> videos &mdash; found <span className="font-semibold text-gray-900">{fetchResult.tickersFound}</span> ticker mentions
              </span>
              {fetchResult.errors.length > 0 && (
                <details className="mt-2">
                  <summary className="text-amber-600 cursor-pointer text-xs">{fetchResult.errors.length} channel warnings</summary>
                  <ul className="mt-1 text-amber-500 text-xs space-y-0.5 list-disc list-inside">
                    {fetchResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </details>
              )}
            </div>
          </div>
        )}

        {/* Channel filter pills */}
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            onClick={() => handleChannelFilter(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              selectedChannel === null
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
            }`}
          >
            All Channels
          </button>
          {CHANNELS.map(ch => (
            <button
              key={ch.id}
              onClick={() => handleChannelFilter(ch.name)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedChannel === ch.name
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              {ch.name}
            </button>
          ))}
        </div>

        {/* Main content */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <svg className="animate-spin h-6 w-6 text-blue-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span className="text-gray-400 text-sm">Loading signals…</span>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white border border-gray-200 shadow-sm flex items-center justify-center text-2xl">📡</div>
            <div>
              <p className="text-gray-800 font-medium">No signals yet</p>
              <p className="text-gray-500 text-sm mt-1">Hit <span className="text-blue-600 font-medium">Fetch Latest</span> to pull today&apos;s data from YouTube</p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm bg-white">
            {/* Table header */}
            <div className="grid grid-cols-[28px_2fr_2.5fr_1fr_1fr_1fr_1.5fr] text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3 bg-gray-50 border-b border-gray-200">
              <span>#</span>
              <span>Ticker</span>
              <span>Company</span>
              <span className="text-center">Channels</span>
              <span className="text-center">Mentions</span>
              <span className="relative group flex items-center justify-center gap-1 cursor-default">
                Score
                <span className="text-gray-400 text-[10px]">ⓘ</span>
                <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-64 bg-gray-900 text-white text-xs rounded-lg px-3 py-2.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 shadow-lg normal-case tracking-normal font-normal text-left leading-relaxed">
                  <p className="font-semibold mb-1">How score is calculated</p>
                  <p className="text-gray-300">Average conviction score across all mentions of this stock in the last 24h.</p>
                  <p className="text-gray-400 mt-1.5">Conviction is 0–100% based on position size, price targets, certainty language, and depth of analysis.</p>
                </div>
              </span>
              <span>Sentiment</span>
            </div>

            {/* Rows */}
            <div className="divide-y divide-gray-100">
              {entries.map((entry, index) => {
                const isExpanded = expanded === entry.ticker;
                const sentiment = topSentiment(entry);

                return (
                  <React.Fragment key={entry.ticker}>
                    <div
                      onClick={() => setExpanded(isExpanded ? null : entry.ticker)}
                      className={`grid grid-cols-[28px_2fr_2.5fr_1fr_1fr_1fr_1.5fr] px-5 py-4 cursor-pointer transition-colors items-center
                        ${isExpanded ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'}`}
                    >
                      <span className="text-gray-400 text-xs font-medium">{index + 1}</span>
                      <span className="font-mono font-bold text-blue-600 tracking-wide text-sm">{entry.ticker}</span>
                      <span className="text-gray-800 text-sm truncate pr-4">{entry.company ?? '—'}</span>
                      <span className="text-center text-gray-600 text-sm font-medium">{entry.channel_count}</span>
                      <span className="text-center text-gray-600 text-sm font-medium">{entry.mention_count}</span>
                      <span className="text-center font-bold text-gray-900 text-sm">{entry.normalized_score}%</span>
                      <SentimentBadge sentiment={sentiment} />
                    </div>

                    {isExpanded && entry.details.length > 0 && (
                      <div className="bg-slate-50 border-t border-slate-200 px-5 py-4">
                        <div className="space-y-0">
                          <div className="grid grid-cols-[160px_1fr_auto_auto] gap-x-4 text-xs font-semibold text-gray-500 uppercase tracking-wider pb-2 border-b border-slate-200">
                            <span>Channel</span>
                            <span>Video</span>
                            <span>Sentiment</span>
                            <span>Conviction</span>
                          </div>
                          {entry.details.map((d, j) => (
                            <div key={j} className="grid grid-cols-[160px_1fr_auto_auto] gap-x-4 items-start py-3 border-b border-slate-100 last:border-0">
                              <span className="text-gray-800 font-semibold text-sm truncate pt-0.5">{d.channel_name}</span>
                              <div className="flex flex-col gap-0.5 min-w-0">
                                <span className="text-gray-700 text-sm font-medium truncate">{d.video_title}</span>
                                <span className="text-gray-400 text-[11px]">Fetched {formatFetchedAt(d.fetched_at)}</span>
                                {d.quote && (
                                  <span className="text-gray-600 text-[12px] italic leading-relaxed mt-0.5">
                                    &ldquo;{d.quote.length > QUOTE_TRUNCATE ? d.quote.slice(0, QUOTE_TRUNCATE) + '…' : d.quote}&rdquo;
                                    {d.quote.length > QUOTE_TRUNCATE && (
                                      <button
                                        onClick={e => { e.stopPropagation(); setModalQuote(d.quote!); }}
                                        className="ml-1.5 text-blue-600 not-italic font-medium hover:underline"
                                      >
                                        read more
                                      </button>
                                    )}
                                  </span>
                                )}
                              </div>
                              <SentimentBadge sentiment={d.sentiment} />
                              <ConvictionBadge conviction={d.conviction} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Quote modal */}
      {modalQuote && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4"
          onClick={() => setModalQuote(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl p-6 max-w-lg w-full"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-gray-800 text-sm italic leading-relaxed">&ldquo;{modalQuote}&rdquo;</p>
            <button
              onClick={() => setModalQuote(null)}
              className="mt-5 text-xs text-gray-400 hover:text-gray-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
