import { describe, expect, it } from 'vitest';
import type { Grade } from '@/rules/types.ts';
import { scoreLine, verdictLines } from '@/ui/results.ts';

const wrongRoute: Grade = {
  element: 'R.route',
  ok: false,
  expectedLabel: 'DEDHD transition',
  actualLabel: 'radar vectors RBL',
  citations: [],
};

const rightRoute: Grade = { ...wrongRoute, ok: true, actualLabel: 'DEDHD transition' };

describe('verdictLines', () => {
  it('marks a correct element and offers no correction', () => {
    const lines = verdictLines(rightRoute);
    expect(lines.answer).toBe('you said: DEDHD transition');
    expect(lines.correct).toBe(true);
    expect(lines.correction).toBeUndefined();
  });

  it('corrects a wrong element with the clearance label', () => {
    const lines = verdictLines(wrongRoute);
    expect(lines.answer).toBe('you said: radar vectors RBL');
    expect(lines.correct).toBe(false);
    expect(lines.correction).toBe('correction: DEDHD transition');
  });
});

describe('scoreLine', () => {
  it('counts the correct elements of the whole clearance', () => {
    const grades: Grade[] = [
      rightRoute,
      { ...rightRoute, element: 'A.phrase' },
      { ...wrongRoute, element: 'F' },
    ];
    expect(scoreLine(grades)).toBe('2 of 3 elements correct');
  });
});
