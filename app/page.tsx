'use client';

import { useState, useEffect, useCallback } from 'react';
import React from 'react';
import type { LeaderboardEntry } from '@/app/api/leaderboard/route';

export default function Page() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
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
      setLastFetched(new Date().toLocaleString());
      await loadLeaderboard();
    } finally {
      setFetching(false);
    }
  }

  const sentimentColor = (s: string) => {
    if (s === 'bullish') return 'text-green-600 font-medium';
    if (s === 'bearish') return 'text-red-600 font-medium';
    return 'text-gray-500';
  };

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Signal Dashboard</h1>
          {lastFetched && (
            <p className="text-sm text-gray-500 mt-1">Last fetched: {lastFetched}</p>
          )}
        </div>
        <button
          onClick={handleFetch}
          disabled={fetching}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {fetching ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Fetching…
            </>
          ) : (
            'Fetch Latest ▶'
          )}
        </button>
      </div>

      {fetchResult && (
        <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200 text-sm">
          <span className="text-gray-700">
            Processed <strong>{fetchResult.videosProcessed}</strong> videos, found <strong>{fetchResult.tickersFound}</strong> ticker mentions.
          </span>
          {fetchResult.errors.length > 0 && (
            <details className="mt-1">
              <summary className="text-yellow-700 cursor-pointer">{fetchResult.errors.length} warnings</summary>
              <ul className="mt-1 text-yellow-600 list-disc list-inside">
                {fetchResult.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 text-center py-12">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-gray-500 text-center py-12">
          No signals found. Hit <strong>Fetch Latest</strong> to pull today&apos;s data.
        </p>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Ticker</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Company</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Channels</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Mentions</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-700">Score</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Sentiment</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => {
                const isExpanded = expanded === entry.ticker;
                const dominantSentiment = entry.details.length > 0
                  ? entry.details.reduce<Record<string, number>>((acc, d) => {
                      acc[d.sentiment] = (acc[d.sentiment] ?? 0) + 1;
                      return acc;
                    }, {})
                  : {};
                const topSentiment = Object.entries(dominantSentiment).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral';

                return (
                  <React.Fragment key={entry.ticker}>
                    <tr
                      onClick={() => setExpanded(isExpanded ? null : entry.ticker)}
                      className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                    >
                      <td className="px-4 py-3 font-mono font-bold text-blue-700">{entry.ticker}</td>
                      <td className="px-4 py-3 text-gray-700">{entry.company ?? '—'}</td>
                      <td className="px-4 py-3 text-center text-gray-700">{entry.channel_count}</td>
                      <td className="px-4 py-3 text-center text-gray-700">{entry.mention_count}</td>
                      <td className="px-4 py-3 text-center font-medium text-gray-900">{entry.weighted_score.toFixed(2)}</td>
                      <td className={`px-4 py-3 ${sentimentColor(topSentiment)}`}>{topSentiment}</td>
                    </tr>
                    {isExpanded && entry.details.length > 0 && (
                      <tr key={`${entry.ticker}-details`} className="border-t border-gray-100 bg-blue-50/30">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="space-y-2">
                            {entry.details.map((d, j) => (
                              <div key={j} className="flex gap-3 text-sm">
                                <span className="font-medium text-gray-700 min-w-[160px]">{d.channel_name}</span>
                                <span className="text-gray-500 min-w-[120px]">{d.video_title.slice(0, 40)}{d.video_title.length > 40 ? '…' : ''}</span>
                                <span className={`min-w-[70px] ${sentimentColor(d.sentiment)}`}>{d.sentiment}</span>
                                <span className="text-gray-400 min-w-[60px]">{d.conviction}</span>
                                {d.quote && <span className="text-gray-600 italic">&quot;{d.quote}&quot;</span>}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
