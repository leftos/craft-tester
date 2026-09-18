import { describe, expect, it } from 'vitest';
import koakJson from '@data/koak.json';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { resolveAmendments } from '@/rules/amend/engine.ts';
import type { BoxAnswer, BoxAnswers } from '@/rules/amend/grade.ts';
import {
  boxGradeAsGrade,
  gradeBoxes,
  normaliseRoute,
  normaliseType,
  parseAltitude,
  studentPlan,
} from '@/rules/amend/grade.ts';
import type { AmendmentResult, ResolvedAmendment } from '@/rules/amend/types.ts';
import { formatAltitude, verdictOf } from '@/rules/grade.ts';
import type { RuleCitation } from '@/rules/types.ts';

const ksfo = ksfoJson as unknown as AirportData;
const koak = koakJson as unknown as AirportData;

const citation: RuleCitation = {
  id: 'EQUIP/L',
  source: 'FAA JO 7110.65 TBL 2-3-10',
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

/** The plan as filed, which is the box a student who amended nothing wrote. */
const FILED: Scenario = {
  ...CORRECTED,
  equipmentSuffix: '/Q',
  filedRoute: 'TRUKN2 MOGEE BVL',
  filedAltitude: 33000,
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

/** The wider pair: the type box against both the altitude box and the route box behind it. */
const TRIPLE_TYPE: ResolvedAmendment = { ...TYPE, alternativeTo: 'altitude' };
const TRIPLE_ALTITUDE: ResolvedAmendment = { ...ALTITUDE, alternativeTo: 'type' };

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
      const grades = gradeBoxes(testCase.answers, testCase.result, FILED, ksfo);
      expect(grades.map((grade) => grade.box)).toEqual(['type', 'altitude', 'route']);
      expect(grades.map((grade) => grade.verdict)).toEqual(testCase.ok.map(verdictOf));
    });
  }

  it('carries the reason of the amendment each box was graded against', () => {
    const grades = gradeBoxes(answers(), result(TYPE, ALTITUDE, ROUTE), FILED, ksfo);
    expect(grades.map((grade) => grade.reason)).toEqual([
      'suffix /Q is not in the table',
      'FL330 is inside RVSM airspace',
      'TRUKN2 is not the procedure the SOP assigns',
    ]);
  });

  it('carries no reason for a box the engine raised no amendment for', () => {
    const grades = gradeBoxes(answers(), result(ALTITUDE), FILED, ksfo);
    expect(grades.map((grade) => grade.reason)).toEqual([
      undefined,
      'FL330 is inside RVSM airspace',
      undefined,
    ]);
  });

  it('labels a box that needed no amendment as correct as filed', () => {
    const [type] = gradeBoxes(answers(), result(), FILED, ksfo);
    expect(type?.expectedLabel).toBe('correct as filed');
    expect(type?.actualLabel).toBe('correct as filed');
    expect(type?.citations).toEqual([]);
  });

  it('labels an amended box with the proposal as the strip writes it', () => {
    const grades = gradeBoxes(
      answers({ type: wrote('B752/Q'), altitude: wrote('FL290') }),
      result(TYPE, ALTITUDE, ROUTE),
      FILED,
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
      FILED,
      ksfo,
    );
    expect(grades[0]?.expectedLabel).toBe('B752/L');
    expect(grades[2]?.expectedLabel).toBe('correct as filed (the other box already fixes this)');
    expect(grades[2]?.citations).toEqual([citation]);
  });

  it('labels both boxes of a pair with their proposals while neither carries the fix', () => {
    const grades = gradeBoxes(answers(), result(PAIRED_TYPE, PAIRED_ROUTE), FILED, ksfo);
    expect(grades[0]?.expectedLabel).toBe('B752/L');
    expect(grades[2]?.expectedLabel).toBe('SFO5 MOGEE BVL');
  });

  it('expects the route and altitude boxes as filed once the type box carries the RNAV fix', () => {
    const grades = gradeBoxes(
      answers({ type: wrote('B752/L') }),
      result(TRIPLE_TYPE, TRIPLE_ALTITUDE, PAIRED_ROUTE),
      FILED,
      ksfo,
    );
    expect(grades.map((grade) => grade.verdict)).toEqual(['correct', 'correct', 'correct']);
    expect(grades[1]?.expectedLabel).toBe('correct as filed (the other box already fixes this)');
    expect(grades[2]?.expectedLabel).toBe('correct as filed (the other box already fixes this)');
  });

  it('expects the type box as filed once both other boxes carry the fix', () => {
    const grades = gradeBoxes(
      answers({ altitude: wrote('27000'), route: wrote('SFO5 MOGEE BVL') }),
      result(TRIPLE_TYPE, TRIPLE_ALTITUDE, PAIRED_ROUTE),
      FILED,
      ksfo,
    );
    expect(grades.map((grade) => grade.verdict)).toEqual(['correct', 'correct', 'correct']);
    expect(grades[0]?.expectedLabel).toBe('correct as filed (the other box already fixes this)');
  });

  it('grades the type and route boxes against their proposals when only the altitude was fixed', () => {
    const grades = gradeBoxes(
      answers({ altitude: wrote('27000') }),
      result(TRIPLE_TYPE, TRIPLE_ALTITUDE, PAIRED_ROUTE),
      FILED,
      ksfo,
    );
    expect(grades.map((grade) => grade.verdict)).toEqual(['wrong', 'correct', 'wrong']);
    expect(grades[0]?.expectedLabel).toBe('B752/L');
    expect(grades[2]?.expectedLabel).toBe('SFO5 MOGEE BVL');
  });
});

