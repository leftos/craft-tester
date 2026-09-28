// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { BoxElementGrade } from '@/rules/amend/grade.ts';
import type { SpokenClearance } from '@/rules/speak.ts';
import type { RouteReading, TextGrade } from '@/rules/text/grade.ts';
import type { Grade } from '@/rules/types.ts';
import { renderResults, renderVerdict } from '@/ui/results.ts';

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

/** A clearance whose route reads one way on frequency and another read to its end. */
const spoken: SpokenClearance = {
  abbreviated: 'cleared to Las Vegas airport via the SSTIK Four departure, then as filed',
  fullRoute: 'cleared to Las Vegas airport via the SSTIK Four departure, Salinas, direct',
  parts: [],
  fullRouteWords: 'SSTIK Four departure Salinas direct',
};

/** The reveal of a results panel rendered for one reading: one box per reading it shows. */
function revealBoxes(routeReading: RouteReading): { heading: string; text: string }[] {
  const panel = renderResults({
    grades: [typedCorrect],
    spoken,
    routeReading,
    onNext: () => undefined,
    onRetry: () => undefined,
  });
  return [...panel.querySelectorAll('.reveal .spoken-box')].map((box) => ({
    heading: box.querySelector('h3')?.textContent ?? '',
    text: box.querySelector('.spoken')?.textContent ?? '',
  }));
}

function partOf(row: Element, selector: string): Element {
  const found = row.querySelector(selector);
  if (found === null) throw new Error(`the row has no ${selector}`);
  return found;
}

/** The label a value of a row's detail list reads under. */
function termOf(value: Element): string {
  return value.previousElementSibling?.textContent ?? '';
}

