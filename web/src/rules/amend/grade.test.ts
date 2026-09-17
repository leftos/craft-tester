import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import type { BoxAnswer, BoxAnswers } from '@/rules/amend/grade.ts';
import {
  boxGradeAsGrade,
  gradeBoxes,
  normaliseRoute,
  normaliseType,
  parseAltitude,
} from '@/rules/amend/grade.ts';
import type { AmendmentResult, ResolvedAmendment } from '@/rules/amend/types.ts';
import { verdictOf } from '@/rules/grade.ts';
import type { RuleCitation } from '@/rules/types.ts';

const ksfo = ksfoJson as unknown as AirportData;

const citation: RuleCitation = {
  id: 'EQUIP/L',
  source: 'FAA JO 7110.65 TBL 5-4-1',
  text: 'RNAV and RVSM',
};

/** The corrected plan the result carries, which grading never reads. */
const CORRECTED: Scenario = {
  callsign: 'UAL313',
  aircraftType: 'B752',
  equipmentSuffix: '/L',
  destination: 'KSLC',
  filedRoute: 'SFO5 MOGEE BVL',
  filedAltitude: 27000,
  runwayConfigId: '28 RT',
  departureRunway: '28L',
  localTime: '1400',
  dayOfWeek: 'tuesday',
  squawk: '4614',
};

const TYPE: ResolvedAmendment = {
  box: 'type',
  proposed: 'B752/L',
  reason: 'suffix /Q is not in the table',
  citations: [citation],
};

const ALTITUDE: ResolvedAmendment = {
  box: 'altitude',
  proposedFeet: 27000,
  reason: 'FL330 is inside RVSM airspace',
  citations: [citation],
};

const ROUTE: ResolvedAmendment = {
  box: 'route',
  proposed: 'SFO5 MOGEE BVL',
  reason: 'TRUKN2 is not the procedure the SOP assigns',
  citations: [citation],
};

/** The RNAV pair: the type box and the route box are two ways to fix the same clash. */
const PAIRED_TYPE: ResolvedAmendment = { ...TYPE, alternativeTo: 'route' };
const PAIRED_ROUTE: ResolvedAmendment = { ...ROUTE, alternativeTo: 'type' };

const AS_FILED: BoxAnswer = { kind: 'as_filed' };

function wrote(value: string): BoxAnswer {
  return { kind: 'amended', value };
}

function answers(overrides: Partial<BoxAnswers> = {}): BoxAnswers {
  return { type: AS_FILED, altitude: AS_FILED, route: AS_FILED, ...overrides };
}

function result(...amendments: ResolvedAmendment[]): Extract<AmendmentResult, { ok: true }> {
  return { ok: true, amendments, corrected: CORRECTED };
}

const cases: {
  name: string;
  answers: BoxAnswers;
  result: Extract<AmendmentResult, { ok: true }>;
  ok: boolean[];
}[] = [
  {
    name: 'a plan that needs no amendment, answered as filed everywhere',
    answers: answers(),
    result: result(),
    ok: [true, true, true],
  },
  {
    name: 'amending a box that was already correct as filed',
    answers: answers({ type: wrote('B752/L') }),
    result: result(),
    ok: [false, true, true],
  },
  {
    name: 'every amended box written the way the engine proposes it',
    answers: answers({
      type: wrote('B752/L'),
      altitude: wrote('27000'),
      route: wrote('SFO5 MOGEE BVL'),
    }),
    result: result(TYPE, ALTITUDE, ROUTE),
    ok: [true, true, true],
  },
  {
    name: 'an amended box left as filed',
    answers: answers(),
    result: result(TYPE, ALTITUDE, ROUTE),
    ok: [false, false, false],
  },
  {
    name: 'an amended box written with the wrong value',
    answers: answers({ altitude: wrote('FL290') }),
    result: result(ALTITUDE),
    ok: [true, false, true],
  },
  {
    name: 'an altitude written as a flight level, a type spaced out, a route cased and spaced',
    answers: answers({
      type: wrote('b752 /L'),
      altitude: wrote('FL270'),
      route: wrote('sfo5  mogee   bvl'),
    }),
    result: result(TYPE, ALTITUDE, ROUTE),
    ok: [true, true, true],
  },
  {
    name: 'an alternative pair fixed on the type box alone',
    answers: answers({ type: wrote('B752/L') }),
    result: result(PAIRED_TYPE, PAIRED_ROUTE),
    ok: [true, true, true],
  },
  {
    name: 'an alternative pair fixed on the route box alone',
    answers: answers({ route: wrote('SFO5 MOGEE BVL') }),
    result: result(PAIRED_TYPE, PAIRED_ROUTE),
    ok: [true, true, true],
  },
  {
    name: 'an alternative pair fixed on both boxes, which is a miss on the second',
    answers: answers({ type: wrote('B752/L'), route: wrote('SFO5 MOGEE BVL') }),
    result: result(PAIRED_TYPE, PAIRED_ROUTE),
    ok: [true, true, false],
  },
  {
    name: 'an alternative pair fixed on neither box',
    answers: answers(),
    result: result(PAIRED_TYPE, PAIRED_ROUTE),
    ok: [false, true, false],
  },
  {
    name: 'an alternative pair fixed on the type box with the route box amended wrongly',
    answers: answers({ type: wrote('B752/L'), route: wrote('TRUKN2 MOGEE BVL') }),
    result: result(PAIRED_TYPE, PAIRED_ROUTE),
    ok: [true, true, false],
  },
];

