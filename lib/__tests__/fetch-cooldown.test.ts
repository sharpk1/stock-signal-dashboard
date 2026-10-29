import { describe, it, expect } from 'vitest';
import { cooldownMinutesLeft } from '@/lib/fetch-cooldown';

const NOW = Date.parse('2026-10-29T19:42:00Z');

describe('cooldownMinutesLeft', () => {
  it('allows a fetch when nothing has ever run', () => {
    expect(cooldownMinutesLeft(null, NOW)).toBe(0);
  });

  it('blocks a fetch inside the window and rounds the wait up', () => {
    expect(cooldownMinutesLeft('2026-10-29 19:38:30', NOW)).toBe(7);
  });

  it('allows a fetch once the window has passed', () => {
    expect(cooldownMinutesLeft('2026-10-29 19:31:59', NOW)).toBe(0);
  });

  it('reads the SQLite timestamp as UTC, not local time', () => {
    expect(cooldownMinutesLeft('2026-10-29 19:41:00', NOW)).toBe(9);
  });

  it('does not block on a timestamp it cannot parse', () => {
    expect(cooldownMinutesLeft('not a date', NOW)).toBe(0);
  });
});
