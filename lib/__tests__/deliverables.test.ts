import { describe, it, expect } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { initDb } from '@/lib/db';
import { upsertDeliverable, listDeliverables, setSignOff, pendingTicketComments, markTicketCommented, parseCode, SignOffError } from '@/lib/deliverables';
import { parseListLine, parseShow, toStatus } from '@/scripts/sync-deliverables';

async function makeTestDb(): Promise<Client> {
  const db = createClient({ url: ':memory:' });
  await initDb(db);
  return db;
}

const base = { phase: 'Phase 1', doneWhen: 'It works', ticketId: 'RAY-2' };

describe('deliverables', () => {
  it('sorts A before B and B2 before B10', async () => {
    const db = await makeTestDb();
    for (const code of ['B10', 'A1', 'B2']) await upsertDeliverable(db, { ...base, code, title: code, status: 'not_started' });
    expect((await listDeliverables(db)).map(d => d.code)).toEqual(['A1', 'B2', 'B10']);
    expect(parseCode('B10')).toEqual({ part: 'B', sortOrder: 110 });
  });

  it('refuses to sign off an item that is not delivered', async () => {
    const db = await makeTestDb();
    await upsertDeliverable(db, { ...base, code: 'A1', title: 'x', status: 'in_progress' });
    await expect(setSignOff(db, 'A1', 'Raymond', true)).rejects.toBeInstanceOf(SignOffError);
    await expect(setSignOff(db, 'Z9', 'Raymond', true)).rejects.toBeInstanceOf(SignOffError);
  });

  it('signs off, keeps the sign-off when the ticket re-syncs, and logs every change', async () => {
    const db = await makeTestDb();
    await upsertDeliverable(db, { ...base, code: 'A1', title: 'x', status: 'delivered' });
    await setSignOff(db, 'A1', 'Raymond', true);
    await upsertDeliverable(db, { ...base, code: 'A1', title: 'renamed', status: 'delivered' });

    const [d] = await listDeliverables(db);
    expect(d.title).toBe('renamed');
    expect(d.signedOffBy).toBe('Raymond');
    expect(d.signedOffAt).toBeTruthy();

    await setSignOff(db, 'A1', 'Raymond', false);
    expect((await listDeliverables(db))[0].signedOffAt).toBeNull();

    const events = await pendingTicketComments(db);
    expect(events.map(e => e.action)).toEqual(['signed', 'unsigned']);
    expect(events[0].ticketId).toBe('RAY-2');
    await markTicketCommented(db, events[0].id);
    expect(await pendingTicketComments(db)).toHaveLength(1);
  });
});

describe('sync parsing', () => {
  it('parses ticket list lines', () => {
    expect(parseListLine('RAY-19    done      High    B10 · Filters and search  [Ray Dashboard — Projects System]'))
      .toEqual({ id: 'RAY-19', state: 'done', code: 'B10', title: 'Filters and search' });
    expect(parseListLine('RAY-1     backlog   High    Fix daily digest email  [Ray Dashboard — Projects System]')).toBeNull();
  });

  it('parses epic and done-when from ticket show', () => {
    const text = 'RAY-2 ...\nepic: Phase 1 · kind: build · labels: ray · PR: -\n\nBody\n\n**Done when:** New items show summaries.\n';
    expect(parseShow(text)).toEqual({ epic: 'Phase 1', doneWhen: 'New items show summaries.' });
  });

  it('maps ticket states to deliverable status', () => {
    expect(toStatus('done')).toBe('delivered');
    expect(toStatus('review')).toBe('in_progress');
    expect(toStatus('ready')).toBe('not_started');
  });
});
