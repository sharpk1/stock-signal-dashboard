import Anthropic from '@anthropic-ai/sdk';
import { getDb, getMonthSpend, recordAiSpend } from '@/lib/db';
import { BudgetReachedError, budgetReached, monthKey, monthlyBudgetUsd, type BudgetStatus } from '@/lib/budget';
import { recordUsage, chargeableCostUsd } from '@/lib/usage';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** What a call was for, stored with its spend. */
export type AiPurpose = 'summary' | 'extraction' | 'chat';

/** This month's estimated spend against the cap. */
export async function getBudgetStatus(now: Date = new Date()): Promise<BudgetStatus> {
  const month = monthKey(now);
  const capUsd = monthlyBudgetUsd();
  const { spentUsd, calls } = await getMonthSpend(await getDb(), month);
  return { month, spentUsd, capUsd, calls, reached: budgetReached(spentUsd, capUsd) };
}

/**
 * Every Claude call in the app goes through here: refuse once the month's cap
 * is reached, otherwise make the call and log what it cost — to the run's tally
 * and to ai_spend, which is what the cap is measured against.
 *
 * The check is per call, not per run, so a long stream that is several calls
 * deep stops at the cap rather than finishing on the far side of it. A call
 * that starts just under the cap can still take spend slightly past it.
 */
export async function callClaude(
  purpose: AiPurpose,
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  const budget = await getBudgetStatus();
  if (budget.reached) throw new BudgetReachedError(budget.spentUsd, budget.capUsd);

  const message = await client.messages.create(params);
  const { input_tokens: inputTokens, output_tokens: outputTokens } = message.usage;
  recordUsage(params.model, inputTokens, outputTokens);
  try {
    await recordAiSpend(await getDb(), {
      month: monthKey(),
      purpose,
      model: params.model,
      inputTokens,
      outputTokens,
      costUsd: chargeableCostUsd(params.model, inputTokens, outputTokens),
    });
  } catch (err) {
    // The call has already been paid for; losing its row undercounts the cap,
    // but failing the summary over it would waste the spend as well.
    console.error('[claude] could not record spend:', err instanceof Error ? err.message : err);
  }
  return message;
}
