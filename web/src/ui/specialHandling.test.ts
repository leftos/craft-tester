import { describe, expect, it } from 'vitest';
import koakJson from '@data/koak.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { resolveAmendedClearance, resolveAmendments } from '@/rules/amend/engine.ts';
import type { BoxAnswers } from '@/rules/amend/grade.ts';
import { boxGradeAsGrade, gradeBoxes } from '@/rules/amend/grade.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { grade } from '@/rules/grade.ts';
import { citeSpecialHandling, gradeBest, hasSpecialHandling } from '@/rules/handling.ts';
import type { Grade, PlayerPicks, ResolvedClearance } from '@/rules/types.ts';
import { amendmentGrades } from '@/ui/amendPanels.ts';
import type { ScenarioView } from '@/ui/session.ts';
import { acceptedClearance, clearedPlan } from '@/ui/session.ts';

const koak = koakJson as unknown as AirportData;

/** The special-handling row of ZOA CPS-004 3.1. */
const CPS004 = 'ZOA-CPS004-SPECIAL-AIRCRAFT';

/** Every box left as the pilot filed it. */
const AS_FILED: BoxAnswers = {
  type: { kind: 'as_filed' },
  altitude: { kind: 'as_filed' },
  route: { kind: 'as_filed' },
};

/** A KOAK SFOW departure to KSMF on the jet TEC row, as the clearance drill draws it. */
function ksmfPlan(overrides: Partial<Scenario>): Scenario {
  return {
    callsign: 'QXE2451',
    aircraftType: 'DH8D',
    equipmentSuffix: '/L',
    destination: 'KSMF',
    filedRoute: 'OAK6 OAK FEVTA FEVTA1',
    filedAltitude: 10000,
    runwayConfigId: 'SFOW',
    departureRunway: '30',
    localTime: '1400',
    dayOfWeek: 'tuesday',
    squawk: '4521',
    ...overrides,
  };
}

/** The clearance a plan resolves to under the proposed handling. */
function proposedClearance(plan: Scenario): ResolvedClearance {
  const result = resolveClearance(plan, koak, 'proposed');
  if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
  return result.clearance;
}

/** The expect pick that reads a clearance's expect clause. */
function expectPick(clearance: ResolvedClearance): PlayerPicks['expect'] {
  const clause = clearance.expect.value;
  if (clause === null) return 'none';
  if (clause.kind === 'final') return 'final';
  const byMinutes: Record<number, PlayerPicks['expect']> = {
    10: 'ten_minutes',
    5: 'five_minutes',
    3: 'three_minutes',
  };
  const pick = byMinutes[clause.minutes];
  if (pick === undefined) throw new Error(`no expect pick reads ${clause.minutes} minutes`);
  return pick;
}

/** The picks that read a clearance exactly. */
function picksFor(clearance: ResolvedClearance): PlayerPicks {
  const route = clearance.route.value;
  const altitude = clearance.altitude.value;
  return {
    routeTemplate: route.template,
    ...(route.fix === undefined ? {} : { routeFix: route.fix }),
    altitudePhrase: altitude.phrase,
    ...(altitude.feet === undefined ? {} : { altitudeFeet: altitude.feet }),
    expect: expectPick(clearance),
    frequency: clearance.frequency.value.value,
    runway: clearance.runway.value,
  };
}

/** Whether a grade cites the special-handling row. */
function citesCps004(one: Grade): boolean {
  return one.citations.some((citation) => citation.id === CPS004);
}

/** Grades picks for a plan as clearance mode does: against both handlings, the better one kept. */
function gradeClearance(plan: Scenario, picks: PlayerPicks) {
  return gradeBest(
    proposedClearance(plan),
    acceptedClearance(plan, koak),
    (resolved) => grade(picks, resolved),
    citeSpecialHandling(plan, koak),
  );
}

