import { describe, it, expect } from 'vitest';
import { itemKind } from '@/lib/item-kind';

describe('itemKind', () => {
  it('labels a Substack channel item as Substack', () => {
    expect(itemKind('Robert Reynolds', 'equinor-update-tight-gas-supply')).toBe('Substack');
  });

  it('labels a YouTube channel item as YouTube', () => {
    expect(itemKind('Meet Kevin', 'dQw4w9WgXcQ')).toBe('YouTube');
  });

  it('labels a pasted item as Pasted, whatever the channel', () => {
    expect(itemKind('Meet Kevin', 'paste-9aa6a629a3dac6fe')).toBe('Pasted');
  });

  it('falls back to YouTube for a channel it does not know', () => {
    expect(itemKind('Someone New', 'abc123')).toBe('YouTube');
  });
});
