import { NextResponse } from 'next/server';
import { getBudgetStatus } from '@/lib/claude';

export type { BudgetStatus } from '@/lib/budget';

// GET — this month's estimated AI spend against the monthly cap (A1).
export async function GET() {
  return NextResponse.json(await getBudgetStatus());
}
