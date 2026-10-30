'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { XUser } from '@/lib/x';

/** Page frame shared by the form and the bad-link message. */
export function SetupShell({ badge, children }: { badge?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f8f9fb] text-gray-900 px-4 py-8 sm:py-12 flex justify-center">
      <div className="w-full max-w-[640px] flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <span className="w-6 h-6 rounded-md bg-blue-600 text-white flex items-center justify-center text-xs font-bold">S</span>
            Stock Signals
          </span>
          {badge && (
            <span className="text-xs text-gray-600 bg-white border border-gray-200 rounded-full px-2.5 py-1">{badge}</span>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-[14px] p-[22px] flex flex-col gap-3.5">
      <div className="flex items-center gap-2.5">
        <span className="w-[26px] h-[26px] rounded-full bg-blue-600 text-white text-[13px] font-bold flex items-center justify-center shrink-0">{n}</span>
        <h2 className="text-[17px] font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Notice({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div
      role={ok ? 'status' : 'alert'}
      className={`flex items-center gap-2 text-[13px] rounded-lg px-2.5 py-2 mt-1 border ${
        ok ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-red-800 bg-red-50 border-red-200'
      }`}
    >
      {ok && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#047857" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
          <path d="M5 12l5 5 9-11" />
        </svg>
      )}
      {children}
    </div>
  );
}

const INPUT = 'flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const BUTTON = 'border border-gray-300 bg-white rounded-lg px-4 py-2.5 text-sm font-semibold text-gray-900 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed';

interface Row {
  id: number;
  /** Who Kush expects this row to be, until X answers with the real name. */
  label: string | null;
  input: string;
  looking: boolean;
  user: XUser | null;
  error: string | null;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

async function post<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? `Request failed (${res.status})` };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: 'Couldn’t reach the dashboard. Check your connection and try again.' };
  }
}

