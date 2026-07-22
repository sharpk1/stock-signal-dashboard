import { NextResponse } from 'next/server';
import { getDb, getAlerts } from '@/lib/db';

export async function GET() {
  const db = getDb();
  return NextResponse.json(getAlerts(db));
}
