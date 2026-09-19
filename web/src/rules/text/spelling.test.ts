import { describe, expect, it } from 'vitest';
import { editDistance, isNearMiss } from '@/rules/text/spelling.ts';

/** The words a typed word is read as typed against, as the airport's data would give them. */
const VOCABULARY: ReadonlySet<string> = new Set([
  'expect',
  'except',
  'right',
  'light',
  'departure',
  'squawk',
]);

/** A typed word, the word the reading has, and whether the one says the other. */
const CASES: readonly [string, string, boolean][] = [
  ['depature', 'departure', true],
  ['depratrue', 'departure', true],
  ['sqawk', 'squawk', true],
  ['maintian', 'maintain', true],
  ['nimtz', 'nimitz', true],
  ['sacremento', 'sacramento', true],
  ['sqwk', 'squawk', false],
  ['the', 'then', false],
  ['lift', 'left', false],
  ['except', 'expect', false],
  ['light', 'right', false],
  ['departure', 'departure', true],
];

describe('editDistance', () => {
  it('counts a substitution, an insertion, a deletion and a swap as one edit each', () => {
    expect(editDistance('left', 'lift')).toBe(1);
    expect(editDistance('sqawk', 'squawk')).toBe(1);
    expect(editDistance('departuree', 'departure')).toBe(1);
    expect(editDistance('maintian', 'maintain')).toBe(1);
  });

  it('counts two swaps as two edits, and an equal word as none', () => {
    expect(editDistance('depratrue', 'departure')).toBe(2);
    expect(editDistance('departure', 'departure')).toBe(0);
  });

  it('counts the whole word where one side is empty', () => {
    expect(editDistance('', 'squawk')).toBe(6);
    expect(editDistance('squawk', '')).toBe(6);
  });
});

describe('isNearMiss', () => {
  it.each(CASES)('reads %s for %s as %s', (typed, expected, says) => {
    expect(isNearMiss(typed, expected, VOCABULARY)).toBe(says);
  });
});