describe('gradeBoxes', () => {
  for (const testCase of cases) {
    it(`grades ${testCase.name}`, () => {
      const grades = gradeBoxes(testCase.answers, testCase.result, ksfo);
      expect(grades.map((grade) => grade.box)).toEqual(['type', 'altitude', 'route']);
      expect(grades.map((grade) => grade.verdict)).toEqual(testCase.ok.map(verdictOf));
    });
  }

  it('labels a box that needed no amendment as correct as filed', () => {
    const [type] = gradeBoxes(answers(), result(), ksfo);
    expect(type?.expectedLabel).toBe('correct as filed');
    expect(type?.actualLabel).toBe('correct as filed');
    expect(type?.citations).toEqual([]);
  });

  it('labels an amended box with the proposal as the strip writes it', () => {
    const grades = gradeBoxes(
      answers({ type: wrote('B752/Q'), altitude: wrote('FL290') }),
      result(TYPE, ALTITUDE, ROUTE),
      ksfo,
    );
    expect(grades.map((grade) => grade.expectedLabel)).toEqual([
      'B752/L',
      'FL270',
      'SFO5 MOGEE BVL',
    ]);
    expect(grades.map((grade) => grade.actualLabel)).toEqual([
      'B752/Q',
      'FL290',
      'correct as filed',
    ]);
    expect(grades.map((grade) => grade.citations)).toEqual([[citation], [citation], [citation]]);
  });

  it('labels the second box of a pair with the box that already fixes it', () => {
    const grades = gradeBoxes(
      answers({ type: wrote('B752/L'), route: wrote('SFO5 MOGEE BVL') }),
      result(PAIRED_TYPE, PAIRED_ROUTE),
      ksfo,
    );
    expect(grades[0]?.expectedLabel).toBe('B752/L');
    expect(grades[2]?.expectedLabel).toBe('correct as filed (the other box already fixes this)');
    expect(grades[2]?.citations).toEqual([citation]);
  });

  it('labels both boxes of a pair with their proposals while neither carries the fix', () => {
    const grades = gradeBoxes(answers(), result(PAIRED_TYPE, PAIRED_ROUTE), ksfo);
    expect(grades[0]?.expectedLabel).toBe('B752/L');
    expect(grades[2]?.expectedLabel).toBe('SFO5 MOGEE BVL');
  });
});