describe('an amend-to answer written the way the strip writes the box', () => {
  it('reads an altitude box as the strip prints it, in feet and as a flight level', () => {
    expect(parseAltitude(formatAltitude(9000))).toBe(9000);
    expect(parseAltitude(formatAltitude(29_000))).toBe(29_000);
    expect(parseAltitude('9,000')).toBe(9000);
    expect(parseAltitude('FL290')).toBe(29_000);
  });

  it('grades every box right when the value it carries is the one the engine proposes', () => {
    const grades = gradeBoxes(
      answers({
        type: wrote('B738/L'),
        altitude: wrote(formatAltitude(9000)),
        route: wrote('SFO5 MOGEE BVL'),
      }),
      result(
        { ...TYPE, proposed: 'B738/L' },
        { ...ALTITUDE, proposedFeet: 9000 },
        { ...ROUTE, proposed: 'SFO5 MOGEE BVL' },
      ),
      FILED,
      ksfo,
    );
    expect(grades.map((grade) => grade.verdict)).toEqual(['correct', 'correct', 'correct']);
    expect(grades.map((grade) => grade.actualLabel)).toEqual(['B738/L', '9,000', 'SFO5 MOGEE BVL']);
  });

  it('grades a flight level the strip writes right too', () => {
    const grades = gradeBoxes(
      answers({ altitude: wrote(formatAltitude(29_000)) }),
      result({ ...ALTITUDE, proposedFeet: 29_000 }),
      FILED,
      ksfo,
    );
    expect(grades[1]?.verdict).toBe('correct');
    expect(grades[1]?.actualLabel).toBe('FL290');
  });
});

