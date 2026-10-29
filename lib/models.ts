/**
 * Which Claude model each job uses. Ray asked for "a decent model that's able
 * to give me a good summary and think on a high level", so summaries and the
 * chat run on the current Sonnet; ticker extraction is a narrow structured
 * pull where Haiku is as good and a fraction of the price, so it stays put.
 *
 * Read per call rather than at module load so a deployment can change a model
 * without a rebuild.
 */
export const DEFAULT_SUMMARY_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_CHAT_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_EXTRACT_MODEL = 'claude-haiku-4-5-20251001';

export function summaryModel(): string {
  return process.env.SUMMARY_MODEL?.trim() || DEFAULT_SUMMARY_MODEL;
}

export function chatModel(): string {
  return process.env.CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL;
}

export function extractModel(): string {
  return process.env.EXTRACT_MODEL?.trim() || DEFAULT_EXTRACT_MODEL;
}