describe('gradeBoxes vector-SID navaid', () => {
  /** The corrected plan of a flight on the SFO5, whose box files the navaid the SID is filed with. */
  const NAVAID_CORRECTED: Scenario = { ...CORRECTED, filedRoute: 'SFO5 SFO MOGEE BVL' };

  /** The warning the engine raises for a box that files the vector SID without the navaid. */
  const NAVAID_ROUTE: ResolvedAmendment = {
    box: 'route',
    proposed: 'SFO5 SFO MOGEE BVL',
    reason:
      'the route names SFO5 without SFO after it; a radar-vector SID is filed as the SID, the ' +
      'airport navaid, then the route (R-RV-NAVAID)',
    warning: true,
    citations: [],
  };

  function navaidResult(
    ...amendments: ResolvedAmendment[]
  ): Extract<AmendmentResult, { ok: true }> {
    return { ok: true, amendments, corrected: NAVAID_CORRECTED };
  }

  it('accepts a route box that leaves the navaid out of the route the engine wrote', () => {
    const grades = gradeBoxes(
      answers({ route: wrote('SFO5 MOGEE BVL') }),
      navaidResult(NAVAID_ROUTE),
      ksfo,
    );
    expect(grades[2]?.verdict).toBe('acceptable');
    expect(grades[2]?.citations.map((cited) => cited.id)).toEqual(['R-RV-NAVAID']);
  });

  it('accepts a route box that writes the navaid into a route the engine wrote without it', () => {
    const grades = gradeBoxes(answers({ route: wrote('SFO5 SFO MOGEE BVL') }), result(), ksfo);
    expect(grades[2]?.verdict).toBe('acceptable');
    expect(grades[2]?.citations.map((cited) => cited.id)).toEqual(['R-RV-NAVAID']);
  });

  it('accepts the box of a warning amendment the student left as filed', () => {
    const grades = gradeBoxes(answers(), navaidResult(NAVAID_ROUTE), ksfo);
    expect(grades[2]?.verdict).toBe('acceptable');
    expect(grades[2]?.actualLabel).toBe('correct as filed');
  });

  it('still counts the box correct where the student writes the navaid in', () => {
    const grades = gradeBoxes(
      answers({ route: wrote('SFO5 SFO MOGEE BVL') }),
      navaidResult(NAVAID_ROUTE),
      ksfo,
    );
    expect(grades[2]?.verdict).toBe('correct');
  });

  it('marks a route box wrong where more than the navaid separates it from the route', () => {
    const grades = gradeBoxes(
      answers({ route: wrote('SFO5 SFO BVL') }),
      navaidResult(NAVAID_ROUTE),
      ksfo,
    );
    expect(grades[2]?.verdict).toBe('wrong');
  });
});

describe('boxGradeAsGrade', () => {
  it('reports a box under the element the results view names it by', () => {
    const verdict = boxGradeAsGrade({
      box: 'altitude',
      verdict: 'wrong',
      expectedLabel: 'FL270',
      actualLabel: 'correct as filed',
      citations: [citation],
    });
    expect(verdict).toStrictEqual({
      element: 'BOX.altitude',
      verdict: 'wrong',
      expectedLabel: 'FL270',
      actualLabel: 'correct as filed',
      citations: [citation],
    });
  });

  it('names every box', () => {
    const elements = (['type', 'altitude', 'route'] as const).map(
      (box) =>
        boxGradeAsGrade({
          box,
          verdict: 'correct',
          expectedLabel: '',
          actualLabel: '',
          citations: [],
        }).element,
    );
    expect(elements).toStrictEqual(['BOX.type', 'BOX.altitude', 'BOX.route']);
  });
});

describe('the normalisers', () => {
  it('compares a route as its tokens', () => {
    expect(normaliseRoute('  trukn2   dedhd rbl ')).toBe('TRUKN2 DEDHD RBL');
    expect(normaliseRoute('')).toBe('');
  });

  it('compares a type with its whitespace taken out', () => {
    expect(normaliseType(' b752 / l ')).toBe('B752/L');
  });

  it('reads every form an altitude is written in', () => {
    expect(parseAltitude('32000')).toBe(32000);
    expect(parseAltitude('32,000')).toBe(32000);
    expect(parseAltitude('FL320')).toBe(32000);
    expect(parseAltitude('fl 320')).toBe(32000);
    expect(parseAltitude('320')).toBe(32000);
    expect(parseAltitude('3000')).toBe(3000);
  });

  it('reads nothing else as an altitude', () => {
    expect(parseAltitude('')).toBeUndefined();
    expect(parseAltitude('90')).toBeUndefined();
    expect(parseAltitude('FL32')).toBeUndefined();
    expect(parseAltitude('FL3200')).toBeUndefined();
    expect(parseAltitude('320000')).toBeUndefined();
    expect(parseAltitude('one zero thousand')).toBeUndefined();
    expect(parseAltitude('32000 ft')).toBeUndefined();
  });
});