describe('studentPlan', () => {
  it('is the corrected plan when every box reads the proposal', () => {
    const graded = result(TYPE, ALTITUDE, ROUTE);
    const plan = studentPlan(
      answers({ type: wrote('B752/L'), altitude: wrote('FL270'), route: wrote('SFO5 MOGEE BVL') }),
      graded,
      FILED,
      ksfo,
    );
    expect(plan).toEqual(graded.corrected);
  });

  it('keeps the filed type and takes the route where the route side of a pair carries the fix', () => {
    const graded: Extract<AmendmentResult, { ok: true }> = {
      ok: true,
      amendments: [PAIRED_TYPE, PAIRED_ROUTE],
      corrected: { ...FILED, equipmentSuffix: '/L' },
    };
    const plan = studentPlan(answers({ route: wrote('SFO5 MOGEE BVL') }), graded, FILED, ksfo);
    expect(plan.equipmentSuffix).toBe(FILED.equipmentSuffix);
    expect(plan.filedRoute).toBe(PAIRED_ROUTE.proposed);
    expect(plan).not.toEqual(graded.corrected);
  });

  it('takes the corrected altitude where the altitude box was answered wrong', () => {
    const graded = result(ALTITUDE);
    const plan = studentPlan(answers({ altitude: wrote('FL310') }), graded, FILED, ksfo);
    expect(plan.filedAltitude).toBe(graded.corrected.filedAltitude);
    expect(plan).toEqual({ ...FILED, filedAltitude: graded.corrected.filedAltitude });
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
      FILED,
      ksfo,
    );
    expect(grades[2]?.verdict).toBe('acceptable');
    expect(grades[2]?.citations.map((cited) => cited.id)).toEqual(['R-RV-NAVAID']);
  });

  it('accepts a route box that writes the navaid into a route the engine wrote without it', () => {
    const grades = gradeBoxes(
      answers({ route: wrote('SFO5 SFO MOGEE BVL') }),
      result(),
      FILED,
      ksfo,
    );
    expect(grades[2]?.verdict).toBe('acceptable');
    expect(grades[2]?.citations.map((cited) => cited.id)).toEqual(['R-RV-NAVAID']);
  });

  it('accepts the box of a warning amendment the student left as filed', () => {
    const grades = gradeBoxes(answers(), navaidResult(NAVAID_ROUTE), FILED, ksfo);
    expect(grades[2]?.verdict).toBe('acceptable');
    expect(grades[2]?.actualLabel).toBe('correct as filed');
  });

  it('still counts the box correct where the student writes the navaid in', () => {
    const grades = gradeBoxes(
      answers({ route: wrote('SFO5 SFO MOGEE BVL') }),
      navaidResult(NAVAID_ROUTE),
      FILED,
      ksfo,
    );
    expect(grades[2]?.verdict).toBe('correct');
  });

  it('marks a route box wrong where more than the navaid separates it from the route', () => {
    const grades = gradeBoxes(
      answers({ route: wrote('SFO5 SFO BVL') }),
      navaidResult(NAVAID_ROUTE),
      FILED,
      ksfo,
    );
    expect(grades[2]?.verdict).toBe('wrong');
  });

  it('clears the route with the navaid where the route box was acceptable without it', () => {
    const plan = studentPlan(
      answers({ route: wrote('SFO5 MOGEE BVL') }),
      navaidResult(NAVAID_ROUTE),
      FILED,
      ksfo,
    );
    expect(plan.filedRoute).toBe(NAVAID_CORRECTED.filedRoute);
  });
});

describe('gradeBoxes arrival routing', () => {
  /** The plan as filed, bound for Los Angeles over the arrival the proposal swaps away from. */
  const ARRIVAL_FILED: Scenario = {
    ...FILED,
    destination: 'KLAX',
    filedRoute: 'SSTIK5 EBAYE AVE SADDE8',
  };

  /** The proposal, which adds the transition the SOP forces and swaps the arrival behind it. */
  const ARRIVAL_ROUTE: ResolvedAmendment = {
    box: 'route',
    proposed: 'SSTIK5 SUSEY EBAYE BURGL IRNMN2',
    arrivalSwap: 'SSTIK5 SUSEY EBAYE AVE SADDE8',
    reason: 'the arrival the destination publishes for this entry is IRNMN2',
    citations: [citation],
  };

  function arrivalResult(amendment: ResolvedAmendment): Extract<AmendmentResult, { ok: true }> {
    const proposed = amendment.box === 'route' ? amendment.proposed : ARRIVAL_FILED.filedRoute;
    return {
      ok: true,
      amendments: [amendment],
      corrected: { ...ARRIVAL_FILED, filedRoute: proposed },
    };
  }

  it('gives half credit for the pre-change box written into the route box', () => {
    const grades = gradeBoxes(
      answers({ route: wrote('SSTIK5 SUSEY EBAYE AVE SADDE8') }),
      arrivalResult(ARRIVAL_ROUTE),
      ARRIVAL_FILED,
      ksfo,
    );
    expect(grades[2]?.verdict).toBe('half');
    expect(grades[2]?.expectedLabel).toBe('SSTIK5 SUSEY EBAYE BURGL IRNMN2');
    expect(grades[2]?.citations).toEqual([citation]);
  });

  it('gives half credit for a route box left as filed when the pre-change box is the filed route', () => {
    const grades = gradeBoxes(
      answers(),
      arrivalResult({ ...ARRIVAL_ROUTE, arrivalSwap: ARRIVAL_FILED.filedRoute }),
      ARRIVAL_FILED,
      ksfo,
    );
    expect(grades[2]?.verdict).toBe('half');
    expect(grades[2]?.actualLabel).toBe('correct as filed');
  });

  it('gives half credit for the pre-change box written without the vector navaid', () => {
    const filed: Scenario = { ...ARRIVAL_FILED, filedRoute: 'SFO5 SFO MOGEE SADDE8' };
    const amendment: ResolvedAmendment = {
      ...ARRIVAL_ROUTE,
      proposed: 'SFO5 SFO MOGEE BURGL IRNMN2',
      arrivalSwap: 'SFO5 SFO MOGEE SADDE8',
    };
    const grades = gradeBoxes(
      answers({ route: wrote('SFO5 MOGEE SADDE8') }),
      {
        ok: true,
        amendments: [amendment],
        corrected: { ...filed, filedRoute: 'SFO5 SFO MOGEE BURGL IRNMN2' },
      },
      filed,
      ksfo,
    );
    expect(grades[2]?.verdict).toBe('half');
  });

  it('still marks a route box wrong when the answer is neither the proposal nor the pre-change box', () => {
    const grades = gradeBoxes(
      answers({ route: wrote('SSTIK5 SUSEY EBAYE BURGL SADDE8') }),
      arrivalResult(ARRIVAL_ROUTE),
      ARRIVAL_FILED,
      ksfo,
    );
    expect(grades[2]?.verdict).toBe('wrong');
  });

  it('clears the corrected route where the route box earned half credit', () => {
    const graded = arrivalResult(ARRIVAL_ROUTE);
    const plan = studentPlan(
      answers({ route: wrote('SSTIK5 SUSEY EBAYE AVE SADDE8') }),
      graded,
      ARRIVAL_FILED,
      ksfo,
    );
    expect(plan.filedRoute).toBe(graded.corrected.filedRoute);
  });
});

