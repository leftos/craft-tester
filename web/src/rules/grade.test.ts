import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData } from '@/data/schema.ts';
import {
  altitudeLabel,
  expectChoiceLabel,
  formatAltitude,
  grade,
  gradeProcedure,
  headingFromPick,
  headingPick,
} from '@/rules/grade.ts';
import type {
  ExpectClause,
  PlayerPicks,
  ResolvedClearance,
  RuleCitation,
  Verdict,
} from '@/rules/types.ts';

const ksfo = ksfoJson as unknown as AirportData;

const assignmentCitation: RuleCitation = {
  id: 'SFOW-N-TRUKN-01',
  source: 'SFO ATCT SOP 2-2 a',
  text: 'Northbound, runway 01, T/J -> TRUKN#',
};

const altitudeCitation: RuleCitation = {
  id: 'SFOW-J-10000',
  source: 'SFO ATCT SOP 2-2 c ii',
  text: 'SFOW: all others, runways 01/28, J -> 10,000 or CVS x 10,000',
};

const runwayCitation: RuleCitation = {
  id: 'RWY-DIRECTION',
  source: 'S1-SFO-0 CBT, Runway Assignment: 28/01 1L or 1R?',
  text: 'The departure runway follows the first turn: right turn (northbound SIDs) 1R',
};

const expected: ResolvedClearance = {
  clearedTo: { value: 'KSEA', citations: [] },
  runway: { value: '01R', citations: [runwayCitation] },
  procedure: {
    value: { kind: 'sid', id: 'TRUKN2', family: 'TRUKN', spoken: 'Trukn Two' },
    citations: [assignmentCitation],
  },
  route: { value: { template: 'transition', fix: 'DEDHD' }, citations: [] },
  altitude: {
    value: { phrase: 'climb_via_except', feet: 10000 },
    citations: [altitudeCitation],
  },
  expect: { value: { kind: 'filed', feet: 35000, minutes: 10 }, citations: [altitudeCitation] },
  redundantExpect: { value: null, citations: [] },
  frequency: { value: { value: '120.9', sectorId: 'richmond' }, citations: [assignmentCitation] },
};

const headingCitation: RuleCitation = {
  id: 'SFOW-NOISE-P-RWY',
  source: 'SFO ATCT SOP 2-4 e',
  text: 'Noise abatement: runway 01, non-RNAV props -> runway heading (no DP)',
};

/** The clearance the noise window issues a non-RNAV prop off the 01s: no procedure at all. */
const onTheHeading: ResolvedClearance = {
  ...expected,
  procedure: {
    value: {
      kind: 'heading',
      heading: 'runway heading',
      turn: undefined,
      spoken: 'fly runway heading',
    },
    citations: [headingCitation],
  },
  route: { value: { template: 'radar_vectors_fix', fix: 'OAK' }, citations: [] },
};

/** The clearance a row that names a heading in degrees issues: 270, turned the shorter way. */
const onHeading270: ResolvedClearance = {
  ...onTheHeading,
  procedure: {
    value: { kind: 'heading', heading: 270, turn: 'left', spoken: 'turn left heading 270' },
    citations: [headingCitation],
  },
};

const redundantCitation: RuleCitation = {
  id: 'A-EXPECT-REDUNDANT',
  source: 'ZOA senior staff via the user, 2026-09-16; FAA JO 7110.65 4-3-2 c 3',
  text: 'the chart publishes the expect note itself, so speaking it is longer than it needs to be',
};

/** A clearance whose expect clause the SID chart already publishes, so the engine drops it. */
const chartPublishes: ResolvedClearance = {
  ...expected,
  expect: { value: null, citations: [altitudeCitation] },
  redundantExpect: {
    value: { kind: 'filed', feet: 35000, minutes: 10 },
    citations: [redundantCitation],
  },
};

const finalCitation: RuleCitation = {
  id: 'A-FINAL',
  source: 'ZOA practice via the user, 2026-09-16 (SKW2345 amendment plan)',
  text: '(altitude) WILL BE YOUR FINAL — spoken in place of the expect clause',
};

