import type { SourceAlertState } from '@/lib/db';
import { COOKIE_EXPIRED_MARKER, COOKIE_AGEING_MARKER } from '@/lib/substack';

/**
 * Anthropic reports an exhausted balance as a request error rather than
 * anything structured, so the wording is all we have to go on. Kept narrow on
 * purpose: a false alarm here emails two people at 3am.
 */
const CREDIT_PATTERNS: RegExp[] = [
  /credit balance is too low/i,
  /insufficient\s+(?:funds|credit|balance)/i,
  /quota\s+exceeded/i,
  /payment\s+required/i,
  /\b402\b/,
];

export function detectCreditProblem(messages: Array<string | null | undefined>): string | null {
  for (const message of messages) {
    if (!message) continue;
    if (CREDIT_PATTERNS.some(pattern => pattern.test(message))) return message;
  }
  return null;
}

/**
 * Sources that have just started failing: the latest run failed and the one
 * before it did not. A source failing for the third run running is already
 * known about and stays quiet; one that has never run before and fails on its
 * first attempt still counts, since there is nothing to have been told yet.
 */
export function selectNewlyFailing(states: SourceAlertState[]): SourceAlertState[] {
  return states.filter(state => state.latestOk === false && state.previousOk !== false);
}

/** A Substack session that has expired, or is old enough to be about to. */
export function detectCookieProblem(messages: Array<string | null | undefined>): string | null {
  for (const message of messages) {
    if (!message) continue;
    if (message.includes(COOKIE_EXPIRED_MARKER) || message.includes(COOKIE_AGEING_MARKER)) {
      return message;
    }
  }
  return null;
}

export interface AlertDecision {
  newlyFailing: SourceAlertState[];
  creditProblem: string | null;
  cookieProblem: string | null;
  shouldSend: boolean;
}

/**
 * Decide what, if anything, this run is worth emailing about. Both reasons are
 * edge-triggered against the previous run so a persistent problem doesn't send
 * a fresh email every three hours.
 */
export function decideAlerts(states: SourceAlertState[], runErrors: string[]): AlertDecision {
  const newlyFailing = selectNewlyFailing(states);

  const creditNow = detectCreditProblem([
    ...runErrors,
    ...states.map(state => state.latestError),
  ]);
  const creditBefore = detectCreditProblem(states.map(state => state.previousError));
  const creditProblem = creditNow && !creditBefore ? creditNow : null;

  const cookieNow = detectCookieProblem([
    ...runErrors,
    ...states.map(state => state.latestError),
  ]);
  const cookieBefore = detectCookieProblem(states.map(state => state.previousError));
  const cookieProblem = cookieNow && !cookieBefore ? cookieNow : null;

  return {
    newlyFailing,
    creditProblem,
    cookieProblem,
    shouldSend: newlyFailing.length > 0 || creditProblem !== null || cookieProblem !== null,
  };
}

export function alertSubject(decision: AlertDecision): string {
  const parts: string[] = [];
  if (decision.newlyFailing.length === 1) {
    parts.push(`${decision.newlyFailing[0].name} stopped working`);
  } else if (decision.newlyFailing.length > 1) {
    parts.push(`${decision.newlyFailing.length} sources stopped working`);
  }
  if (decision.creditProblem) parts.push('AI credit running low');
  if (decision.cookieProblem) parts.push('Substack session needs refreshing');
  return `⚠️ ${parts.join(' · ')} — Stock Signals`;
}
