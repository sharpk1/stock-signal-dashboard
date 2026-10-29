import { NextResponse } from 'next/server';
import { getDb, saveChannel, getDisabledChannelIds, setChannelEnabled } from '@/lib/db';
import { CHANNELS } from '@/lib/channels';

export interface ChannelToggle {
  channelId: string;
  name: string;
  handle: string;
  enabled: boolean;
}

// GET — every configured channel with its on/off state. CHANNELS is the source
// of truth for which channels exist; the database only records which are off,
// so a channel the pipeline hasn't saved a row for yet still reads as on.
export async function GET() {
  const db = await getDb();
  const disabled = await getDisabledChannelIds(db);
  const channels: ChannelToggle[] = CHANNELS.map(ch => ({
    channelId: ch.channelId,
    name: ch.name,
    handle: ch.handle,
    enabled: !disabled.has(ch.channelId),
  }));
  return NextResponse.json(channels);
}

// PATCH { channelId, enabled } — switch one channel on or off. Takes an explicit
// state rather than flipping, so two quick clicks can't leave the UI and the
// database disagreeing.
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({})) as { channelId?: string; enabled?: boolean };
  const channelId = body.channelId?.trim();
  if (!channelId) {
    return NextResponse.json({ error: 'channelId is required' }, { status: 400 });
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be true or false' }, { status: 400 });
  }
  const channel = CHANNELS.find(ch => ch.channelId === channelId);
  if (!channel) {
    return NextResponse.json({ error: `unknown channel: ${channelId}` }, { status: 404 });
  }

  const db = await getDb();
  // The row may not exist yet on a database that has never run a fetch.
  await saveChannel(db, channel);
  await setChannelEnabled(db, channelId, body.enabled);
  return NextResponse.json({ channelId, enabled: body.enabled });
}