export function XSetupForm({ setupKey, expires }: { setupKey: string; expires: string }) {
  const [token, setToken] = useState('');
  const [test, setTest] = useState<{ state: 'idle' | 'testing' | 'ok' | 'error'; message?: string }>({ state: 'idle' });
  const [rows, setRows] = useState<Row[]>([
    { id: 1, label: 'Chris Camillo', input: '', looking: false, user: null, error: null },
    { id: 2, label: 'Holy Smokas', input: '', looking: false, user: null, error: null },
  ]);
  const [nextId, setNextId] = useState(3);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ handle: string; name: string }[] | null>(null);

  const update = (id: number, patch: Partial<Row>) =>
    setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));

  async function runTest() {
    setTest({ state: 'testing' });
    const res = await post('/api/setup/x/test', { key: setupKey, token });
    setTest(res.ok ? { state: 'ok' } : { state: 'error', message: res.error });
  }

  async function lookUp(row: Row) {
    update(row.id, { looking: true, error: null, user: null });
    const res = await post<{ user: XUser }>('/api/setup/x/lookup', { key: setupKey, token, handle: row.input });
    update(row.id, res.ok ? { looking: false, user: res.data.user } : { looking: false, error: res.error });
  }

  function addRow() {
    setRows(rs => [...rs, { id: nextId, label: null, input: '', looking: false, user: null, error: null }]);
    setNextId(n => n + 1);
  }

  // A row with something typed in has to resolve before it can be saved; an
  // empty row is just ignored.
  const typed = rows.filter(r => r.user || r.input.trim());
  const unresolved = typed.filter(r => !r.user);
  const canSave = test.state === 'ok' && typed.length > 0 && unresolved.length === 0 && !saving;

  async function save() {
    setSaving(true);
    setSaveError(null);
    const res = await post<{ accounts: { handle: string; name: string }[] }>('/api/setup/x/save', {
      key: setupKey, token, handles: typed.map(r => r.user!.username),
    });
    setSaving(false);
    if (res.ok) {
      setToken('');
      setSaved(res.data.accounts);
    } else {
      setSaveError(res.error);
    }
  }

  if (saved) {
    return (
      <SetupShell>
        <section className="bg-white border border-gray-200 rounded-[14px] p-[22px] flex flex-col gap-3">
          <h1 className="text-[22px] font-bold">X is connected</h1>
          <p className="text-[15px] text-gray-600 leading-relaxed">
            Following {saved.map(a => `${a.name} (@${a.handle})`).join(', ')}. Their posts from the last week are being
            pulled now and will show up on your dashboard with tickers in a few minutes. New posts follow on the regular schedule.
          </p>
          <p className="text-[13px] text-gray-500">This link no longer works. Your token is stored encrypted.</p>
          <Link href="/" className="text-blue-600 hover:text-blue-700 text-sm font-medium">Go to the dashboard →</Link>
        </section>
      </SetupShell>
    );
  }

  return (
    <SetupShell badge={`Private setup link · expires ${expires}`}>
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] font-bold">Connect X</h1>
        <p className="text-[15px] text-gray-600 leading-relaxed">
          Add your X token once and pick the accounts to follow. Their new posts will show up on your dashboard with
          tickers, like your YouTube sources. X bills you directly, pay per use.
        </p>
      </div>

      <Step n={1} title="Get your token from X">
        <ol className="list-decimal pl-[52px] flex flex-col gap-2 text-sm leading-relaxed text-gray-700">
          <li>Sign in at <a href="https://console.x.com" target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-700">console.x.com</a> with your X account.</li>
          <li>Set a monthly spending limit. About $20 is plenty, since we only fetch new posts.</li>
          <li>Create an app and copy its <strong>Bearer Token</strong>.</li>
        </ol>
      </Step>

      <Step n={2} title="Paste the token">
        <div className="flex flex-col gap-1.5 sm:pl-9">
          <label htmlFor="token" className="text-[13px] font-medium text-gray-700">Bearer token</label>
          <div className="flex gap-2">
            <input
              id="token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={e => { setToken(e.target.value); setTest({ state: 'idle' }); }}
              className={INPUT}
            />
            <button onClick={runTest} disabled={!token.trim() || test.state === 'testing'} className={BUTTON}>
              {test.state === 'testing' ? 'Testing…' : 'Test'}
            </button>
          </div>
          {test.state === 'ok' && <Notice ok>Token works. X answered with it.</Notice>}
          {test.state === 'error' && <Notice ok={false}>{test.message}</Notice>}
        </div>
      </Step>

      <Step n={3} title="Accounts to follow">
        <div className="flex flex-col gap-2.5 sm:pl-9">
          {rows.map(row => row.user ? (
            <div key={row.id} className="flex items-center gap-3 border border-gray-200 rounded-[10px] px-3 py-2.5">
              {row.user.avatarUrl ? (
                // Hotlinked from X's CDN, as the commentator cards do.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.user.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0 bg-gray-200" />
              ) : (
                <span className="w-9 h-9 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center text-[13px] font-semibold shrink-0">{initials(row.user.name)}</span>
              )}
              <div className="flex flex-col gap-0.5 grow min-w-0">
                <span className="text-sm font-semibold truncate">{row.user.name}</span>
                <span className="text-xs text-gray-600 truncate">@{row.user.username} · found on X</span>
              </div>
              <button
                aria-label={`Remove ${row.user.name}`}
                onClick={() => setRows(rs => rs.filter(r => r.id !== row.id))}
                className="p-2 text-gray-500 hover:text-gray-800 text-base"
              >✕</button>
            </div>
          ) : (
            <div key={row.id} className="flex flex-col gap-1.5">
              <label htmlFor={`handle-${row.id}`} className={row.label ? 'text-[13px] font-medium text-gray-700' : 'sr-only'}>
                {row.label ? `${row.label}’s X handle` : 'Add another X account'}
              </label>
              <div className="flex gap-2">
                <input
                  id={`handle-${row.id}`}
                  placeholder="@handle"
                  autoComplete="off"
                  value={row.input}
                  onChange={e => update(row.id, { input: e.target.value, error: null })}
                  onKeyDown={e => { if (e.key === 'Enter' && row.input.trim() && token.trim()) lookUp(row); }}
                  className={INPUT}
                />
                <button onClick={() => lookUp(row)} disabled={!row.input.trim() || !token.trim() || row.looking} className={BUTTON}>
                  {row.looking ? 'Looking…' : 'Look up'}
                </button>
                {rows.length > 1 && (
                  <button
                    aria-label={`Remove ${row.label ?? 'this row'}`}
                    onClick={() => setRows(rs => rs.filter(r => r.id !== row.id))}
                    className="p-2 text-gray-500 hover:text-gray-800 text-base"
                  >✕</button>
                )}
              </div>
              {row.error && <Notice ok={false}>{row.error}</Notice>}
            </div>
          ))}
          <button onClick={addRow} className="self-start text-sm font-medium text-blue-600 hover:text-blue-700 py-1">
            + Add another account
          </button>
        </div>
      </Step>

      <div className="flex flex-col gap-2.5">
        {saveError && <Notice ok={false}>{saveError}</Notice>}
        <button
          onClick={save}
          disabled={!canSave}
          className="bg-blue-600 hover:bg-blue-700 rounded-[10px] p-3.5 min-h-12 text-base font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save and start following'}
        </button>
        {test.state !== 'ok' ? (
          <p className="text-[13px] text-gray-500 text-center">Test the token first.</p>
        ) : unresolved.length > 0 ? (
          <p className="text-[13px] text-gray-500 text-center">Look up every handle you typed, or remove it, before saving.</p>
        ) : null}
        <p className="text-[13px] text-gray-600 text-center leading-relaxed">
          Your token is stored encrypted and never shown again. This link stops working once you save.
          <br />
          Posts from the last week appear on your dashboard within a few minutes, then new ones every 3 hours.
        </p>
      </div>
    </SetupShell>
  );
}
