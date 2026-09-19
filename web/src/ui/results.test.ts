import { describe, expect, it } from 'vitest';
import type { BoxElementGrade } from '@/rules/amend/grade.ts';
import type { TextGrade } from '@/rules/text/grade.ts';
import type { ClearanceElement, Grade } from '@/rules/types.ts';
import { scoreLine, sessionScoreLine, verdictLines } from '@/ui/results.ts';

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

/** The route box that reads the proposal but for the arrival it swaps: half a point. */
const halfRoute: Grade = {
  element: 'BOX.route',
  verdict: 'half',
  expectedLabel: 'SSTIK5 SUSEY EBAYE BURGL IRNMN2',
  actualLabel: 'SSTIK5 SUSEY EBAYE AVE SADDE8',
  citations: [],
};

/** The route box filed without the radar-vector SID's airport navaid: acceptable, the navaid preferred. */
const navaidRoute: Grade = {
  element: 'BOX.route',
  verdict: 'acceptable',
  expectedLabel: 'SFO5 SFO MOGEE BVL',
  actualLabel: 'SFO5 MOGEE BVL',
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

  it('offers the final reading as the shorter one for the amended clause spoken beside it', () => {
    const lines = verdictLines({
      ...redundantExpect,
      expectedLabel: '9,000 will be your final',
      actualLabel: 'expect amended altitude 10 minutes after departure',
    });
    expect(lines.answer).toBe('you said: expect amended altitude 10 minutes after departure');
    expect(lines.verdict).toBe('acceptable');
    expect(lines.correction).toBe('shorter: 9,000 will be your final');
  });

  it('offers the full-credit box for a half verdict', () => {
    const lines = verdictLines(halfRoute);
    expect(lines.answer).toBe('you said: SSTIK5 SUSEY EBAYE AVE SADDE8');
    expect(lines.verdict).toBe('half');
    expect(lines.correction).toBe('full credit: SSTIK5 SUSEY EBAYE BURGL IRNMN2');
  });

  it('offers the preferred reading for a route box the airport navaid alone separates', () => {
    const lines = verdictLines(navaidRoute);
    expect(lines.verdict).toBe('acceptable');
    expect(lines.correction).toBe('preferred: SFO5 SFO MOGEE BVL');
  });
});

/** The altitude box graded against the amendment the engine raised for it, with that amendment's reason. */
const amendedAltitude: BoxElementGrade = {
  element: 'BOX.altitude',
  verdict: 'wrong',
  expectedLabel: 'FL270',
  actualLabel: 'correct as filed',
  citations: [],
  reason: 'the altitude is wrong for direction of flight',
};

describe('verdictLines on a strip box', () => {
  it('says why the box was amended', () => {
    expect(verdictLines(amendedAltitude).why).toBe(
      'why: the altitude is wrong for direction of flight',
    );
  });

  it('says nothing more for a box the engine raised no amendment for', () => {
    expect(verdictLines({ ...amendedAltitude, reason: undefined }).why).toBeUndefined();
  });

  it('says nothing more for a clearance element', () => {
    expect(verdictLines(wrongRoute).why).toBeUndefined();
  });
});

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

describe('verdictLines on a typed element', () => {
  it('shows the expected words where the element is wrong', () => {
    const lines = verdictLines({
      ...typedAltitude,
      verdict: 'wrong',
      actualLabel: 'Climb via',
      said: [{ text: 'Climb via', kind: 'said' }],
    });
    expect(lines.answer).toBe('you said: Climb via');
    expect(lines.correction).toBe('expected: climb via sid');
  });

  it('shows the expected words where the element is acceptable, and a picked one keeps the shorter reading', () => {
    const lines = verdictLines(typedAltitude);
    expect(lines.answer).toBe('you said: Climb via the SID');
    expect(lines.correction).toBe('expected: climb via sid');
    expect(verdictLines(redundantExpect).correction).toBe('shorter: no expect altitude');
  });

  it('shows no second line where the element is correct', () => {
    const lines = verdictLines({
      ...typedAltitude,
      verdict: 'correct',
      actualLabel: 'Climb via SID',
      said: [{ text: 'Climb via SID', kind: 'said' }],
    });
    expect(lines.correction).toBeUndefined();
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
    expect(scoreLine(grades, 'flight plan checks / amendments')).toBe(
      '2 of 3 flight plan checks / amendments correct',
    );
  });

  it('counts a half verdict as half a box', () => {
    const grades: Grade[] = [
      { ...rightRoute, element: 'BOX.type' },
      { ...rightRoute, element: 'BOX.altitude' },
      halfRoute,
    ];
    expect(scoreLine(grades, 'flight plan checks / amendments')).toBe(
      '2½ of 3 flight plan checks / amendments correct, 1 half credit (arrival routing)',
    );
  });

  it('names an acceptable route box as the airport navaid rather than as inefficient', () => {
    const grades: Grade[] = [
      { ...rightRoute, element: 'BOX.type' },
      { ...rightRoute, element: 'BOX.altitude' },
      navaidRoute,
    ];
    expect(scoreLine(grades, 'flight plan checks / amendments')).toBe(
      '3 of 3 flight plan checks / amendments correct, 1 acceptable (airport navaid)',
    );
  });
});

describe('sessionScoreLine', () => {
  const pickedElements: readonly ClearanceElement[] = [
    'R.sid',
    'R.route',
    'A.phrase',
    'A.expect',
    'F',
    'RWY',
  ];
  const typedElements: readonly ClearanceElement[] = [
    'C',
    'R.sid',
    'R.route',
    'A.phrase',
    'A.expect',
    'F',
    'T',
    'RWY',
  ];

  it('counts the strip boxes apart from the clearance elements', () => {
    const boxes: Grade[] = [
      { ...rightRoute, element: 'BOX.type' },
      { ...rightRoute, element: 'BOX.altitude' },
      { ...wrongRoute, element: 'BOX.route' },
    ];
    const clearance: Grade[] = typedElements.map((element) => ({ ...wrongRoute, element }));
    expect(sessionScoreLine([...boxes, ...clearance])).toBe(
      '2 of 3 flight plan checks / amendments correct, 0 of 8 CRAFT clearance elements correct',
    );
  });

  it('keeps each half its own tails', () => {
    const boxes: Grade[] = [
      { ...rightRoute, element: 'BOX.type' },
      { ...rightRoute, element: 'BOX.altitude' },
      halfRoute,
    ];
    const clearance: Grade[] = pickedElements.map((element) =>
      element === 'A.expect' ? redundantExpect : { ...rightRoute, element },
    );
    expect(sessionScoreLine([...boxes, ...clearance])).toBe(
      '2½ of 3 flight plan checks / amendments correct, 1 half credit (arrival routing), ' +
        '6 of 6 CRAFT clearance elements correct, 1 acceptable but inefficient',
    );
  });

  it('counts a clearance with no strip boxes as elements', () => {
    const grades: Grade[] = [
      rightRoute,
      { ...rightRoute, element: 'A.phrase' },
      { ...wrongRoute, element: 'F' },
    ];
    expect(sessionScoreLine(grades)).toBe('2 of 3 elements correct');
  });
});