describe('gradeBoxes one-way airway', () => {
  /** FDX3875 of Amendment Practice 2: an MD11 to Honolulu on the oceanic R464, westbound at FL310. */
  const FDX3875: Scenario = {
    callsign: 'FDX3875',
    aircraftType: 'MD11',
    equipmentSuffix: '/L',
    destination: 'PHNL',
    filedRoute: 'BEBOP R464 BILLO R464 BITTA MAGGI3',
    filedAltitude: 31000,
    runwayConfigId: 'SFOW',
    departureRunway: '30',
    localTime: '1400',
    dayOfWeek: 'tuesday',
    squawk: '4613',
  };

  /** The boxes of FDX3875, every one answered as filed, graded against what the engine resolves. */
  function asFiledGrades(airport: AirportData) {
    const resolved = resolveAmendments(FDX3875, airport);
    if (!resolved.ok) throw new Error(resolved.unresolved.map((item) => item.reason).join('; '));
    return gradeBoxes(answers(), resolved, FDX3875, airport);
  }

  it('cites the one-way airway row on an altitude box left as filed on R464', () => {
    const grades = asFiledGrades(koak);
    expect(grades[1]?.verdict).toBe('correct');
    expect(grades[1]?.citations.map((cited) => cited.id)).toEqual(['A-ONE-WAY-AIRWAY']);
  });

  it('cites no one-way row on the altitude box when the airway is two-way', () => {
    const twoWay: AirportData = {
      ...koak,
      airways: koak.airways.map((row) => ({ ...row, oneWay: false })),
    };
    const grades = asFiledGrades(twoWay);
    const cited = grades[1]?.citations.map((citation) => citation.id);
    expect(cited).not.toContain('A-ONE-WAY-AIRWAY');
    expect(grades[1]?.verdict).toBe('wrong');
    expect(cited).toContain('A-PARITY');
  });

  it('cites no one-way row on the route or type box', () => {
    const grades = asFiledGrades(koak);
    expect(grades[0]?.citations.map((cited) => cited.id)).not.toContain('A-ONE-WAY-AIRWAY');
    expect(grades[2]?.citations.map((cited) => cited.id)).not.toContain('A-ONE-WAY-AIRWAY');
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
      reason: 'FL330 is inside RVSM airspace',
    });
    expect(verdict).toStrictEqual({
      element: 'BOX.altitude',
      verdict: 'wrong',
      expectedLabel: 'FL270',
      actualLabel: 'correct as filed',
      citations: [citation],
      reason: 'FL330 is inside RVSM airspace',
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
          reason: undefined,
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
