import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData } from '@/data/schema.ts';
import { expectChoiceLabel, grade, gradeProcedure } from '@/rules/grade.ts';
import type { PlayerPicks, ResolvedClearance, RuleCitation } from '@/rules/types.ts';

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
  sid: {
    value: { id: 'TRUKN2', family: 'TRUKN', spoken: 'Trukn Two' },
    citations: [assignmentCitation],
  },
  route: { value: { template: 'transition', fix: 'DEDHD' }, citations: [] },
  altitude: {
    value: { phrase: 'climb_via_except', feet: 10000 },
    citations: [altitudeCitation],
  },
  expect: { value: { feet: 35000, minutes: 10, amended: false }, citations: [altitudeCitation] },
  frequency: { value: { value: '120.9', sectorId: 'richmond' }, citations: [assignmentCitation] },
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

const allOk = [true, true, true, true, true];

const cases: { name: string; picks: PlayerPicks; ok: boolean[] }[] = [
  { name: 'a fully correct entry', picks: correct, ok: allOk },
  {
    name: 'the wrong route template',
    picks: { ...correct, routeTemplate: 'as_filed' },
    ok: [false, true, true, true, true],
  },
  {
    name: 'the right template with the wrong transition fix',
    picks: { ...correct, routeFix: 'SSTIK' },
    ok: [false, true, true, true, true],
  },
  {
    name: 'the wrong altitude phrase',
    picks: { ...correct, altitudePhrase: 'maintain' },
    ok: [true, false, true, true, true],
  },
  {
    name: 'the right phrase with the wrong feet',
    picks: { ...correct, altitudeFeet: 5000 },
    ok: [true, false, true, true, true],
  },
  {
    name: 'the wrong expect delay',
    picks: { ...correct, expect: 'three_minutes' },
    ok: [true, true, false, true, true],
  },
  {
    name: 'no expect clause where one is due',
    picks: { ...correct, expect: 'none' },
    ok: [true, true, false, true, true],
  },
  {
    name: 'the wrong frequency',
    picks: { ...correct, frequency: '135.65' },
    ok: [true, true, true, false, true],
  },
  {
    name: 'the other runway of the pair',
    picks: { ...correct, runway: '01L' },
    ok: [true, true, true, true, false],
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
    expect(runway?.ok).toBe(true);
    expect(runway?.expectedLabel).toBe('01R');
    expect(runway?.actualLabel).toBe('01R');
    expect(runway?.citations).toEqual([runwayCitation]);
    const [wrong] = grade({ ...correct, runway: '28L' }, expected).slice(-1);
    expect(wrong?.ok).toBe(false);
    expect(wrong?.expectedLabel).toBe('01R');
    expect(wrong?.actualLabel).toBe('28L');
  });

  it.each(cases)('marks $name', ({ picks, ok }) => {
    expect(grade(picks, expected).map((entry) => entry.ok)).toEqual(ok);
  });

  it('grades an as-filed route on the fix it hands over on', () => {
    const asFiled: ResolvedClearance = {
      ...expected,
      route: { value: { template: 'as_filed', fix: 'TRUKN' }, citations: [] },
    };
    const picks: PlayerPicks = { ...correct, routeTemplate: 'as_filed', routeFix: 'TRUKN' };
    const [route] = grade(picks, asFiled);
    expect(route?.ok).toBe(true);
    expect(route?.expectedLabel).toBe('TRUKN');
    const [wrongFix] = grade({ ...picks, routeFix: 'DEDHD' }, asFiled);
    expect(wrongFix?.ok).toBe(false);
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
    expect(route?.ok).toBe(true);
    expect(route?.expectedLabel).toBe('radar vectors to join V6');
    const [wrongAirway] = grade({ ...picks, routeFix: 'V244' }, airway);
    expect(wrongAirway?.ok).toBe(false);
    expect(wrongAirway?.actualLabel).toBe('radar vectors to join V244');
  });

  it('ignores the feet on a plain climb via SID', () => {
    const climbVia: ResolvedClearance = {
      ...expected,
      altitude: { value: { phrase: 'climb_via' }, citations: [altitudeCitation] },
    };
    const [, altitude] = grade({ ...correct, altitudePhrase: 'climb_via' }, climbVia);
    expect(altitude?.ok).toBe(true);
    expect(altitude?.expectedLabel).toBe('climb via SID');
  });

  it('accepts a missing expect clause where none is due', () => {
    const noExpect: ResolvedClearance = {
      ...expected,
      expect: { value: null, citations: [] },
    };
    const [, , clause] = grade({ ...correct, expect: 'none' }, noExpect);
    expect(clause?.ok).toBe(true);
    expect(clause?.expectedLabel).toBe('no expect altitude');
    expect(clause?.actualLabel).toBe('no expect altitude');
  });

  it('names the amended altitude in both labels where the altitude box was amended', () => {
    const amended: ResolvedClearance = {
      ...expected,
      expect: { value: { feet: 27000, minutes: 10, amended: true }, citations: [] },
    };
    const [, , clause] = grade({ ...correct, expect: 'three_minutes' }, amended);
    expect(clause?.ok).toBe(false);
    expect(clause?.expectedLabel).toBe('expect amended altitude 10 minutes after departure');
    expect(clause?.actualLabel).toBe('expect amended altitude 3 minutes after departure');
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
    expect(verdict.ok).toBe(true);
    expect(verdict.expectedLabel).toBe('TRUKN TWO (RNAV)');
    expect(verdict.actualLabel).toBe('TRUKN TWO (RNAV)');
  });

  it('marks a procedure of another family wrong', () => {
    const verdict = gradeProcedure('SSTIK5', expected, ksfo);
    expect(verdict.ok).toBe(false);
    expect(verdict.expectedLabel).toBe('TRUKN TWO (RNAV)');
    expect(verdict.actualLabel).toBe('SSTIK FIVE (RNAV)');
  });

  it('accepts another version of the same family, because a cycle bumps the version', () => {
    const older: ResolvedClearance = {
      ...expected,
      sid: {
        value: { id: 'TRUKN1', family: 'TRUKN', spoken: 'Trukn One' },
        citations: [assignmentCitation],
      },
    };
    const verdict = gradeProcedure('TRUKN2', older, ksfo);
    expect(verdict.ok).toBe(true);
    expect(verdict.expectedLabel).toBe('TRUKN1');
  });

  it('marks an identifier the airport does not publish wrong, and reads it back raw', () => {
    const verdict = gradeProcedure('BIGSUR4', expected, ksfo);
    expect(verdict.ok).toBe(false);
    expect(verdict.actualLabel).toBe('BIGSUR4');
  });
});

describe('expectChoiceLabel', () => {
  it('names the filed altitude on a clearance and the amended one after an amendment', () => {
    expect(expectChoiceLabel('ten_minutes', false)).toBe(
      'expect filed altitude 10 minutes after departure',
    );
    expect(expectChoiceLabel('ten_minutes', true)).toBe(
      'expect amended altitude 10 minutes after departure',
    );
    expect(expectChoiceLabel('none', true)).toBe('no expect altitude');
  });
});
