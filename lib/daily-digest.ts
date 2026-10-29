/**
 * Composes the daily summary email. Pure: the route gathers the data, this
 * decides what the email says, so the wording and the edge cases (a quiet day,
 * a broken source) are testable without a mail server.
 */

export interface DigestItem {
  title: string;
  channelName: string;
  summary: string | null;
  tickers: string[];
  url: string;
}

export interface DigestTicker {
  ticker: string;
  company: string | null;
  channelCount: number;
  weightedScore: number;
  channels: string;
}

export interface DigestAlert {
  ticker: string;
  channels: string;
}

export interface DigestSourceError {
  name: string;
  error: string;
}

export interface DigestContent {
  date: string;
  items: DigestItem[];
  topTickers: DigestTicker[];
  alerts: DigestAlert[];
  sourceErrors: DigestSourceError[];
}

/** GROUP_CONCAT joins with a bare comma; an email reads better with spaces. */
function readableList(list: string): string {
  return list.split(',').map(part => part.trim()).filter(Boolean).join(', ');
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * One line per item in the digest — enough to decide whether to open it. Takes
 * the first real sentence of the summary, stepping over any heading the model
 * put at the top.
 */
export function oneLineSummary(summary: string | null, maxChars = 180): string {
  if (!summary) return 'No summary available.';

  for (const raw of summary.split('\n').map(line => line.trim()).filter(Boolean)) {
    if (/^[-*_=]{3,}$/.test(raw)) continue;   // a horizontal rule
    if (/^#{1,6}\s/.test(raw)) continue;      // a heading on its own line

    // A bold lead-in with text after it reads fine as "Label: text".
    const line = raw.replace(/^\*\*\s*(.+?)\s*:?\s*\*\*\s*:?\s*/, '$1: ').trim();
    if (!line || /^[^.!?]{1,40}:$/.test(line)) continue;  // a bare label

    const sentenceEnd = line.search(/[.!?](\s|$)/);
    const sentence = sentenceEnd > 0 ? line.slice(0, sentenceEnd + 1) : line;
    const chosen = sentence.length <= maxChars ? sentence : line;
    return chosen.length <= maxChars ? chosen : `${chosen.slice(0, maxChars - 1).trimEnd()}…`;
  }
  return 'No summary available.';
}

export function digestSubject(content: DigestContent): string {
  if (content.items.length === 0) {
    return `Signal Desk — nothing new, ${content.date}`;
  }
  const tickers = content.topTickers.slice(0, 3).map(t => t.ticker);
  const lead = tickers.length > 0 ? ` · ${tickers.join(', ')}` : '';
  return `Signal Desk — ${content.items.length} new item${content.items.length === 1 ? '' : 's'}${lead}`;
}

function section(title: string, inner: string): string {
  return `<div style="margin-bottom:22px">
    <div style="font:600 12px system-ui;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">${escapeHtml(title)}</div>
    ${inner}
  </div>`;
}

function tickerChip(ticker: string): string {
  return `<span style="display:inline-block;font:600 11px ui-monospace,monospace;color:#1d4ed8;background:#eff6ff;border:1px solid #dbeafe;border-radius:4px;padding:1px 6px;margin:0 4px 4px 0">${escapeHtml(ticker)}</span>`;
}

export function buildDigestHtml(content: DigestContent, appUrl: string): string {
  const alerts = content.alerts.length === 0 ? '' : section(
    `Convergence alerts (${content.alerts.length})`,
    content.alerts.map(a => `<div style="padding:8px 10px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;margin-bottom:6px">
      <span style="font:600 13px ui-monospace,monospace;color:#92400e">${escapeHtml(a.ticker)}</span>
      <span style="font-size:12px;color:#a16207"> — ${escapeHtml(readableList(a.channels))}</span>
    </div>`).join(''),
  );

  const tickers = content.topTickers.length === 0 ? '' : section(
    'Top tickers',
    `<table style="width:100%;border-collapse:collapse">${content.topTickers.map(t => `
      <tr>
        <td style="padding:6px 0;border-bottom:1px solid #f1f5f9">
          <span style="font:600 13px ui-monospace,monospace;color:#0f172a">${escapeHtml(t.ticker)}</span>
          ${t.company ? `<span style="font-size:12px;color:#64748b"> ${escapeHtml(t.company)}</span>` : ''}
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${t.channelCount} source${t.channelCount === 1 ? '' : 's'} · score ${t.weightedScore} · ${escapeHtml(readableList(t.channels))}</div>
        </td>
      </tr>`).join('')}</table>`,
  );

  const items = content.items.length === 0
    ? `<p style="color:#64748b;font-size:13px;margin:0">Nothing new came in today. The fetch ran — this is a quiet day, not a broken one.</p>`
    : section(
        `New items (${content.items.length})`,
        content.items.map(item => `<div style="padding:10px 0;border-bottom:1px solid #f1f5f9">
          <div style="font:600 12px system-ui;color:#64748b">${escapeHtml(item.channelName)}</div>
          ${item.url
            ? `<a href="${encodeURI(item.url)}" style="color:#0f172a;font-weight:600;font-size:14px;text-decoration:none">${escapeHtml(item.title)}</a>`
            : `<span style="color:#0f172a;font-weight:600;font-size:14px">${escapeHtml(item.title)}</span>`}
          <div style="font-size:13px;color:#475569;margin-top:3px">${escapeHtml(oneLineSummary(item.summary))}</div>
          ${item.tickers.length > 0 ? `<div style="margin-top:5px">${item.tickers.map(tickerChip).join('')}</div>` : ''}
        </div>`).join(''),
      );

  const errors = content.sourceErrors.length === 0 ? '' : `
    <div style="margin-top:26px;padding-top:12px;border-top:1px solid #e2e8f0">
      <div style="font:600 11px system-ui;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Sources needing attention</div>
      ${content.sourceErrors.map(e => `<div style="font-size:11px;color:#94a3b8;margin-bottom:2px">
        <span style="color:#b91c1c">${escapeHtml(e.name)}</span> — ${escapeHtml(e.error.slice(0, 160))}
      </div>`).join('')}
    </div>`;

  return `<div style="max-width:560px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;color:#0f172a">
    <h2 style="font-size:18px;margin:0 0 4px">📈 Signal Desk — ${escapeHtml(content.date)}</h2>
    <p style="color:#64748b;font-size:13px;margin:0 0 20px">What the people you follow said in the last 24 hours.</p>
    ${alerts}
    ${tickers}
    ${items}
    <a href="${appUrl}" style="display:inline-block;background:#2563eb;color:#fff;font-size:14px;font-weight:600;text-decoration:none;padding:9px 16px;border-radius:8px;margin-top:8px">Open the dashboard →</a>
    ${errors}
  </div>`;
}