/** A clearance that climbs the flight straight to the amended altitude and speaks it. */
const speaksFinal: ResolvedClearance = {
  ...expected,
  altitude: { value: { phrase: 'climb_via_except', feet: 9000 }, citations: [altitudeCitation] },
  expect: { value: { kind: 'final', feet: 9000 }, citations: [altitudeCitation] },
};

/** The same clearance with the amended clause it allows beside the final reading. */
const finalWithAmended: ResolvedClearance = {
  ...speaksFinal,
  redundantExpect: {
    value: { kind: 'amended', feet: 9000, minutes: 10 },
    citations: [finalCitation],
  },
};

const correct: PlayerPicks = {
  routeTemplate: 'transition',
  routeFix: 'DEDHD',
  altitudePhrase: 'climb_via_except',
  altitudeFeet: 10000,
  expect: 'ten_minutes',
  frequency: '120.9',
  runway: '01R',
};

const allCorrect: Verdict[] = ['correct', 'correct', 'correct', 'correct', 'correct'];

/** The five verdicts with the one at `index` wrong, which is what a single bad pick earns. */
function wrongAt(index: number): Verdict[] {
  return allCorrect.map((verdict, position) => (position === index ? 'wrong' : verdict));
}

const cases: { name: string; picks: PlayerPicks; verdicts: Verdict[] }[] = [
  { name: 'a fully correct entry', picks: correct, verdicts: allCorrect },
  {
    name: 'the wrong route template',
    picks: { ...correct, routeTemplate: 'as_filed' },
    verdicts: wrongAt(0),
  },
  {
    name: 'the right template with the wrong transition fix',
    picks: { ...correct, routeFix: 'SSTIK' },
    verdicts: wrongAt(0),
  },
  {
    name: 'the wrong altitude phrase',
    picks: { ...correct, altitudePhrase: 'maintain' },
    verdicts: wrongAt(1),
  },
  {
    name: 'the right phrase with the wrong feet',
    picks: { ...correct, altitudeFeet: 5000 },
    verdicts: wrongAt(1),
  },
  {
    name: 'the wrong expect delay',
    picks: { ...correct, expect: 'three_minutes' },
    verdicts: wrongAt(2),
  },
  {
    name: 'the five-minute distractor',
    picks: { ...correct, expect: 'five_minutes' },
    verdicts: wrongAt(2),
  },
  {
    name: 'no expect clause where one is due',
    picks: { ...correct, expect: 'none' },
    verdicts: wrongAt(2),
  },
  {
    name: 'the wrong frequency',
    picks: { ...correct, frequency: '135.65' },
    verdicts: wrongAt(3),
  },
  {
    name: 'the other runway of the pair',
    picks: { ...correct, runway: '01L' },
    verdicts: wrongAt(4),
  },
];

