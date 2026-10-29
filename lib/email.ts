import { ServerClient } from 'postmark';
import type { AlertDecision } from '@/lib/alerts';
import { alertSubject } from '@/lib/alerts';
import { buildDigestHtml, digestSubject, type DigestContent } from '@/lib/daily-digest';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://stock-signal-dashboard-nine.vercel.app';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Who hears about a broken source. ALERT_EMAILS takes a comma-separated list
 * (Ray and Kush); it falls back to the digest recipient so alerts still reach
 * someone if only the original single address is configured.
 */
export function alertRecipients(): string[] {
  const raw = process.env.ALERT_EMAILS ?? process.env.NOTIFY_EMAIL ?? '';
  return [...new Set(raw.split(',').map(address => address.trim()).filter(Boolean))];
}

function buildAlertHtml(decision: AlertDecision): string {
  const sources = decision.newlyFailing.map(source => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9">
      <div style="font-weight:600;font-size:14px;color:#0f172a">${escapeHtml(source.name)}</div>
      <div style="font:12px ui-monospace,monospace;color:#b91c1c;margin-top:4px;word-break:break-word">${escapeHtml(source.latestError ?? 'failed with no error recorded')}</div>
    </td></tr>`).join('');

  const sourcesBlock = decision.newlyFailing.length > 0 ? `
    <div style="margin-bottom:22px">
      <div style="font:600 12px system-ui;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Sources that stopped working</div>
      <table style="width:100%;border-collapse:collapse">${sources}</table>
    </div>` : '';

  const creditBlock = decision.creditProblem ? `
    <div style="margin-bottom:22px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px">
      <div style="font:600 12px system-ui;color:#92400e;text-transform:uppercase;letter-spacing:.05em">AI credit</div>
      <div style="font-size:13px;color:#92400e;margin-top:4px;word-break:break-word">${escapeHtml(decision.creditProblem)}</div>
      <div style="font-size:12px;color:#a16207;margin-top:6px">Summaries and ticker extraction stop until this is topped up.</div>
    </div>` : '';

  const cookieBlock = decision.cookieProblem ? `
    <div style="margin-bottom:22px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px">
      <div style="font:600 12px system-ui;color:#92400e;text-transform:uppercase;letter-spacing:.05em">Substack session</div>
      <div style="font-size:13px;color:#92400e;margin-top:4px;word-break:break-word">${escapeHtml(decision.cookieProblem)}</div>
      <div style="font-size:12px;color:#a16207;margin-top:6px">Robert Reynolds' posts stop coming through once the session cookie expires.</div>
    </div>` : '';

  return `<div style="max-width:560px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;color:#0f172a">
    <h2 style="font-size:18px;margin:0 0 4px">⚠️ Stock Signals needs attention</h2>
    <p style="color:#64748b;font-size:13px;margin:0 0 20px">Picked up on the last scheduled run.</p>
    ${sourcesBlock}
    ${creditBlock}
    ${cookieBlock}
    <a href="${APP_URL}/sources" style="display:inline-block;background:#2563eb;color:#fff;font-size:14px;font-weight:600;text-decoration:none;padding:9px 16px;border-radius:8px;margin-top:8px">See every source →</a>
  </div>`;
}

/**
 * Email the alert. Returns false, rather than throwing, when email isn't
 * configured yet — a missing key should never take down a scheduled run.
 */
export async function sendAlertEmail(decision: AlertDecision): Promise<boolean> {
  if (!decision.shouldSend) return false;

  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.EMAIL_FROM;
  const to = alertRecipients();
  if (!token || !from || to.length === 0) {
    console.warn('[alerts] not sent — POSTMARK_SERVER_TOKEN / EMAIL_FROM / ALERT_EMAILS not set');
    return false;
  }

  const client = new ServerClient(token);
  const res = await client.sendEmail({
    From: from,
    To: to.join(','),
    Subject: alertSubject(decision),
    HtmlBody: buildAlertHtml(decision),
    MessageStream: process.env.POSTMARK_MESSAGE_STREAM ?? 'outbound',
  });
  if (res.ErrorCode !== 0) {
    throw new Error(`Postmark error ${res.ErrorCode}: ${res.Message}`);
  }
  return true;
}

/**
 * The daily summary. Goes to the same people as the failure alerts; returns
 * false rather than throwing when email isn't configured yet.
 */
export async function sendDailyDigestEmail(content: DigestContent): Promise<boolean> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.EMAIL_FROM;
  const to = alertRecipients();
  if (!token || !from || to.length === 0) {
    console.warn('[digest] not sent — POSTMARK_SERVER_TOKEN / EMAIL_FROM / ALERT_EMAILS not set');
    return false;
  }

  const client = new ServerClient(token);
  const res = await client.sendEmail({
    From: from,
    To: to.join(','),
    Subject: digestSubject(content),
    HtmlBody: buildDigestHtml(content, APP_URL),
    MessageStream: process.env.POSTMARK_MESSAGE_STREAM ?? 'outbound',
  });
  if (res.ErrorCode !== 0) {
    throw new Error(`Postmark error ${res.ErrorCode}: ${res.Message}`);
  }
  return true;
}
