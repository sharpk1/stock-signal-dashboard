'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import React from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { LeaderboardEntry } from '@/app/api/leaderboard/route';
import { CHANNELS } from '@/lib/channels';
import type { ChannelWinRate } from '@/app/api/winrate/route';
import type { VideoUrl } from '@/app/api/videos/route';
import type { DigestVideo } from '@/app/api/digest/route';
import type { ConvergenceAlert } from '@/lib/db';
import { PasswordProtection } from '@/app/components/PasswordProtection';

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

function ConvergenceBadge({ isConvergent, rrSolo, channels }: { isConvergent: boolean; rrSolo: boolean; channels: string }) {
  if (isConvergent) {
    const others = channels.split(',').filter(c => c.trim() !== 'Robert Reynolds').map(c => c.trim());
    const label = others.length === 1 ? `RR + ${others[0]}` : `RR + ${others.length} others`;
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-300 whitespace-nowrap">
        ⚡ {label}
      </span>
    );
  }
  if (rrSolo) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap">
        RR pick
      </span>
    );
  }
  return null;
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

function OutcomeBadge({ outcome }: { outcome: 'win' | 'loss' | 'skip' }) {
  const styles = {
    win: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    loss: 'bg-red-50 text-red-700 border border-red-200',
    skip: 'bg-gray-100 text-gray-500 border border-gray-200',
  };
  const labels = { win: '✓ Win', loss: '✗ Loss', skip: '— Skip' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${styles[outcome]}`}>
      {labels[outcome]}
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
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<'recent' | 'signals' | 'track-record' | 'notifications'>('recent');
  const [digest, setDigest] = useState<DigestVideo[]>([]);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestDays, setDigestDays] = useState<3 | 7 | 14>(7);
  const [digestExpanded, setDigestExpanded] = useState<string | null>(null);
  const [leaderboardDays, setLeaderboardDays] = useState<7 | 14 | 30>(7);
  const [alerts, setAlerts] = useState<ConvergenceAlert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [winRateData, setWinRateData] = useState<ChannelWinRate[]>([]);
  const [winRateDays, setWinRateDays] = useState<30 | 60 | 90>(30);
  const [expandedWinChannel, setExpandedWinChannel] = useState<string | null>(null);
  const [winRateLoading, setWinRateLoading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportVideos, setExportVideos] = useState<VideoUrl[]>([]);
  const [exportDays, setExportDays] = useState<7 | 30 | 0>(7);
  const [copied, setCopied] = useState(false);

  const loadLeaderboard = useCallback(async (days: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leaderboard?days=${days}`);
      const data = await res.json();
      setEntries(data);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAlerts = useCallback(async () => {
    setAlertsLoading(true);
    try {
      const res = await fetch('/api/alerts');
      const data = await res.json() as { alerts: ConvergenceAlert[]; unreadCount: number };
      setAlerts(data.alerts);
      setUnreadCount(data.unreadCount);
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  async function markRead(id: number) {
    await fetch(`/api/alerts/${id}`, { method: 'PATCH' });
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, read: 1 } : a));
    setUnreadCount(prev => Math.max(0, prev - 1));
  }

  useEffect(() => { loadLeaderboard(leaderboardDays); }, [loadLeaderboard, leaderboardDays]);
  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  const loadDigest = useCallback(async (days: number) => {
    setDigestLoading(true);
    try {
      const res = await fetch(`/api/digest?days=${days}`);
      setDigest(await res.json());
    } finally {
      setDigestLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'recent') loadDigest(digestDays);
  }, [activeTab, digestDays, loadDigest]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const loadWinRate = useCallback(async (days: 30 | 60 | 90) => {
    setWinRateLoading(true);
    try {
      const res = await fetch(`/api/winrate?window=${days}`);
      const data: ChannelWinRate[] = await res.json();
      setWinRateData(data);
    } finally {
      setWinRateLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'track-record') loadWinRate(winRateDays);
  }, [activeTab, winRateDays, loadWinRate]);

  async function openExport() {
    setExportOpen(true);
    const res = await fetch(`/api/videos?days=${exportDays}`);
    const data: VideoUrl[] = await res.json();
    setExportVideos(data);
  }

  async function changeExportDays(days: 7 | 30 | 0) {
    setExportDays(days);
    setExportVideos([]);
    const res = await fetch(`/api/videos?days=${days}`);
    const data: VideoUrl[] = await res.json();
    setExportVideos(data);
  }

  function copyAllUrls() {
    const text = exportVideos.map(v => v.url).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleFetch() {
    setFetching(true);
    setFetchResult(null);
    try {
      const res = await fetch('/api/fetch', { method: 'POST' });
      const data = await res.json();
      setFetchResult(data);
      setLastFetched(new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
      await Promise.all([loadLeaderboard(leaderboardDays), loadAlerts(), loadDigest(digestDays)]);
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
        body: JSON.stringify({ question }),
      });
      const data = await res.json() as { answer?: string };
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.answer ?? 'Something went wrong. Please try again.' }]);
    } finally {
      setChatLoading(false);
    }
  }

  return (
    <PasswordProtection>
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
          <div className="flex items-center gap-2">
            <button
              onClick={openExport}
              className="flex items-center gap-2 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Export URLs
            </button>
            <button
              onClick={() => setChatOpen(true)}
              className="flex items-center gap-2 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3-3-3z" />
              </svg>
              Ask AI
            </button>
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

        {/* Tab switcher */}
        <div className="flex mb-6 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('recent')}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'recent' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Recent
          </button>
          <button
            onClick={() => setActiveTab('signals')}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'signals' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Signals
          </button>
          <button
            onClick={() => setActiveTab('track-record')}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === 'track-record' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Track Record
          </button>
          <button
            onClick={() => { setActiveTab('notifications'); if (activeTab !== 'notifications') loadAlerts(); }}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-2 ${
              activeTab === 'notifications' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Notifications
            {unreadCount > 0 && (
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold">
                {unreadCount}
              </span>
            )}
          </button>
        </div>

        {activeTab === 'recent' && (
          <div>
            <div className="flex items-center gap-1 mb-4">
              <span className="text-xs text-gray-500 mr-1">Last:</span>
              {([3, 7, 14] as const).map(d => (
                <button
                  key={d}
                  onClick={() => setDigestDays(d)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    digestDays === d ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
                  }`}
                >
                  {d}d
                </button>
              ))}
              {!digestLoading && <span className="text-xs text-gray-400 ml-2">{digest.length} video{digest.length === 1 ? '' : 's'}</span>}
            </div>

            {digestLoading ? (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <svg className="animate-spin h-6 w-6 text-blue-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span className="text-gray-400 text-sm">Loading recent activity…</span>
              </div>
            ) : digest.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
                <div className="w-14 h-14 rounded-2xl bg-white border border-gray-200 shadow-sm flex items-center justify-center text-2xl">🗞️</div>
                <div>
                  <p className="text-gray-800 font-medium">Nothing new in this window</p>
                  <p className="text-gray-500 text-sm mt-1">Try a longer range, or hit Fetch Latest</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {digest.map(v => {
                  const isOpen = digestExpanded === v.video_id;
                  return (
                    <div key={v.video_id} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                      <div className="px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => setDigestExpanded(isOpen ? null : v.video_id)}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold text-blue-600">{v.channel_name}</span>
                          <span className="text-xs text-gray-400">{v.published_at.slice(0, 10)}</span>
                        </div>
                        <div className="flex items-start gap-2 mt-1">
                          <span className="text-gray-400 text-xs mt-0.5">{isOpen ? '▼' : '▶'}</span>
                          <span className="font-medium text-gray-900 text-sm flex-1">{v.title}</span>
                          <a href={v.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-gray-400 hover:text-blue-600 text-sm shrink-0">↗</a>
                        </div>
                        {v.mentions.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2 pl-5">
                            {v.mentions.slice(0, 8).map((m, i) => (
                              <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-bold text-blue-700 bg-blue-50 border border-blue-100">{m.ticker}</span>
                            ))}
                            {v.mentions.length > 8 && <span className="text-[11px] text-gray-400 self-center">+{v.mentions.length - 8}</span>}
                          </div>
                        )}
                      </div>
                      {isOpen && (
                        <div className="bg-slate-50 border-t border-slate-100 px-5 py-4">
                          {v.summary ? (
                            <div className="text-sm text-gray-700 leading-relaxed">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  h1: ({ children }) => <p className="font-bold text-gray-900 mt-3 mb-1 first:mt-0">{children}</p>,
                                  h2: ({ children }) => <p className="font-bold text-gray-900 mt-3 mb-1 first:mt-0">{children}</p>,
                                  h3: ({ children }) => <p className="font-semibold text-gray-900 mt-2 mb-1 first:mt-0">{children}</p>,
                                  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
                                  ul: ({ children }) => <ul className="list-disc list-inside space-y-0.5 my-1">{children}</ul>,
                                  ol: ({ children }) => <ol className="list-decimal list-inside space-y-0.5 my-1">{children}</ol>,
                                  p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                                }}
                              >
                                {v.summary}
                              </ReactMarkdown>
                            </div>
                          ) : (
                            <p className="text-sm text-gray-400 italic">No summary available</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'signals' && (<>
        {/* Channel project links */}
        <div className="flex flex-wrap gap-2 mb-4">
          {CHANNELS.map(ch => (
            <Link
              key={ch.id}
              href={`/channel/${ch.channelId}`}
              className="px-3 py-1.5 rounded-full text-xs font-medium bg-white border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600 transition-colors"
            >
              {ch.name} →
            </Link>
          ))}
        </div>

        {/* Leaderboard time range selector */}
        <div className="flex items-center gap-1 mb-4">
          <span className="text-xs text-gray-500 mr-1">Window:</span>
          {([7, 14, 30] as const).map(d => (
            <button
              key={d}
              onClick={() => setLeaderboardDays(d)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                leaderboardDays === d
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              {d}d
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
                        ${isExpanded ? 'bg-blue-50' : entry.is_convergent ? 'bg-amber-50/40 hover:bg-amber-50' : 'bg-white hover:bg-gray-50'}`}
                    >
                      <span className="text-gray-400 text-xs font-medium">{index + 1}</span>
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="font-mono font-bold text-blue-600 tracking-wide text-sm">{entry.ticker}</span>
                        <ConvergenceBadge isConvergent={entry.is_convergent} rrSolo={entry.rr_solo} channels={entry.channels} />
                      </div>
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
        </>)}

        {activeTab === 'notifications' && (
          <div>
            {alertsLoading ? (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <svg className="animate-spin h-6 w-6 text-blue-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span className="text-gray-400 text-sm">Loading alerts…</span>
              </div>
            ) : alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
                <div className="w-14 h-14 rounded-2xl bg-white border border-gray-200 shadow-sm flex items-center justify-center text-2xl">⚡</div>
                <div>
                  <p className="text-gray-800 font-medium">No convergence alerts yet</p>
                  <p className="text-gray-500 text-sm mt-1">Alerts appear when RR and another channel both mention the same ticker</p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm bg-white divide-y divide-gray-100">
                {alerts.map(alert => {
                  const quotes = (() => { try { return JSON.parse(alert.quotes ?? '[]') as { quote: string; channel_name: string }[]; } catch { return []; } })();
                  const otherChannels = alert.channels.split(',').filter(c => c.trim() !== 'Robert Reynolds').map(c => c.trim());
                  return (
                    <div
                      key={alert.id}
                      onClick={() => alert.read === 0 && markRead(alert.id)}
                      className={`px-5 py-4 cursor-pointer transition-colors ${alert.read === 0 ? 'bg-amber-50/40 hover:bg-amber-50' : 'hover:bg-gray-50'}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <span className="text-amber-500 text-sm">⚡</span>
                          <span className="font-mono font-bold text-blue-600 tracking-wide">{alert.ticker}</span>
                          <span className="text-gray-500 text-sm">— RR + {otherChannels.join(', ')}</span>
                          {alert.read === 0 && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500 text-white">NEW</span>
                          )}
                        </div>
                        <span className="text-xs text-gray-400 shrink-0">{alert.alerted_at.slice(0, 10)}</span>
                      </div>
                      {quotes.length > 0 && (
                        <div className="mt-2 space-y-1.5 pl-5">
                          {quotes.map((q, i) => (
                            <p key={i} className="text-xs text-gray-600 italic">
                              <span className="font-medium not-italic text-gray-700">{q.channel_name}:</span> &ldquo;{q.quote.length > 140 ? q.quote.slice(0, 140) + '…' : q.quote}&rdquo;
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'track-record' && (
          <div>
            {/* Window toggle */}
            <div className="flex items-center gap-1 mb-6">
              <span className="text-xs text-gray-500 mr-2">Evaluation window:</span>
              {([30, 60, 90] as const).map(d => (
                <button
                  key={d}
                  onClick={() => setWinRateDays(d)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    winRateDays === d
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>

            {winRateLoading ? (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <svg className="animate-spin h-6 w-6 text-blue-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span className="text-gray-400 text-sm">Loading track record…</span>
              </div>
            ) : (
              <>
                {/* Channel scorecards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                  {winRateData.map(ch => {
                    const isSelected = expandedWinChannel === ch.channel_name;
                    const barColor = ch.win_rate >= 65 ? 'bg-emerald-500' : ch.win_rate >= 50 ? 'bg-amber-400' : 'bg-red-400';
                    const rateColor = ch.win_rate >= 65 ? 'text-emerald-600' : ch.win_rate >= 50 ? 'text-amber-600' : 'text-red-500';
                    return (
                      <button
                        key={ch.channel_name}
                        onClick={() => setExpandedWinChannel(isSelected ? null : ch.channel_name)}
                        className={`text-left p-5 rounded-xl border bg-white shadow-sm transition-all ${
                          isSelected ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="text-sm font-semibold text-gray-800 mb-4">{ch.channel_name}</div>
                        <div className={`text-4xl font-bold mb-0.5 ${rateColor}`}>{ch.win_rate}%</div>
                        <div className="text-xs text-gray-400 mb-3">Win Rate</div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-3">
                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${ch.win_rate}%` }} />
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-emerald-600 font-medium">{ch.wins}W</span>
                          <span className="text-gray-300">·</span>
                          <span className="text-red-500 font-medium">{ch.losses}L</span>
                          {ch.skips > 0 && <><span className="text-gray-300">·</span><span className="text-gray-500">{ch.skips} skip</span></>}
                          <span className="text-gray-300">·</span>
                          <span className="text-gray-400">{ch.wins + ch.losses + ch.skips} calls</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Expanded call history */}
                {(() => {
                  const ch = winRateData.find(c => c.channel_name === expandedWinChannel);
                  if (!ch) return null;
                  return (
                    <div className="rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm">
                      <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
                        <span className="font-semibold text-gray-800 text-sm">{ch.channel_name}</span>
                        <span className="text-gray-400 text-sm ml-2">— {ch.wins + ch.losses + ch.skips} calls · last {winRateDays}d</span>
                      </div>
                      <div className="overflow-x-auto">
                        <div className="min-w-[720px]">
                          <div className="grid grid-cols-[80px_1fr_100px_65px_80px_80px_70px_90px] px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">
                            <span>Ticker</span>
                            <span>Company</span>
                            <span>Call</span>
                            <span>Conv.</span>
                            <span>Entry</span>
                            <span>Now</span>
                            <span>Return</span>
                            <span>Outcome</span>
                          </div>
                          {ch.calls.map((call, i) => (
                            <div key={i} className="grid grid-cols-[80px_1fr_100px_65px_80px_80px_70px_90px] px-5 py-3 border-b border-gray-100 last:border-0 items-center hover:bg-gray-50 transition-colors">
                              <span className="font-mono font-bold text-blue-600 text-sm">{call.ticker}</span>
                              <span className="text-gray-700 text-sm pr-4 truncate">{call.company}</span>
                              <SentimentBadge sentiment={call.sentiment} />
                              <span className="text-gray-600 text-sm">{call.conviction}%</span>
                              <span className="text-gray-600 text-sm tabular-nums">${call.entry_price >= 100 ? call.entry_price.toFixed(0) : call.entry_price.toFixed(2)}</span>
                              <span className="text-gray-600 text-sm tabular-nums">${call.current_price >= 100 ? call.current_price.toFixed(0) : call.current_price.toFixed(2)}</span>
                              <span className={`text-sm font-medium tabular-nums ${
                                call.outcome === 'skip' ? 'text-gray-400' :
                                call.return_pct >= 0 ? 'text-emerald-600' : 'text-red-500'
                              }`}>
                                {call.outcome === 'skip' ? '—' : `${call.return_pct >= 0 ? '+' : ''}${call.return_pct.toFixed(1)}%`}
                              </span>
                              <OutcomeBadge outcome={call.outcome} />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}
      </main>

      {/* Export URLs modal */}
      {exportOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4"
          onClick={() => setExportOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-900">Export to NotebookLM</h2>
                <button onClick={() => setExportOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
              </div>
              <div className="flex items-center gap-1">
                {([7, 30, 0] as const).map(d => (
                  <button
                    key={d}
                    onClick={() => changeExportDays(d)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                      exportDays === d
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {d === 0 ? 'All time' : `Last ${d} days`}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-3">
              {exportVideos.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <svg className="animate-spin h-5 w-5 text-blue-500" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                </div>
              ) : (
                <div className="space-y-2">
                  {exportVideos.map(v => (
                    <div key={v.video_id} className="flex items-start gap-3 py-2 border-b border-gray-100 last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{v.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {v.channel_name} · {v.published_at.slice(0, 10)}
                        </p>
                      </div>
                      <a
                        href={v.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-xs text-blue-600 hover:underline shrink-0 pt-0.5"
                      >
                        ↗
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between shrink-0">
              <span className="text-xs text-gray-400">{exportVideos.length} videos</span>
              <button
                onClick={copyAllUrls}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {copied ? (
                  <>
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy All URLs
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Chat backdrop */}
      {chatOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-20"
          onClick={() => setChatOpen(false)}
        />
      )}

      {/* Chat panel */}
      <div className={`fixed inset-y-0 right-0 w-[580px] bg-white shadow-2xl border-l border-gray-200 flex flex-col z-30 transition-transform duration-300 ${chatOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Panel header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center">
              <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3-3-3z" />
              </svg>
            </div>
            <span className="font-semibold text-gray-900 text-sm">Stock Signals AI</span>
          </div>
          <button
            onClick={() => setChatOpen(false)}
            className="text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {chatMessages.length === 0 && (
            <div className="text-center text-gray-400 text-sm mt-8 px-4">
              <p className="font-medium text-gray-600 mb-1">Ask about any stock</p>
              <p className="text-xs leading-relaxed">What&apos;s Jeremy saying about Celsius? What&apos;s the consensus on SOFI?</p>
            </div>
          )}
          {chatMessages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}>
                {m.role === 'user' ? m.content : (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h3: ({ children }) => <p className="font-bold text-gray-900 mt-2 mb-1">{children}</p>,
                      h2: ({ children }) => <p className="font-bold text-gray-900 mt-2 mb-1">{children}</p>,
                      strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
                      hr: () => <hr className="my-2 border-gray-300" />,
                      ul: ({ children }) => <ul className="list-disc list-inside space-y-0.5 my-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside space-y-0.5 my-1">{children}</ol>,
                      p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                      blockquote: ({ children }) => <blockquote className="border-l-2 border-gray-400 pl-3 italic my-1 text-gray-600">{children}</blockquote>,
                      table: ({ children }) => <table className="text-xs border-collapse my-2 w-full">{children}</table>,
                      th: ({ children }) => <th className="border border-gray-300 px-2 py-1 bg-gray-200 font-semibold text-left">{children}</th>,
                      td: ({ children }) => <td className="border border-gray-300 px-2 py-1">{children}</td>,
                    }}
                  >
                    {m.content}
                  </ReactMarkdown>
                )}
              </div>
            </div>
          ))}
          {chatLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-xl px-3 py-2 text-sm text-gray-400 animate-pulse">
                Thinking…
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-gray-200 px-4 py-3 flex gap-2 shrink-0">
          <textarea
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask anything…"
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