describe('grade', () => {
  it('returns the five graded CRAFT elements in order, with the runway last', () => {
    expect(grade(correct, expected).map((entry) => entry.element)).toEqual([
      'R.route',
      'A.phrase',
      'A.expect',
      'F',
      'RWY',
    ]);
  });

  it('grades the runway pick against the runway the engine explained', () => {
    const [runway] = grade(correct, expected).slice(-1);
    expect(runway?.verdict).toBe('correct');
    expect(runway?.expectedLabel).toBe('01R');
    expect(runway?.actualLabel).toBe('01R');
    expect(runway?.citations).toEqual([runwayCitation]);
    const [wrong] = grade({ ...correct, runway: '28L' }, expected).slice(-1);
    expect(wrong?.verdict).toBe('wrong');
    expect(wrong?.expectedLabel).toBe('01R');
    expect(wrong?.actualLabel).toBe('28L');
  });

  it.each(cases)('marks $name', ({ picks, verdicts }) => {
    expect(grade(picks, expected).map((entry) => entry.verdict)).toEqual(verdicts);
  });

  it('grades an as-filed route on the fix it hands over on', () => {
    const asFiled: ResolvedClearance = {
      ...expected,
      route: { value: { template: 'as_filed', fix: 'TRUKN' }, citations: [] },
    };
    const picks: PlayerPicks = { ...correct, routeTemplate: 'as_filed', routeFix: 'TRUKN' };
    const [route] = grade(picks, asFiled);
    expect(route?.verdict).toBe('correct');
    expect(route?.expectedLabel).toBe('TRUKN');
    const [wrongFix] = grade({ ...picks, routeFix: 'DEDHD' }, asFiled);
    expect(wrongFix?.verdict).toBe('wrong');
    expect(wrongFix?.actualLabel).toBe('DEDHD');
  });

  it('grades an airway route on the airway the vectors join', () => {
    const airway: ResolvedClearance = {
      ...expected,
      route: { value: { template: 'radar_vectors_airway', fix: 'V6' }, citations: [] },
    };
    const picks: PlayerPicks = {
      ...correct,
      routeTemplate: 'radar_vectors_airway',
      routeFix: 'V6',
    };
    const [route] = grade(picks, airway);
    expect(route?.verdict).toBe('correct');
    expect(route?.expectedLabel).toBe('radar vectors to join V6 airway');
    const [wrongAirway] = grade({ ...picks, routeFix: 'V244' }, airway);
    expect(wrongAirway?.verdict).toBe('wrong');
    expect(wrongAirway?.actualLabel).toBe('radar vectors to join V244 airway');
  });

  it('ignores the feet on a plain climb via SID', () => {
    const climbVia: ResolvedClearance = {
      ...expected,
      altitude: { value: { phrase: 'climb_via' }, citations: [altitudeCitation] },
    };
    const [, altitude] = grade({ ...correct, altitudePhrase: 'climb_via' }, climbVia);
    expect(altitude?.verdict).toBe('correct');
    expect(altitude?.expectedLabel).toBe('climb via SID');
  });

  it('accepts a missing expect clause where none is due', () => {
    const noExpect: ResolvedClearance = {
      ...expected,
      expect: { value: null, citations: [] },
    };
    const [, , clause] = grade({ ...correct, expect: 'none' }, noExpect);
    expect(clause?.verdict).toBe('correct');
    expect(clause?.expectedLabel).toBe('no expect altitude');
    expect(clause?.actualLabel).toBe('no expect altitude');
  });

  it('names the amended altitude in both labels where the altitude box was amended', () => {
    const amended: ResolvedClearance = {
      ...expected,
      expect: { value: { kind: 'amended', feet: 27000, minutes: 10 }, citations: [] },
    };
    const [, , clause] = grade({ ...correct, expect: 'three_minutes' }, amended);
    expect(clause?.verdict).toBe('wrong');
    expect(clause?.expectedLabel).toBe('expect amended altitude 10 minutes after departure');
    expect(clause?.actualLabel).toBe('expect amended altitude 3 minutes after departure');
  });

  it('grades the amended clause as mandatory: speaking it is right, dropping it is not', () => {
    const amended: ResolvedClearance = {
      ...expected,
      expect: { value: { kind: 'amended', feet: 27000, minutes: 10 }, citations: [] },
    };
    const [, , spoken] = grade({ ...correct, expect: 'ten_minutes' }, amended);
    expect(spoken?.verdict).toBe('correct');
    const [, , dropped] = grade({ ...correct, expect: 'none' }, amended);
    expect(dropped?.verdict).toBe('wrong');
  });

  it('grades the final reading the clearance speaks, and a delay it allows nothing for as a miss', () => {
    const picks: PlayerPicks = { ...correct, altitudeFeet: 9000 };
    const [, , spoken] = grade({ ...picks, expect: 'final' }, speaksFinal);
    expect(spoken?.verdict).toBe('correct');
    expect(spoken?.expectedLabel).toBe('9,000 will be your final');
    expect(spoken?.actualLabel).toBe('9,000 will be your final');
    const [, , delayed] = grade({ ...picks, expect: 'ten_minutes' }, speaksFinal);
    expect(delayed?.verdict).toBe('wrong');
    expect(delayed?.actualLabel).toBe('expect amended altitude 10 minutes after departure');
  });

  it('accepts the amended clause beside the final reading, at the delay that clause would carry', () => {
    const picks: PlayerPicks = { ...correct, altitudeFeet: 9000 };
    const [, , clause] = grade({ ...picks, expect: 'ten_minutes' }, finalWithAmended);
    expect(clause?.verdict).toBe('acceptable');
    expect(clause?.expectedLabel).toBe('9,000 will be your final');
    expect(clause?.actualLabel).toBe('expect amended altitude 10 minutes after departure');
    expect(clause?.citations).toEqual([finalCitation]);
  });

  it('keeps the final reading itself correct where the amended clause is allowed beside it', () => {
    const picks: PlayerPicks = { ...correct, altitudeFeet: 9000 };
    const [, , clause] = grade({ ...picks, expect: 'final' }, finalWithAmended);
    expect(clause?.verdict).toBe('correct');
    expect(clause?.citations).toEqual([altitudeCitation]);
  });

  it('marks another delay and dropping the clause wrong beside the final reading', () => {
    const picks: PlayerPicks = { ...correct, altitudeFeet: 9000 };
    const [, , early] = grade({ ...picks, expect: 'three_minutes' }, finalWithAmended);
    expect(early?.verdict).toBe('wrong');
    expect(early?.citations).toEqual([altitudeCitation]);
    const [, , dropped] = grade({ ...picks, expect: 'none' }, finalWithAmended);
    expect(dropped?.verdict).toBe('wrong');
  });

  it('marks the final reading wrong where the clearance speaks a delay', () => {
    const [, , clause] = grade({ ...correct, expect: 'final' }, expected);
    expect(clause?.verdict).toBe('wrong');
    expect(clause?.expectedLabel).toBe('expect filed altitude 10 minutes after departure');
    expect(clause?.actualLabel).toBe('FL350 will be your final');
  });

  it('marks the final reading wrong where the clearance speaks no clause at all', () => {
    const noExpect: ResolvedClearance = { ...expected, expect: { value: null, citations: [] } };
    const [, , clause] = grade({ ...correct, expect: 'final' }, noExpect);
    expect(clause?.verdict).toBe('wrong');
    expect(clause?.expectedLabel).toBe('no expect altitude');
  });

  it('accepts the clause the chart publishes, at the delay the chart publishes', () => {
    const [, , clause] = grade({ ...correct, expect: 'ten_minutes' }, chartPublishes);
    expect(clause?.verdict).toBe('acceptable');
    expect(clause?.expectedLabel).toBe('no expect altitude');
    expect(clause?.actualLabel).toBe('expect filed altitude 10 minutes after departure');
    expect(clause?.citations).toEqual([redundantCitation]);
  });

  it('marks another delay wrong even where the chart publishes the note', () => {
    const [, , clause] = grade({ ...correct, expect: 'three_minutes' }, chartPublishes);
    expect(clause?.verdict).toBe('wrong');
    expect(clause?.citations).toEqual([altitudeCitation]);
  });

  it('marks the five-minute distractor wrong where the chart publishes the note', () => {
    const [, , clause] = grade({ ...correct, expect: 'five_minutes' }, chartPublishes);
    expect(clause?.verdict).toBe('wrong');
    expect(clause?.citations).toEqual([altitudeCitation]);
  });

  it('marks dropping the clause correct where the chart publishes the note', () => {
    const [, , clause] = grade({ ...correct, expect: 'none' }, chartPublishes);
    expect(clause?.verdict).toBe('correct');
  });

  it('marks a clause dropped for any other reason wrong when it is spoken', () => {
    const noExpect: ResolvedClearance = {
      ...expected,
      expect: { value: null, citations: [altitudeCitation] },
    };
    const [, , clause] = grade({ ...correct, expect: 'ten_minutes' }, noExpect);
    expect(clause?.verdict).toBe('wrong');
  });

  it('labels every element the way the results view reads them', () => {
    const wrong: PlayerPicks = {
      ...correct,
      routeTemplate: 'radar_vectors_fix',
      routeFix: 'RBL',
      altitudePhrase: 'maintain',
      altitudeFeet: 3000,
      expect: 'three_minutes',
      frequency: '135.65',
      runway: '28L',
    };
    expect(grade(wrong, expected).map((entry) => [entry.expectedLabel, entry.actualLabel])).toEqual(
      [
        ['DEDHD transition', 'radar vectors RBL'],
        ['climb via SID except maintain 10,000', 'maintain 3,000'],
        [
          'expect filed altitude 10 minutes after departure',
          'expect filed altitude 3 minutes after departure',
        ],
        ['120.9', '135.65'],
        ['01R', '28L'],
      ],
    );
  });

  it('carries the citations of the expected element', () => {
    expect(grade(correct, expected).map((entry) => entry.citations)).toEqual([
      [],
      [altitudeCitation],
      [altitudeCitation],
      [assignmentCitation],
      [runwayCitation],
    ]);
  });
});

