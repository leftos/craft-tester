import { describe, expect, it } from 'vitest';
import type { DiffRun } from '@/ui/wordDiff.ts';
import { diffWords } from '@/ui/wordDiff.ts';

/** Every pair of labels these tests read, so the runs of each can be joined back to it. */
const PAIRS: readonly { said: string; expected: string }[] = [
  { said: 'climb via SID', expected: 'climb via SID except maintain 7,000' },
  { said: 'maintain 5,000', expected: 'maintain 3,000' },
  { said: 'Oakland Six departure', expected: 'Nimitz Six departure' },
  { said: '(no prefix)', expected: 'climb via SID' },
  { said: 'Departure frequency 120.9', expected: 'departure frequency 120.9' },
];

/** The runs as their text, a marked one in brackets, which is how a row reads at a glance. */
function shown(runs: readonly DiffRun[]): string[] {
  return runs.map((run) => (run.differs ? `[${run.text}]` : run.text));
}

describe('diffWords', () => {
  it('marks the words one label adds to the other', () => {
    const diff = diffWords('climb via SID', 'climb via SID except maintain 7,000');
    expect(shown(diff.said)).toEqual(['climb via SID']);
    expect(shown(diff.expected)).toEqual(['climb via SID ', '[except maintain 7,000]']);
  });

  it('marks the one word that differs on each side', () => {
    const diff = diffWords('maintain 5,000', 'maintain 3,000');
    expect(shown(diff.said)).toEqual(['maintain ', '[5,000]']);
    expect(shown(diff.expected)).toEqual(['maintain ', '[3,000]']);
  });

  it('leaves the whitespace after a marked word out of the mark', () => {
    const diff = diffWords('Oakland Six departure', 'Nimitz Six departure');
    expect(shown(diff.said)).toEqual(['[Oakland]', ' Six departure']);
    expect(shown(diff.expected)).toEqual(['[Nimitz]', ' Six departure']);
  });

  it('marks nothing where the two labels share no word', () => {
    const diff = diffWords('(no prefix)', 'climb via SID');
    expect(shown(diff.said)).toEqual(['(no prefix)']);
    expect(shown(diff.expected)).toEqual(['climb via SID']);
  });

  it('marks nothing where the two labels differ only in their capitals', () => {
    const diff = diffWords('Departure frequency 120.9', 'departure frequency 120.9');
    expect(shown(diff.said)).toEqual(['Departure frequency 120.9']);
    expect(shown(diff.expected)).toEqual(['departure frequency 120.9']);
  });

  it('runs join back to the label', () => {
    for (const { said, expected } of PAIRS) {
      const diff = diffWords(said, expected);
      expect(diff.said.map((run) => run.text).join('')).toBe(said);
      expect(diff.expected.map((run) => run.text).join('')).toBe(expected);
    }
  });
});
