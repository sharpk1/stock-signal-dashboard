import { ServerClient } from 'postmark';
import type { NewVideo } from '@/lib/fetch-pipeline';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://stock-signal-dashboard-nine.vercel.app';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtml(videos: NewVideo[]): string {
  // group by channel, preserving first-seen order
  const byChannel = new Map<string, NewVideo[]>();
  for (const v of videos) {
    if (!byChannel.has(v.channelName)) byChannel.set(v.channelName, []);
    byChannel.get(v.channelName)!.push(v);
  }

  const sections = [...byChannel.entries()].map(([channel, vids]) => {
    const rows = vids.map(v => {
      const tickers = v.tickers.length
        ? `<div style="margin-top:4px">${v.tickers.map(t =>
            `<span style="display:inline-block;font:600 11px ui-monospace,monospace;color:#1d4ed8;background:#eff6ff;border:1px solid #dbeafe;border-radius:4px;padding:1px 6px;margin:0 4px 4px 0">${escapeHtml(t)}</span>`
          ).join('')}</div>`
        : '';
      return `<tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9">
        <a href="${encodeURI(v.url)}" style="color:#0f172a;font-weight:600;font-size:14px;text-decoration:none">${escapeHtml(v.title)}</a>
        ${tickers}
      </td></tr>`;
    }).join('');
    return `<div style="margin-bottom:22px">
      <div style="font:600 12px system-ui;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${escapeHtml(channel)}</div>
      <table style="width:100%;border-collapse:collapse">${rows}</table>
    </div>`;
  }).join('');

  return `<div style="max-width:560px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;color:#0f172a">
    <h2 style="font-size:18px;margin:0 0 4px">📈 ${videos.length} new video${videos.length === 1 ? '' : 's'} pulled</h2>
    <p style="color:#64748b;font-size:13px;margin:0 0 20px">Here's what dropped across your channels.</p>
    ${sections}
    <a href="${APP_URL}" style="display:inline-block;background:#2563eb;color:#fff;font-size:14px;font-weight:600;text-decoration:none;padding:9px 16px;border-radius:8px;margin-top:8px">Open the dashboard →</a>
  </div>`;
}

export async function sendNewVideosEmail(videos: NewVideo[]): Promise<void> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const to = process.env.NOTIFY_EMAIL;
  const from = process.env.EMAIL_FROM; // must be a verified Postmark sender / on a verified domain
  if (!token || !to || !from) {
    throw new Error('POSTMARK_SERVER_TOKEN / NOTIFY_EMAIL / EMAIL_FROM not set');
  }

  const client = new ServerClient(token);
  const subject = `📈 ${videos.length} new video${videos.length === 1 ? '' : 's'} — Stock Signals`;

  const res = await client.sendEmail({
    From: from,
    To: to,
    Subject: subject,
    HtmlBody: buildHtml(videos),
    MessageStream: process.env.POSTMARK_MESSAGE_STREAM ?? 'outbound',
  });
  if (res.ErrorCode !== 0) {
    throw new Error(`Postmark error ${res.ErrorCode}: ${res.Message}`);
  }
}