describe('renderVerdict on a typed element', () => {
  it('marks the filler inside the said line', () => {
    const answer = partOf(renderVerdict(typedAltitude), 'dd.answer');
    expect(termOf(answer)).toBe('You said');
    expect(answer.textContent).toBe('Climb via the SID');
    const filler = answer.querySelectorAll('.filler');
    expect(filler).toHaveLength(1);
    expect(filler[0]?.textContent).toBe('the');
  });

  it('shows the expected words on an acceptable row', () => {
    const expected = partOf(renderVerdict(typedAltitude), 'dd.expected');
    expect(termOf(expected)).toBe('Reads as');
    expect(expected.textContent).toBe('climb via sid');
  });

  it('shows no expected words on a correct row', () => {
    const row = renderVerdict(typedCorrect);
    expect(row.querySelector('.expected')).toBeNull();
    expect(partOf(row, '.answer').textContent).toBe('Climb via SID');
  });

  it('marks the words never said inside the expected line', () => {
    const expected = partOf(renderVerdict(typedMissedWord), 'dd.expected');
    expect(expected.textContent).toBe('Oakland Six departure');
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

describe('the reveal', () => {
  it('reveals the full reading alone on a full route clearance', () => {
    const boxes = revealBoxes('full');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.heading).toBe('On frequency');
    expect(boxes[0]?.text).toBe(spoken.fullRoute);
  });

  it('reveals both readings where the student is held to the abbreviated one', () => {
    const boxes = revealBoxes('abbreviated');
    expect(boxes).toStrictEqual([
      { heading: 'On frequency', text: spoken.abbreviated },
      { heading: 'With the route read in full', text: spoken.fullRoute },
    ]);
  });
});

describe('renderVerdict on a picked element', () => {
  it('a picked row marks the words that differ', () => {
    const row = renderVerdict(pickedAltitude);
    expect(partOf(row, '.answer .wrong').textContent).toBe('5,000');
    const expected = partOf(row, 'dd.expected');
    expect(termOf(expected)).toBe('Reads as');
    expect(expected.textContent).toBe('maintain 3,000');
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
    expect(partOf(row, 'dd.answer').textContent).toBe('(no prefix)');
    expect(partOf(row, 'dd.expected').textContent).toBe('climb via SID');
  });

  it('a strip box row reads its reason unchanged', () => {
    const row = renderVerdict(wrongBox);
    expect(row.querySelector('.wrong')).toBeNull();
    expect(row.querySelector('.missed')).toBeNull();
    expect(partOf(row, 'dd.answer').textContent).toBe('correct as filed');
    expect(partOf(row, 'dd.expected').textContent).toBe('FL270');
    const reason = partOf(row, 'dd.reason');
    expect(termOf(reason)).toBe('Reason');
    expect(reason.textContent).toBe('the altitude is wrong for direction of flight');
    expect(row.querySelector('dd.note')).toBeNull();
  });
});

/** A row of the rules the expect clause is graded by. */
const expectRow = {
  id: 'A-EXPECT-REDUNDANT',
  source: 'ZOA SFO SOP',
  text: 'An expect clause the SID chart already publishes.',
};

/** A picked expect clause the chart already publishes: wrong. */
const wrongExpect: Grade = {
  element: 'A.expect',
  verdict: 'wrong',
  expectedLabel: 'no expect altitude',
  actualLabel: 'expect FL340 10 minutes after departure',
  citations: [expectRow, { ...expectRow, id: 'S-FILLER' }],
};

/** A results panel with a correct, an acceptable and a wrong element. */
function resultsOf(grades: readonly Grade[]): HTMLElement {
  return renderResults({
    grades,
    spoken,
    routeReading: 'abbreviated',
    onNext: () => undefined,
    onRetry: () => undefined,
  });
}

describe('the results rows', () => {
  const grades: Grade[] = [
    { ...pickedAltitude, element: 'C', verdict: 'correct', actualLabel: 'Las Vegas airport' },
    typedAltitude,
    wrongExpect,
  ];

  it('links each element pill to its row', () => {
    const panel = resultsOf(grades);
    const pills = [...panel.querySelectorAll('.pills a')];
    expect(pills.map((pill) => pill.getAttribute('href'))).toStrictEqual([
      '#row-C',
      '#row-A.phrase',
      '#row-A.expect',
    ]);
    expect(pills[0]?.textContent).toBe('C ✓');
    for (const pill of pills) {
      const id = (pill.getAttribute('href') ?? '').slice(1);
      expect(panel.querySelector(`[id="${id}"]`)?.classList.contains('verdict')).toBe(true);
    }
    const wrong = pills[2];
    expect(wrong?.textContent).toBe('A expect ✗');
    expect(wrong?.getAttribute('aria-label')).toBe('A expect: ✗ Wrong');
  });

  it('collapses a correct row to one closed line', () => {
    const row = renderVerdict({ ...pickedAltitude, verdict: 'correct' });
    expect(row.tagName).toBe('DETAILS');
    expect(row.hasAttribute('open')).toBe(false);
    expect(partOf(row, 'summary .tag').textContent).toBe('Correct');
    expect(partOf(row, 'summary .said').textContent).toBe('maintain 5,000');
  });

  it('expands a wrong picked row with no note', () => {
    const row = renderVerdict(wrongExpect);
    expect(row.tagName).toBe('DIV');
    expect(partOf(row, '.tag').textContent).toBe('✗ Wrong');
    expect(row.querySelector('dd.note')).toBeNull();
  });

  it('notes the kinds of miss on a typed row', () => {
    const row = renderVerdict({ ...typedWrongValue, citations: [expectRow] });
    const note = partOf(row, 'dd.note');
    expect(termOf(note)).toBe('Note');
    expect(note.textContent).toBe('wrong value: said "6201", expected "three three four two"');
  });

  it('keeps the rules applied behind a closed disclosure', () => {
    const rules = partOf(renderVerdict(wrongExpect), 'details.rules');
    expect(rules.hasAttribute('open')).toBe(false);
    expect(partOf(rules, 'summary').textContent).toBe('2 rules applied');
    expect(partOf(rules, '.citations li').textContent).toBe(
      'A-EXPECT-REDUNDANT — An expect clause the SID chart already publishes. (ZOA SFO SOP)',
    );
  });

  it('opens on the score and the tails, then the reading on frequency', () => {
    const panel = resultsOf(grades);
    expect(partOf(panel, '.summary .score').textContent).toBe('2/3correct');
    expect(partOf(panel, '.score-sub').textContent).toBe('1 wrong, 1 acceptable.');
    expect(panel.querySelector('.summary + .reveal')).not.toBeNull();
  });

  it('puts Next strip ahead of Try this strip again', () => {
    const buttons = [...resultsOf(grades).querySelectorAll('.actions button')];
    expect(buttons.map((node) => [node.textContent, node.className])).toStrictEqual([
      ['Next strip', 'primary'],
      ['Try this strip again', 'secondary'],
    ]);
  });
});
