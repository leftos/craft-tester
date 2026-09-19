// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { BoxElementGrade } from '@/rules/amend/grade.ts';
import type { TextGrade } from '@/rules/text/grade.ts';
import type { Grade } from '@/rules/types.ts';
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
  expected: [{ text: 'climb via sid', missed: false }],
  remarks: ['extra words: the'],
};

const typedCorrect: TextGrade = {
  ...typedAltitude,
  verdict: 'correct',
  actualLabel: 'Climb via SID',
  said: [{ text: 'Climb via SID', kind: 'said' }],
  remarks: [],
};

/** A typed procedure whose second word was never said, as the runs of a wrong element mark it. */
const typedMissedWord: TextGrade = {
  element: 'R.sid',
  verdict: 'wrong',
  expectedLabel: 'Oakland Six departure',
  actualLabel: 'Oakland Six',
  citations: [],
  said: [{ text: 'Oakland Six', kind: 'said' }],
  expected: [
    { text: 'Oakland Six ', missed: false },
    { text: 'departure', missed: true },
  ],
  remarks: ['missed: "departure"'],
};

/** A typed squawk with another value said for it: the value marked, and the miss said in words. */
const typedWrongValue: TextGrade = {
  element: 'T',
  verdict: 'wrong',
  expectedLabel: 'squawk three three four two',
  actualLabel: 'squawk 6201',
  citations: [],
  said: [
    { text: 'squawk ', kind: 'said' },
    { text: '6201', kind: 'wrong' },
  ],
  expected: [
    { text: 'squawk ', missed: false },
    { text: 'three three four two', missed: true },
  ],
  remarks: ['wrong value: said "6201", expected "three three four two"'],
};

/** A typed procedure whose last word is a letter away from the reading: right, and marked lightly. */
const typedSpelling: TextGrade = {
  element: 'R.sid',
  verdict: 'correct',
  expectedLabel: 'Oakland Six departure',
  actualLabel: 'Oakland Six depature',
  citations: [],
  said: [
    { text: 'Oakland Six ', kind: 'said' },
    { text: 'depature', kind: 'spelling', readAs: 'departure' },
  ],
  expected: [{ text: 'Oakland Six departure', missed: false }],
  remarks: [],
};

/** A typed squawk said whole, but before the clearance limit. */
const typedMisplaced: TextGrade = {
  element: 'T',
  verdict: 'wrong',
  expectedLabel: 'squawk three three four two',
  actualLabel: 'squawk three three four two',
  citations: [],
  said: [{ text: 'squawk three three four two', kind: 'misplaced' }],
  expected: [{ text: 'squawk three three four two', missed: false }],
  remarks: ['out of CRAFT order'],
};

/** A picked altitude one word away from the clearance the engine resolved. */
const pickedAltitude: Grade = {
  element: 'A.phrase',
  verdict: 'wrong',
  expectedLabel: 'maintain 3,000',
  actualLabel: 'maintain 5,000',
  citations: [],
};

/** A box of the strip left as filed where the engine amended it, which marks no words at all. */
const wrongBox: BoxElementGrade = {
  element: 'BOX.altitude',
  verdict: 'wrong',
  expectedLabel: 'FL270',
  actualLabel: 'correct as filed',
  citations: [],
  reason: 'the altitude is wrong for direction of flight',
};

function partOf(row: Element, selector: string): Element {
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

  it('marks the words never said inside the expected line', () => {
    const expected = partOf(renderVerdict(typedMissedWord), 'p.expected');
    expect(expected.textContent).toBe('expected: Oakland Six departure');
    const missed = expected.querySelectorAll('strong.missed');
    expect(missed).toHaveLength(1);
    expect(missed[0]?.textContent).toBe('departure');
  });

  it('a typed row marks a wrong value and says so', () => {
    const row = renderVerdict(typedWrongValue);
    const wrong = row.querySelectorAll('.answer .wrong');
    expect(wrong).toHaveLength(1);
    expect(wrong[0]?.textContent).toBe('6201');
    expect(wrong[0]?.getAttribute('title')).toBe('not what the reading has');
    expect(partOf(row, 'p.remarks').textContent).toBe(
      'wrong value: said "6201", expected "three three four two"',
    );
  });

  it('a near-miss spelling is dotted and titled', () => {
    const row = renderVerdict(typedSpelling);
    const spelling = partOf(row, '.answer .spelling');
    expect(spelling.textContent).toBe('depature');
    expect(spelling.getAttribute('title')).toBe('read as "departure"');
    expect(row.querySelector('p.remarks')).toBeNull();
  });

  it('an out-of-order element is marked misplaced', () => {
    const row = renderVerdict(typedMisplaced);
    const misplaced = partOf(row, '.answer .misplaced');
    expect(misplaced.textContent).toBe('squawk three three four two');
    expect(misplaced.getAttribute('title')).toBe('out of CRAFT order');
    expect(partOf(row, 'p.remarks').textContent).toBe('out of CRAFT order');
  });

  it('several remarks are joined', () => {
    const row = renderVerdict({ ...typedWrongValue, remarks: ['a', 'b'] });
    expect(partOf(row, 'p.remarks').textContent).toBe('a · b');
  });
});

describe('renderVerdict on a picked element', () => {
  it('a picked row marks the words that differ', () => {
    const row = renderVerdict(pickedAltitude);
    expect(partOf(row, '.answer .wrong').textContent).toBe('5,000');
    const expected = partOf(row, 'p.expected');
    expect(expected.textContent).toBe('correction: maintain 3,000');
    expect(partOf(expected, 'strong.missed').textContent).toBe('3,000');
  });

  it('a picked row with nothing in common marks nothing', () => {
    const row = renderVerdict({
      ...pickedAltitude,
      actualLabel: '(no prefix)',
      expectedLabel: 'climb via SID',
    });
    expect(row.querySelector('.answer .wrong')).toBeNull();
    expect(row.querySelector('.expected .missed')).toBeNull();
    expect(partOf(row, '.answer').textContent).toBe('you said: (no prefix)');
    expect(partOf(row, 'p.expected').textContent).toBe('correction: climb via SID');
  });

  it('a strip box row is left as it was', () => {
    const row = renderVerdict(wrongBox);
    expect(row.querySelector('.wrong')).toBeNull();
    expect(row.querySelector('.missed')).toBeNull();
    expect(partOf(row, '.answer').textContent).toBe('you said: correct as filed');
    expect(partOf(row, 'p.expected').textContent).toBe('correction: FL270');
    expect(partOf(row, 'p.why').textContent).toBe(
      'why: the altitude is wrong for direction of flight',
    );
  });
});
