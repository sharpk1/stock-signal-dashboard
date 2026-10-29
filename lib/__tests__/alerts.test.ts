import { describe, it, expect } from 'vitest';
import { detectCreditProblem, selectNewlyFailing, decideAlerts, alertSubject } from '@/lib/alerts';
import type { SourceAlertState } from '@/lib/db';

function state(over: Partial<SourceAlertState> = {}): SourceAlertState {
  return {
    channelId: 'UC123',
    name: 'Test Channel',
    latestOk: true,
    latestError: null,
    previousOk: true,
    previousError: null,
    ...over,
  };
}

describe('detectCreditProblem', () => {
  it('spots an exhausted Anthropic balance', () => {
    const msg = 'Claude extraction failed — Your credit balance is too low to access the Anthropic API';
    expect(detectCreditProblem([msg])).toBe(msg);
  });

  it('spots quota and payment wording', () => {
    expect(detectCreditProblem(['quota exceeded for this org'])).not.toBeNull();
    expect(detectCreditProblem(['HTTP 402 Payment Required'])).not.toBeNull();
  });

  it('ignores ordinary fetch failures', () => {
    expect(detectCreditProblem([
      'Meet Kevin: fetch failed — fetch failed',
      'Royce Jakob: transcript unavailable — no transcript',
    ])).toBeNull();
  });

  it('ignores empty and missing messages', () => {
    expect(detectCreditProblem([null, undefined, ''])).toBeNull();
  });
});

describe('selectNewlyFailing', () => {
  it('reports a source that has just broken', () => {
    const sources = selectNewlyFailing([state({ latestOk: false, previousOk: true })]);
    expect(sources).toHaveLength(1);
  });

  it('stays quiet about a source that was already broken', () => {
    expect(selectNewlyFailing([state({ latestOk: false, previousOk: false })])).toHaveLength(0);
  });

  it('reports a source that failed on its very first run', () => {
    expect(selectNewlyFailing([state({ latestOk: false, previousOk: null })])).toHaveLength(1);
  });

  it('stays quiet about a healthy source', () => {
    expect(selectNewlyFailing([state({ latestOk: true, previousOk: false })])).toHaveLength(0);
  });

  it('stays quiet about a source that has never run', () => {
    expect(selectNewlyFailing([state({ latestOk: null, previousOk: null })])).toHaveLength(0);
  });
});

describe('decideAlerts', () => {
  it('sends nothing when everything is healthy', () => {
    const decision = decideAlerts([state()], []);
    expect(decision.shouldSend).toBe(false);
  });

  it('sends when a source has just broken', () => {
    const decision = decideAlerts([state({ latestOk: false, latestError: 'fetch failed', previousOk: true })], []);
    expect(decision.shouldSend).toBe(true);
    expect(decision.newlyFailing).toHaveLength(1);
  });

  it('sends when credit runs out', () => {
    const decision = decideAlerts([state()], ['Claude extraction failed — credit balance is too low']);
    expect(decision.shouldSend).toBe(true);
    expect(decision.creditProblem).toContain('credit balance is too low');
  });

  it('does not repeat a credit warning the previous run already raised', () => {
    const decision = decideAlerts(
      [state({ previousError: 'credit balance is too low' })],
      ['Claude extraction failed — credit balance is too low'],
    );
    expect(decision.creditProblem).toBeNull();
    expect(decision.shouldSend).toBe(false);
  });

  it('does not email every run while a source stays broken', () => {
    const decision = decideAlerts([state({ latestOk: false, previousOk: false })], ['still broken']);
    expect(decision.shouldSend).toBe(false);
  });

  it('reports both reasons at once', () => {
    const decision = decideAlerts(
      [state({ latestOk: false, latestError: 'fetch failed', previousOk: true })],
      ['credit balance is too low'],
    );
    expect(decision.newlyFailing).toHaveLength(1);
    expect(decision.creditProblem).not.toBeNull();
  });
});

describe('alertSubject', () => {
  it('names a single broken source', () => {
    const decision = decideAlerts([state({ name: 'Meet Kevin', latestOk: false, previousOk: true })], []);
    expect(alertSubject(decision)).toContain('Meet Kevin stopped working');
  });

  it('counts several broken sources', () => {
    const decision = decideAlerts([
      state({ channelId: 'a', latestOk: false, previousOk: true }),
      state({ channelId: 'b', latestOk: false, previousOk: true }),
    ], []);
    expect(alertSubject(decision)).toContain('2 sources stopped working');
  });

  it('mentions credit', () => {
    const decision = decideAlerts([state()], ['credit balance is too low']);
    expect(alertSubject(decision)).toContain('AI credit running low');
  });
});
