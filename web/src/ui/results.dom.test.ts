// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { TextGrade } from '@/rules/text/grade.ts';
import { renderVerdict } from '@/ui/results.ts';

/** A typed altitude with filler in it: acceptable, and read against the words expected. */
const typedAltitude: TextGrade = {
  element: 'A.phrase',
  verdict: 'acceptable',
  expectedLabel: 'climb via sid',
  actualLabel: 'Climb via the SID',
  citations: [],
  said: [
    { text: 'Climb via ', kind: 'said' },
    { text: 'the', kind: 'filler' },
    { text: ' SID', kind: 'said' },
  ],
};

const typedCorrect: TextGrade = {
  ...typedAltitude,
  verdict: 'correct',
  actualLabel: 'Climb via SID',
  said: [{ text: 'Climb via SID', kind: 'said' }],
};

function partOf(row: HTMLElement, selector: string): Element {
  const found = row.querySelector(selector);
  if (found === null) throw new Error(`the row has no ${selector}`);
  return found;
}

describe('renderVerdict on a typed element', () => {
  it('marks the filler inside the said line', () => {
    const answer = partOf(renderVerdict(typedAltitude), '.answer');
    expect(answer.textContent).toBe('you said: Climb via the SID✓');
    const filler = answer.querySelectorAll('.filler');
    expect(filler).toHaveLength(1);
    expect(filler[0]?.textContent).toBe('the');
  });

  it('shows the expected words on an acceptable row', () => {
    expect(partOf(renderVerdict(typedAltitude), '.expected').textContent).toBe(
      'expected: climb via sid',
    );
  });

  it('shows no expected words on a correct row', () => {
    const row = renderVerdict(typedCorrect);
    expect(row.querySelector('.expected')).toBeNull();
    expect(partOf(row, '.answer').textContent).toBe('you said: Climb via SID✓');
  });
});