describe('gradeProcedure', () => {
  it('reports under the procedure element, with the citations that assigned it', () => {
    const verdict = gradeProcedure('TRUKN2', expected, ksfo);
    expect(verdict.element).toBe('R.sid');
    expect(verdict.citations).toEqual([assignmentCitation]);
  });

  it('marks the assigned procedure right, named as its chart names it', () => {
    const verdict = gradeProcedure('TRUKN2', expected, ksfo);
    expect(verdict.verdict).toBe('correct');
    expect(verdict.expectedLabel).toBe('TRUKN TWO (RNAV)');
    expect(verdict.actualLabel).toBe('TRUKN TWO (RNAV)');
  });

  it('marks a procedure of another family wrong', () => {
    const verdict = gradeProcedure('SSTIK5', expected, ksfo);
    expect(verdict.verdict).toBe('wrong');
    expect(verdict.expectedLabel).toBe('TRUKN TWO (RNAV)');
    expect(verdict.actualLabel).toBe('SSTIK FIVE (RNAV)');
  });

  it('accepts another version of the same family, because a cycle bumps the version', () => {
    const older: ResolvedClearance = {
      ...expected,
      procedure: {
        value: { kind: 'sid', id: 'TRUKN1', family: 'TRUKN', spoken: 'Trukn One' },
        citations: [assignmentCitation],
      },
    };
    const verdict = gradeProcedure('TRUKN2', older, ksfo);
    expect(verdict.verdict).toBe('correct');
    expect(verdict.expectedLabel).toBe('TRUKN1');
  });

  it('marks the runway heading right for a clearance the SOP issues without a procedure', () => {
    const verdict = gradeProcedure(headingPick('runway heading'), onTheHeading, ksfo);
    expect(verdict.verdict).toBe('correct');
    expect(verdict.expectedLabel).toBe('fly runway heading (no DP)');
    expect(verdict.actualLabel).toBe('fly runway heading (no DP)');
    expect(verdict.citations).toEqual([headingCitation]);
  });

  it('marks a published procedure wrong against a clearance on the runway heading', () => {
    const verdict = gradeProcedure('TRUKN2', onTheHeading, ksfo);
    expect(verdict.verdict).toBe('wrong');
    expect(verdict.expectedLabel).toBe('fly runway heading (no DP)');
    expect(verdict.actualLabel).toBe('TRUKN TWO (RNAV)');
  });

  it('marks the runway heading wrong against a clearance that assigns a procedure', () => {
    const verdict = gradeProcedure(headingPick('runway heading'), expected, ksfo);
    expect(verdict.verdict).toBe('wrong');
    expect(verdict.expectedLabel).toBe('TRUKN TWO (RNAV)');
    expect(verdict.actualLabel).toBe('fly runway heading (no DP)');
  });

  it('marks a heading in degrees right against the clearance that issues that heading', () => {
    const verdict = gradeProcedure(headingPick(270), onHeading270, ksfo);
    expect(verdict.verdict).toBe('correct');
    expect(verdict.expectedLabel).toBe('heading 270 (no DP)');
    expect(verdict.actualLabel).toBe('heading 270 (no DP)');
    expect(verdict.citations).toEqual([headingCitation]);
  });

  it('marks a heading in degrees wrong against a clearance on the runway heading', () => {
    const verdict = gradeProcedure(headingPick(270), onTheHeading, ksfo);
    expect(verdict.verdict).toBe('wrong');
    expect(verdict.expectedLabel).toBe('fly runway heading (no DP)');
    expect(verdict.actualLabel).toBe('heading 270 (no DP)');
  });

  it('marks a heading in degrees wrong against a clearance that assigns a procedure', () => {
    const verdict = gradeProcedure(headingPick(270), expected, ksfo);
    expect(verdict.verdict).toBe('wrong');
    expect(verdict.expectedLabel).toBe('TRUKN TWO (RNAV)');
    expect(verdict.actualLabel).toBe('heading 270 (no DP)');
  });

  it('marks the runway heading wrong against a clearance on a heading in degrees', () => {
    const verdict = gradeProcedure(headingPick('runway heading'), onHeading270, ksfo);
    expect(verdict.verdict).toBe('wrong');
    expect(verdict.expectedLabel).toBe('heading 270 (no DP)');
    expect(verdict.actualLabel).toBe('fly runway heading (no DP)');
  });

  it('marks an identifier the airport does not publish wrong, and reads it back raw', () => {
    const verdict = gradeProcedure('BIGSUR4', expected, ksfo);
    expect(verdict.verdict).toBe('wrong');
    expect(verdict.actualLabel).toBe('BIGSUR4');
  });
});

