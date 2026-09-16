import { describe, expect, it } from 'vitest';
import type { Grade } from '@/rules/types.ts';
import { scoreLine, verdictLines } from '@/ui/results.ts';

const wrongRoute: Grade = {
  element: 'R.route',
  verdict: 'wrong',
  expectedLabel: 'DEDHD transition',
  actualLabel: 'radar vectors RBL',
  citations: [],
};

const rightRoute: Grade = {
  ...wrongRoute,
  verdict: 'correct',
  actualLabel: 'DEDHD transition',
};

/** The expect clause spoken where the SID chart already publishes it: allowed, but longer. */
const redundantExpect: Grade = {
  element: 'A.expect',
  verdict: 'acceptable',
  expectedLabel: 'no expect altitude',
  actualLabel: 'expect filed altitude 10 minutes after departure',
  citations: [],
};

describe('verdictLines', () => {
  it('marks a correct element and offers no correction', () => {
    const lines = verdictLines(rightRoute);
    expect(lines.answer).toBe('you said: DEDHD transition');
    expect(lines.verdict).toBe('correct');
    expect(lines.correction).toBeUndefined();
  });

  it('corrects a wrong element with the clearance label', () => {
    const lines = verdictLines(wrongRoute);
    expect(lines.answer).toBe('you said: radar vectors RBL');
    expect(lines.verdict).toBe('wrong');
    expect(lines.correction).toBe('correction: DEDHD transition');
  });

  it('offers the shorter reading for an acceptable element rather than a correction', () => {
    const lines = verdictLines(redundantExpect);
    expect(lines.answer).toBe('you said: expect filed altitude 10 minutes after departure');
    expect(lines.verdict).toBe('acceptable');
    expect(lines.correction).toBe('shorter: no expect altitude');
  });
});

describe('scoreLine', () => {
  it('counts the correct elements of the whole clearance', () => {
    const grades: Grade[] = [
      rightRoute,
      { ...rightRoute, element: 'A.phrase' },
      { ...wrongRoute, element: 'F' },
    ];
    expect(scoreLine(grades, 'elements')).toBe('2 of 3 elements correct');
  });

  it('counts an acceptable element as correct and says how many were inefficient', () => {
    const grades: Grade[] = [rightRoute, { ...rightRoute, element: 'A.phrase' }, redundantExpect];
    expect(scoreLine(grades, 'elements')).toBe(
      '3 of 3 elements correct, 1 acceptable but inefficient',
    );
  });

  it('counts the boxes of the strip under their own noun', () => {
    const grades: Grade[] = [
      { ...rightRoute, element: 'BOX.type' },
      { ...wrongRoute, element: 'BOX.altitude' },
      { ...rightRoute, element: 'BOX.route' },
    ];
    expect(scoreLine(grades, 'boxes')).toBe('2 of 3 boxes correct');
  });
});
