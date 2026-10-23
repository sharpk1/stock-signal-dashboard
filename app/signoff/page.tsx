'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import type { Deliverable, DeliverableStatus } from '@/lib/deliverables';
import { PasswordProtection } from '@/app/components/PasswordProtection';

const NAME_KEY = 'stock-signals-signoff-name';

const PART_TITLES: Record<string, string> = {
  A: 'Part A · Make it trustworthy',
  B: 'Part B · Your sources, done right',
};

function StatusBadge({ status }: { status: DeliverableStatus }) {
  const styles: Record<DeliverableStatus, [string, string]> = {
    not_started: ['bg-gray-100 text-gray-600 border border-gray-200', 'Not started'],
    in_progress: ['bg-amber-50 text-amber-800 border border-amber-200', 'In progress'],
    delivered: ['bg-blue-50 text-blue-700 border border-blue-200', 'Delivered'],
  };
  const [cls, label] = styles[status];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${cls}`}>{label}</span>;
}

function formatDate(sqlDate: string): string {
  return new Date(sqlDate.replace(' ', 'T') + 'Z').toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function SignOffPage() {
  const [items, setItems] = useState<Deliverable[]>([]);
  const [loading, setLoading] = useState(true);
  // Safe to read storage here: PasswordProtection only renders this page in the browser.
  const [name, setName] = useState(() => {
    try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
  });
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/deliverables?phase=Phase%201');
    setItems(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function saveName(v: string) {
    setName(v);
    try { localStorage.setItem(NAME_KEY, v); } catch { /* storage blocked */ }
  }

  async function toggle(item: Deliverable) {
    if (!name.trim()) { setError('Type your name above before signing off.'); return; }
    setError('');
    setSaving(item.code);
    const res = await fetch(`/api/deliverables/${item.code}/signoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, signed: !item.signedOffAt }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? 'Could not save. Try again.');
    await load();
    setSaving(null);
  }

  const signed = items.filter(i => i.signedOffAt).length;
  const delivered = items.filter(i => i.status === 'delivered').length;
  const parts = [...new Set(items.map(i => i.part))];

  return (
    <PasswordProtection>
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-gray-600 transition-colors text-sm">← Dashboard</Link>
            <span className="text-gray-300">/</span>
            <span className="font-semibold text-gray-900">Phase 1 sign-off</span>
          </div>
          <span className="text-sm text-gray-500 tabular-nums">{signed} of {items.length} signed off</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Phase 1 deliverables</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Each item can be signed off once it&apos;s delivered. Check the &quot;Done when&quot; test, then tick the box.
            Every sign-off is saved with your name and the time.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums">{delivered}<span className="text-gray-400 text-base"> / {items.length}</span></div>
            <div className="text-xs text-gray-500">delivered</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums text-emerald-700">{signed}<span className="text-gray-400 text-base"> / {items.length}</span></div>
            <div className="text-xs text-gray-500">signed off</div>
          </div>
          <label className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex flex-col gap-1" htmlFor="signer">
            <span className="text-xs text-gray-500">Signing as</span>
            <input
              id="signer"
              value={name}
              onChange={e => saveName(e.target.value)}
              placeholder="Your name"
              className="text-sm font-medium border-b border-gray-200 focus:outline-none focus:border-blue-500 py-0.5"
            />
          </label>
        </div>

        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>}

        {loading ? (
          <div className="text-gray-400 text-sm">Loading deliverables…</div>
        ) : items.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-6 text-sm text-gray-500">
            No deliverables yet. They appear here once Kush syncs the Phase 1 checklist.
          </div>
        ) : parts.map(part => (
          <section key={part} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 font-semibold text-sm">{PART_TITLES[part] ?? `Part ${part}`}</div>
            <ul>
              {items.filter(i => i.part === part).map(item => {
                const canSign = item.status === 'delivered';
                return (
                  <li key={item.code} className="px-5 py-4 border-b border-gray-100 last:border-0 flex items-start gap-4">
                    <input
                      type="checkbox"
                      id={`so-${item.code}`}
                      className="mt-1 h-5 w-5 accent-emerald-600 disabled:opacity-30"
                      checked={!!item.signedOffAt}
                      disabled={(!canSign && !item.signedOffAt) || saving === item.code}
                      onChange={() => toggle(item)}
                      aria-label={`Sign off ${item.code}`}
                    />
                    <label htmlFor={`so-${item.code}`} className="flex-1 min-w-0 flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-blue-600">{item.code}</span>
                        <span className="font-medium">{item.title}</span>
                        <StatusBadge status={item.status} />
                      </div>
                      <div className="text-sm text-gray-500"><span className="text-gray-400">Done when:</span> {item.doneWhen}</div>
                      {item.signedOffAt && (
                        <div className="text-xs text-emerald-700">Signed off by {item.signedOffBy} · {formatDate(item.signedOffAt)}</div>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>
    </div>
    </PasswordProtection>
  );
}