describe('headingPick', () => {
  it('writes the runway heading and a heading in degrees as different picks', () => {
    expect(headingPick('runway heading')).toBe('heading:runway');
    expect(headingPick(270)).toBe('heading:270');
  });

  it('reads back every pick it writes', () => {
    expect(headingFromPick(headingPick('runway heading'))).toBe('runway heading');
    expect(headingFromPick(headingPick(270))).toBe(270);
  });

  it('reads a published procedure as no heading at all', () => {
    expect(headingFromPick('TRUKN2')).toBeUndefined();
  });

  it('reads back nothing it did not write', () => {
    expect(headingFromPick('runway heading')).toBeUndefined();
    expect(headingFromPick('heading:')).toBeUndefined();
    expect(headingFromPick('heading:north')).toBeUndefined();
    expect(headingFromPick('heading:0')).toBeUndefined();
    expect(headingFromPick('heading:361')).toBeUndefined();
  });
});

describe('expectChoiceLabel', () => {
  const filedClause: ExpectClause = { kind: 'filed', feet: 35000, minutes: 10 };
  const amendedClause: ExpectClause = { kind: 'amended', feet: 27000, minutes: 10 };

  it('names the filed altitude on a clearance and the amended one after an amendment', () => {
    expect(expectChoiceLabel('ten_minutes', filedClause, 35000)).toBe(
      'expect filed altitude 10 minutes after departure',
    );
    expect(expectChoiceLabel('ten_minutes', amendedClause, 27000)).toBe(
      'expect amended altitude 10 minutes after departure',
    );
    expect(expectChoiceLabel('none', amendedClause, 27000)).toBe('no expect altitude');
  });

  it('names the five-minute distractor at its own delay', () => {
    expect(expectChoiceLabel('five_minutes', filedClause, 35000)).toBe(
      'expect filed altitude 5 minutes after departure',
    );
  });

  it('names the altitude itself in the final choice', () => {
    expect(expectChoiceLabel('final', { kind: 'final', feet: 9000 }, 9000)).toBe(
      '9,000 will be your final',
    );
    expect(expectChoiceLabel('final', amendedClause, 32000)).toBe('FL320 will be your final');
  });

  it('names the amended altitude in a delay where the clause is the final reading', () => {
    expect(expectChoiceLabel('three_minutes', { kind: 'final', feet: 9000 }, 9000)).toBe(
      'expect amended altitude 3 minutes after departure',
    );
  });
});

describe('altitudeLabel', () => {
  it('writes the feet the phrase speaks in the strip form, a flight level from 18,000 up', () => {
    expect(altitudeLabel({ phrase: 'maintain', feet: 5000 })).toBe('maintain 5,000');
    expect(altitudeLabel({ phrase: 'climb_via_except', feet: 23000 })).toBe(
      'climb via SID except maintain FL230',
    );
    expect(altitudeLabel({ phrase: 'climb_via' })).toBe('climb via SID');
  });
});

describe('formatAltitude', () => {
  it('writes an altitude below 18,000 in feet, with a thousands separator', () => {
    expect(formatAltitude(17000)).toBe('17,000');
    expect(formatAltitude(5000)).toBe('5,000');
  });

  it('writes 18,000 and everything above it as a flight level', () => {
    expect(formatAltitude(18000)).toBe('FL180');
    expect(formatAltitude(33000)).toBe('FL330');
  });
});
