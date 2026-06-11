'use client';

import { useState, useEffect, useCallback } from 'react';
import React from 'react';
import type { LeaderboardEntry } from '@/app/api/leaderboard/route';

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const styles: Record<string, string> = {
    bullish: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
    bearish: 'bg-red-100 text-red-700 ring-1 ring-red-200',
    neutral: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[sentiment] ?? styles.neutral}`}>
      {sentiment}
    </span>
  );
}

function ConvictionDot({ conviction }: { conviction: string }) {
  const dots = { high: 3, medium: 2, low: 1 }[conviction] ?? 1;
  return (
    <span className="flex gap-0.5 items-center">
      {[1, 2, 3].map(i => (
        <span key={i} className={`w-1.5 h-1.5 rounded-full ${i <= dots ? 'bg-blue-500' : 'bg-gray-200'}`} />
      ))}
    </span>
  );
}

export default function Page() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [fetchResult, setFetchResult] = useState<{ videosProcessed: number; tickersFound: number; errors: string[] } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadLeaderboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      setEntries(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadLeaderboard(); }, [loadLeaderboard]);

  async function handleFetch() {
    setFetching(true);
    setFetchResult(null);
    try {
      const res = await fetch('/api/fetch', { method: 'POST' });
      const data = await res.json();
      setFetchResult(data);
      setLastFetched(new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
      await loadLeaderboard();
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
          <div className="mb-6 flex items-start gap-3 p-4 rounded-xl bg-white border border-gray-200 shadow-sm text-sm">
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
              <p className="text-gray-700 font-medium">No signals yet</p>
              <p className="text-gray-400 text-sm mt-1">Hit <span className="text-blue-600 font-medium">Fetch Latest</span> to pull today&apos;s data from YouTube</p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm bg-white">
            {/* Table header */}
            <div className="grid grid-cols-[2fr_2.5fr_1fr_1fr_1fr_1.5fr] text-xs font-medium text-gray-400 uppercase tracking-wider px-5 py-3 bg-gray-50 border-b border-gray-200">
              <span>Ticker</span>
              <span>Company</span>
              <span className="text-center">Channels</span>
              <span className="text-center">Mentions</span>
              <span className="text-center">Score</span>
              <span>Sentiment</span>
            </div>

            {/* Rows */}
            <div className="divide-y divide-gray-100">
              {entries.map((entry) => {
                const isExpanded = expanded === entry.ticker;
                const sentiment = topSentiment(entry);

                return (
                  <React.Fragment key={entry.ticker}>
                    <div
                      onClick={() => setExpanded(isExpanded ? null : entry.ticker)}
                      className={`grid grid-cols-[2fr_2.5fr_1fr_1fr_1fr_1.5fr] px-5 py-4 cursor-pointer transition-colors items-center
                        ${isExpanded ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'}`}
                    >
                      <span className="font-mono font-bold text-blue-600 tracking-wide text-sm">{entry.ticker}</span>
                      <span className="text-gray-700 text-sm truncate pr-4">{entry.company ?? '—'}</span>
                      <span className="text-center text-gray-500 text-sm">{entry.channel_count}</span>
                      <span className="text-center text-gray-500 text-sm">{entry.mention_count}</span>
                      <span className="text-center font-semibold text-gray-900 text-sm">{entry.weighted_score.toFixed(2)}</span>
                      <SentimentBadge sentiment={sentiment} />
                    </div>

                    {isExpanded && entry.details.length > 0 && (
                      <div className="bg-blue-50/50 border-t border-blue-100 px-5 py-4">
                        <div className="space-y-3">
                          {entry.details.map((d, j) => (
                            <div key={j} className="grid grid-cols-[160px_1fr_100px_80px] gap-4 text-sm items-center">
                              <span className="text-gray-700 font-medium truncate">{d.channel_name}</span>
                              <span className="text-gray-400 truncate text-xs">{d.video_title}</span>
                              <SentimentBadge sentiment={d.sentiment} />
                              <ConvictionDot conviction={d.conviction} />
                            </div>
                          ))}
                          {entry.details.some(d => d.quote) && (
                            <div className="mt-3 pt-3 border-t border-blue-100 space-y-1.5">
                              {entry.details.filter(d => d.quote).map((d, j) => (
                                <p key={j} className="text-xs text-gray-500 italic">
                                  <span className="text-gray-400 not-italic font-medium">{d.channel_name}: </span>
                                  &ldquo;{d.quote}&rdquo;
                                </p>
                              ))}
                            </div>
                          )}
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
    </div>
  );
}
