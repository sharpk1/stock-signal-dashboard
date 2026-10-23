// Copies Phase 1 tickets from Kush's ticket queue into the dashboard's
// deliverables table, then posts any new sign-offs back to the tickets.
//
// Runs on Kush's Mac only: it shells out to the `ticket` CLI, so the ticket
// database's credentials never reach this project.
//
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx scripts/sync-deliverables.ts
//   (add --dry-run to print what would change)
import { execFileSync } from 'child_process';
import { getDb } from '@/lib/db';
import { upsertDeliverable, pendingTicketComments, markTicketCommented, type DeliverableStatus } from '@/lib/deliverables';

const PROJECT = 'Ray Dashboard — Projects System';
const EPIC = 'Phase 1';
const STATES = ['backlog', 'ready', 'building', 'blocked', 'review', 'done'];
const dryRun = process.argv.includes('--dry-run');

function ticket(...args: string[]): string {
  return execFileSync('ticket', args, { encoding: 'utf8' });
}

export function toStatus(state: string): DeliverableStatus {
  if (state === 'done') return 'delivered';
  if (state === 'building' || state === 'review' || state === 'blocked') return 'in_progress';
  return 'not_started';
}

// "RAY-2     backlog   High    A1 · AI analysis restored…  [Ray Dashboard — Projects System]"
export function parseListLine(line: string): { id: string; state: string; code: string; title: string } | null {
  const m = /^(\S+)\s+(\S+)\s+\S*\s+([A-Z]\d+) · (.+?)\s{2}\[/.exec(line);
  return m ? { id: m[1], state: m[2], code: m[3], title: m[4] } : null;
}

export function parseShow(text: string): { epic: string | null; doneWhen: string } {
  const epic = /^epic: (.+?) · /m.exec(text)?.[1] ?? null;
  const doneWhen = /\*\*Done when:\*\*\s*(.+)/.exec(text)?.[1].trim() ?? '';
  return { epic: epic === '-' ? null : epic, doneWhen };
}

async function main() {
  const db = await getDb();

  const rows = STATES.flatMap(state =>
    ticket('list', '--project', PROJECT, '--state', state, '--limit', '200')
      .split('\n').map(parseListLine).filter(r => r !== null));

  let synced = 0;
  for (const r of rows) {
    const { epic, doneWhen } = parseShow(ticket('show', r.id));
    if (epic !== EPIC) continue;
    const d = { code: r.code, phase: EPIC, title: r.title, doneWhen, ticketId: r.id, status: toStatus(r.state) };
    console.log(`${d.code.padEnd(4)} ${r.id.padEnd(7)} ${d.status.padEnd(12)} ${d.title}`);
    if (!dryRun) await upsertDeliverable(db, d);
    synced++;
  }
  console.log(`${dryRun ? 'Would sync' : 'Synced'} ${synced} deliverables.`);

  for (const e of await pendingTicketComments(db)) {
    if (!e.ticketId) continue;
    const text = e.action === 'signed'
      ? `Signed off on the dashboard by ${e.name} (${e.at} UTC).`
      : `Sign-off withdrawn on the dashboard by ${e.name} (${e.at} UTC).`;
    console.log(`${e.ticketId}: ${text}`);
    if (!dryRun) {
      ticket('comment', e.ticketId, text);
      await markTicketCommented(db, e.id);
    }
  }
}

if (process.argv[1]?.includes('sync-deliverables')) {
  main().catch(err => { console.error(err); process.exit(1); });
}
