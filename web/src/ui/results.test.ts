import { describe, expect, it } from 'vitest';
import type { Grade } from '@/rules/types.ts';
import { scoreLine, verdictLines } from '@/ui/results.ts';

const wrongSid: Grade = {
  element: 'R.sid',
  ok: false,
  expectedLabel: 'TRUKN TWO (RNAV)',
  actualLabel: 'no SID',
  citations: [],
};

const rightSid: Grade = { ...wrongSid, ok: true, actualLabel: 'TRUKN TWO (RNAV)' };

describe('verdictLines', () => {
  it('marks a correct element and offers no correction', () => {
    const lines = verdictLines(rightSid);
    expect(lines.answer).toBe('you said: TRUKN TWO (RNAV)');
    expect(lines.correct).toBe(true);
    expect(lines.correction).toBeUndefined();
  });

  it('corrects a wrong element with the clearance label', () => {
    const lines = verdictLines(wrongSid);
    expect(lines.answer).toBe('you said: no SID');
    expect(lines.correct).toBe(false);
    expect(lines.correction).toBe('correction: TRUKN TWO (RNAV)');
  });
});

describe('scoreLine', () => {
  it('counts the correct elements of the whole clearance', () => {
    const grades: Grade[] = [
      rightSid,
      { ...rightSid, element: 'R.route' },
      { ...wrongSid, element: 'F' },
    ];
    expect(scoreLine(grades)).toBe('2 of 3 elements correct');
  });
});