describe('clearance mode for a type ZOA CPS-004 3.1 hands special handling', () => {
  const plan = ksmfPlan({});
  const jet = proposedClearance(plan);
  const turboprop = acceptedClearance(plan, koak);

  it('resolves the DH8D on the jet TEC row, and on the turboprop row under the accepted handling', () => {
    expect(jet.altitude.value.feet).toBe(10000);
    expect(turboprop?.altitude.value.feet).toBe(3000);
  });

  it('grades the jet reading right without citing the special handling', () => {
    const best = gradeClearance(plan, picksFor(jet));
    expect(best.handling).toBe('proposed');
    expect(best.grades.map((one) => one.verdict)).toStrictEqual(best.grades.map(() => 'correct'));
    expect(best.grades.some(citesCps004)).toBe(false);
  });

  it('grades the turboprop reading right, citing the special handling', () => {
    if (turboprop === null) throw new Error('the DH8D has no accepted clearance');
    const best = gradeClearance(plan, picksFor(turboprop));
    expect(best.handling).toBe('accepted');
    expect(best.resolved).toStrictEqual(turboprop);
    expect(best.grades.map((one) => one.verdict)).toStrictEqual(best.grades.map(() => 'correct'));
    expect(best.grades.filter(citesCps004).map((one) => one.element)).toContain('A.phrase');
  });

  it('reads the filed route under both handlings, so the readings part on the altitude alone', () => {
    if (turboprop === null) throw new Error('the DH8D has no accepted clearance');
    const { altitudePhrase: _jetPhrase, altitudeFeet: _jetFeet, ...jetRest } = picksFor(jet);
    const { altitudePhrase: _phrase, altitudeFeet: _feet, ...turbopropRest } = picksFor(turboprop);
    expect(turbopropRest).toStrictEqual(jetRest);
    const best = gradeClearance(plan, picksFor(turboprop));
    expect(best.grades.filter(citesCps004).map((one) => one.element)).toStrictEqual(['A.phrase']);
  });

  it('grades the jet altitude phrase with the turboprop altitude wrong under both handlings', () => {
    if (turboprop === null) throw new Error('the DH8D has no accepted clearance');
    const mixed: PlayerPicks = { ...picksFor(jet), altitudeFeet: 3000 };
    const best = gradeClearance(plan, mixed);
    expect(best.handling).toBe('proposed');
    expect(best.grades.find((one) => one.element === 'A.phrase')?.verdict).toBe('wrong');
  });

  it('computes no accepted clearance for a B738, which grades as the proposed clearance alone', () => {
    const b738 = ksmfPlan({ callsign: 'SWA1', aircraftType: 'B738' });
    const clearance = proposedClearance(b738);
    expect(acceptedClearance(b738, koak)).toBeNull();
    const best = gradeClearance(b738, picksFor(clearance));
    expect(best.handling).toBe('proposed');
    expect(best.grades).toStrictEqual(grade(picksFor(clearance), clearance));
  });
});

/** An amendment session drawn for a filed plan, as `buildScenario` would draw it. */
function amendmentView(filed: Scenario): Extract<ScenarioView, { kind: 'amendment' }> {
  const result = resolveAmendments(filed, koak, 'proposed');
  if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
  const accepted = resolveAmendments(filed, koak, 'accepted');
  const special = hasSpecialHandling(filed, koak);
  const cleared = resolveAmendedClearance(filed, result.corrected, koak, 'proposed');
  if (!cleared.ok) throw new Error(cleared.unresolved.map((item) => item.reason).join('; '));
  return {
    kind: 'amendment',
    drawn: { filed, result, acceptedResult: special && accepted.ok ? accepted : null, faults: [] },
    clearance: cleared.clearance,
  };
}

describe('amendment mode for a type ZOA CPS-004 3.1 hands special handling', () => {
  /** A KOAK C510 filed to KSMF on the turboprop TEC row. */
  const filed = ksmfPlan({
    callsign: 'N510CJ',
    aircraftType: 'C510',
    filedRoute: 'NIMI6 OAK V6 SAC',
    filedAltitude: 9000,
  });

  it('grades the route left as filed right under the accepted handling', () => {
    const cleared = clearedPlan(amendmentView(filed), AS_FILED, koak);
    expect(cleared.handling).toBe('accepted');
    const route = cleared.boxes.find((one) => one.element === 'BOX.route');
    expect(route?.verdict).not.toBe('wrong');
    expect(cleared.boxes.some(citesCps004)).toBe(true);
  });

  it('shows and grades the accepted clearance once the boxes chose the accepted handling', () => {
    const view = amendmentView(filed);
    const cleared = clearedPlan(view, AS_FILED, koak);
    const accepted = resolveAmendedClearance(filed, cleared.plan, koak, 'accepted');
    if (!accepted.ok) throw new Error('the C510 plan has no accepted clearance');
    expect(cleared.plan.filedRoute).toBe(filed.filedRoute);
    expect(cleared.clearance).toStrictEqual(accepted.clearance);
    const grades = amendmentGrades({
      drawn: view.drawn,
      cleared,
      airport: koak,
      answer: {
        input: 'dropdowns',
        picks: { ...picksFor(accepted.clearance), procedure: 'NIMI6' },
      },
      routeReading: 'abbreviated',
    });
    const clearanceGrades = grades.filter((one) => !one.element.startsWith('BOX.'));
    expect(clearanceGrades.map((one) => `${one.element} ${one.verdict}`)).toStrictEqual(
      clearanceGrades.map((one) => `${one.element} correct`),
    );
  });

  it('keeps a B738 on the proposed handling, graded exactly as before', () => {
    const b738 = ksmfPlan({ callsign: 'SWA1', aircraftType: 'B738', filedAltitude: 11000 });
    const view = amendmentView(b738);
    expect(view.drawn.acceptedResult).toBeNull();
    const cleared = clearedPlan(view, AS_FILED, koak);
    expect(cleared.handling).toBe('proposed');
    expect(cleared.boxes).toStrictEqual(
      gradeBoxes(AS_FILED, view.drawn.result, b738, koak).map(boxGradeAsGrade),
    );
  });
});
