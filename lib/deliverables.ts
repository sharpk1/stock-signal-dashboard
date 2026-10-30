import type { Client } from '@libsql/client';

// Phase sign-off checklist. Rows are copied in from the ticket queue by
// scripts/sync-deliverables.ts; Ray ticks each one off on /signoff.

export type DeliverableStatus = 'not_started' | 'in_progress' | 'delivered';

export interface Deliverable {
  code: string;        // "A1", "B10" — the scope document's numbering
  phase: string;       // "Phase 1"
  part: string;        // "A" | "B"
  title: string;
  doneWhen: string;
  ticketId: string | null;
  status: DeliverableStatus;
  waitingOn: string | null;   // Ray's next step when the ticket is blocked on him
  signedOffBy: string | null;
  signedOffAt: string | null;
  sortOrder: number;
}

export interface DeliverableInput {
  code: string;
  phase: string;
  title: string;
  doneWhen: string;
  ticketId: string | null;
  status: DeliverableStatus;
  waitingOn: string | null;
}

export async function initDeliverables(db: Client): Promise<void> {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS deliverables (
      code          TEXT PRIMARY KEY,
      phase         TEXT NOT NULL,
      title         TEXT NOT NULL,
      done_when     TEXT NOT NULL,
      ticket_id     TEXT,
      status        TEXT NOT NULL DEFAULT 'not_started'
                    CHECK(status IN ('not_started','in_progress','delivered')),
      signed_off_by TEXT,
      signed_off_at TEXT,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS signoff_events (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      code             TEXT NOT NULL,
      action           TEXT NOT NULL CHECK(action IN ('signed','unsigned')),
      name             TEXT NOT NULL,
      at               TEXT NOT NULL DEFAULT (datetime('now')),
      ticket_commented INTEGER NOT NULL DEFAULT 0
    );
  `);
  try {
    await db.execute('ALTER TABLE deliverables ADD COLUMN waiting_on TEXT');
  } catch {
    /* column already exists */
  }
}

// "A1" -> part "A", order 1; "B10" -> part "B", order 110.
export function parseCode(code: string): { part: string; sortOrder: number } {
  const m = /^([A-Z])(\d+)$/.exec(code);
  if (!m) return { part: '?', sortOrder: 9999 };
  return { part: m[1], sortOrder: (m[1].charCodeAt(0) - 65) * 100 + Number(m[2]) };
}

// Insert or refresh a deliverable from its ticket. Never touches sign-off fields.
export async function upsertDeliverable(db: Client, d: DeliverableInput): Promise<void> {
  await db.execute({
    sql: `
      INSERT INTO deliverables (code, phase, title, done_when, ticket_id, status, waiting_on)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        phase = excluded.phase,
        title = excluded.title,
        done_when = excluded.done_when,
        ticket_id = excluded.ticket_id,
        status = excluded.status,
        waiting_on = excluded.waiting_on,
        updated_at = datetime('now')
    `,
    args: [d.code, d.phase, d.title, d.doneWhen, d.ticketId, d.status, d.waitingOn],
  });
}

export async function listDeliverables(db: Client, phase = 'Phase 1'): Promise<Deliverable[]> {
  const rows = (await db.execute({
    sql: `SELECT code, phase, title, done_when, ticket_id, status, waiting_on, signed_off_by, signed_off_at
          FROM deliverables WHERE phase = ?`,
    args: [phase],
  })).rows as unknown as {
    code: string; phase: string; title: string; done_when: string; ticket_id: string | null;
    status: DeliverableStatus; waiting_on: string | null; signed_off_by: string | null; signed_off_at: string | null;
  }[];

  return rows
    .map(r => ({
      code: r.code,
      phase: r.phase,
      title: r.title,
      doneWhen: r.done_when,
      ticketId: r.ticket_id,
      status: r.status,
      waitingOn: r.waiting_on ?? null,
      signedOffBy: r.signed_off_by,
      signedOffAt: r.signed_off_at,
      ...parseCode(r.code),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export class SignOffError extends Error {}

// Only a delivered item can be signed off. Every sign and unsign is kept in
// signoff_events, so a sign-off can't disappear without a record.
export async function setSignOff(db: Client, code: string, name: string, signed: boolean): Promise<void> {
  const row = (await db.execute({ sql: 'SELECT status FROM deliverables WHERE code = ?', args: [code] })).rows[0] as unknown as
    { status: DeliverableStatus } | undefined;
  if (!row) throw new SignOffError(`Unknown deliverable ${code}`);
  if (signed && row.status !== 'delivered') throw new SignOffError(`${code} hasn't been delivered yet`);

  await db.execute(signed
    ? { sql: `UPDATE deliverables SET signed_off_by = ?, signed_off_at = datetime('now') WHERE code = ?`, args: [name, code] }
    : { sql: 'UPDATE deliverables SET signed_off_by = NULL, signed_off_at = NULL WHERE code = ?', args: [code] });
  await db.execute({
    sql: 'INSERT INTO signoff_events (code, action, name) VALUES (?, ?, ?)',
    args: [code, signed ? 'signed' : 'unsigned', name],
  });
}

export interface SignOffEvent { id: number; code: string; action: 'signed' | 'unsigned'; name: string; at: string; ticketId: string | null }

export async function pendingTicketComments(db: Client): Promise<SignOffEvent[]> {
  return (await db.execute(`
    SELECT e.id, e.code, e.action, e.name, e.at, d.ticket_id AS ticketId
    FROM signoff_events e LEFT JOIN deliverables d ON d.code = e.code
    WHERE e.ticket_commented = 0 ORDER BY e.id
  `)).rows as unknown as SignOffEvent[];
}

export async function markTicketCommented(db: Client, id: number): Promise<void> {
  await db.execute({ sql: 'UPDATE signoff_events SET ticket_commented = 1 WHERE id = ?', args: [id] });
}
