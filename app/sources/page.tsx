'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { SourceStatus } from '@/app/api/sources/route';
import { PasswordProtection } from '@/app/components/PasswordProtection';

// Stored timestamps are SQLite's `datetime('now')` — "YYYY-MM-DD HH:MM:SS" in
// UTC, with no zone marker — so say so explicitly rather than letting the
// browser read them as local time.
function parseUtc(stamp: string): Date {
  return new Date(stamp.replace(' ', 'T') + (/[Zz]|[+-]\d{2}:?\d{2}$/.test(stamp) ? '' : 'Z'));
}

function formatWhen(stamp: string | null): string {
  if (!stamp) return 'never';
  const date = parseUtc(stamp);
  if (Number.isNaN(date.getTime())) return stamp;
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  const relative =
    minutes < 1 ? 'just now'
    : minutes < 60 ? `${minutes}m ago`
    : minutes < 60 * 24 ? `${Math.round(minutes / 60)}h ago`
    : `${Math.round(minutes / (60 * 24))}d ago`;
  return `${relative} · ${date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })}`;
}

/** Pipeline errors are stored prefixed with the source name; the row already
 *  shows it, so drop the repeat. */
function stripSourceName(error: string, name: string): string {
  return error.startsWith(`${name}: `) ? error.slice(name.length + 2) : error;
}

function StatusDot({ status }: { status: SourceStatus }) {
  const [color, label] =
    status.lastRunOk === null ? ['bg-gray-300', 'No run recorded yet']
    : status.lastRunOk ? ['bg-emerald-500', 'Last run succeeded']
    : ['bg-red-500', 'Last run failed'];
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${color}`} title={label} />;
}

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceStatus[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/sources')
      .then(res => res.json())
      .then((data: SourceStatus[]) => { if (!cancelled) setSources(data); })
      .catch(() => { if (!cancelled) setSources([]); });
    return () => { cancelled = true; };
  }, []);

  return (
    <PasswordProtection>
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-gray-600 transition-colors text-sm">← Dashboard</Link>
            <span className="text-gray-300">/</span>
            <span className="font-semibold text-gray-900">Sources</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <p className="text-sm text-gray-500 mb-6">
          Every source, when it last pulled successfully, and anything that has gone wrong since.
        </p>

        {sources === null ? (
          <div className="flex items-center justify-center py-24">
            <span className="text-gray-400 text-sm">Loading…</span>
          </div>
        ) : sources.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-12 text-center">
            <p className="text-gray-800 font-medium">No sources recorded yet</p>
            <p className="text-gray-500 text-sm mt-1">
              Sources appear here after the first fetch run.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
            {sources.map(source => (
              <div key={source.channelId} className="px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <StatusDot status={source} />
                    <Link
                      href={`/channel/${source.channelId}`}
                      className="font-semibold text-sm text-gray-800 hover:text-blue-600 transition-colors truncate"
                    >
                      {source.name}
                    </Link>
                    <span className="text-xs text-gray-400 truncate hidden sm:block">{source.handle}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-gray-500">Last successful pull</div>
                    <div className={`text-sm font-medium ${source.lastSuccessAt ? 'text-gray-800' : 'text-gray-400'}`}>
                      {formatWhen(source.lastSuccessAt)}
                    </div>
                    {source.lastSuccessItems !== null && (
                      <div className="text-xs text-gray-400">
                        {source.lastSuccessItems} item{source.lastSuccessItems === 1 ? '' : 's'}
                      </div>
                    )}
                  </div>
                </div>

                {source.lastError && (
                  <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                    <div className="text-[11px] font-semibold text-red-800 uppercase tracking-wide">
                      Last error · {formatWhen(source.lastErrorAt)}
                    </div>
                    <p className="text-xs text-red-700 mt-1 break-words">{stripSourceName(source.lastError, source.name)}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
    </PasswordProtection>
  );
}
