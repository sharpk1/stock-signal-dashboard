import { NextResponse } from 'next/server';
import { getDb, getAlerts } from '@/lib/db';

export async function GET() {
  const db = await getDb();
  return NextResponse.json(await getAlerts(db));
}
