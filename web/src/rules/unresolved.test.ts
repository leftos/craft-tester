import { describe, expect, it } from 'vitest';
import { isUnresolved, unresolved } from '@/rules/unresolved.ts';

describe('unresolved', () => {
  it('carries the element and the reason', () => {
    expect(unresolved('R.sid', 'no rule applies')).toEqual({
      element: 'R.sid',
      reason: 'no rule applies',
    });
  });
});

describe('isUnresolved', () => {
  it('recognises a failed step', () => {
    expect(isUnresolved(unresolved('A.phrase', 'no altitude rule'))).toBe(true);
  });

  it('leaves a resolved value alone', () => {
    expect(isUnresolved({ value: '120.9', citations: [] })).toBe(false);
  });

  it('does not mistake a value that carries only one of the two fields', () => {
    expect(isUnresolved({ element: 'F' } as unknown as { element: string })).toBe(false);
  });
});
