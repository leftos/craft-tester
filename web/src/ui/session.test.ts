import { beforeAll, describe, expect, it } from 'vitest';
import type { AirportData, Amendment } from '@/data/schema.ts';
import type { Box, BoxAnswer, BoxAnswers } from '@/rules/amend/grade.ts';
import { formatAltitude, grade } from '@/rules/grade.ts';
import type { Mode, ScenarioFilter, SessionSettings } from '@/scenario/filter.ts';
import { ANY_SCENARIO } from '@/scenario/filter.ts';
import type { ResolvedClearance } from '@/rules/types.ts';
import { amendmentGrades } from '@/ui/amendPanels.ts';
import { activeNotices, atisRows } from '@/ui/atis.ts';
import { craftGroups } from '@/ui/craftForm.ts';
import type { CraftField, CraftGroup } from '@/ui/craftForm.ts';
import { buildScenario, listAirports, loadAirportData, spokenFor } from '@/ui/session.ts';
import type { ScenarioView } from '@/ui/session.ts';
import type { AppState, PickKey } from '@/ui/state.ts';
import { newSession, toPlayerPicks, withPick, withSubmitted } from '@/ui/state.ts';
import { stripFields } from '@/ui/strip.ts';

/** The seed the wiring test renders, which is the one the report quotes. */
const SEED = 1;

let airport: AirportData;
let view: ScenarioView;

/** The settings of a session answered with the dropdowns. */
function dropdowns(filter: ScenarioFilter, mode: Mode): SessionSettings {
  return { filter, mode, input: 'dropdowns' };
}

/**
 * The strip answered the way the engine corrected it: each box the engine amended holds its
 * proposal, written as the results view expects it, and every other box is left as filed.
 */
function correctedAnswers(amendments: readonly Amendment[]): BoxAnswers {
  const answer = (box: Box): BoxAnswer => {
    const amendment = amendments.find((candidate) => candidate.box === box);
    if (amendment === undefined) return { kind: 'as_filed' };
    const value =
      amendment.box === 'altitude' ? formatAltitude(amendment.proposedFeet) : amendment.proposed;
    return { kind: 'amended', value };
  };
  return { type: answer('type'), altitude: answer('altitude'), route: answer('route') };
}

/** The clearance of the seeded scenario, or a failure naming why the engine issued none. */
function clearanceOf(scenarioView: ScenarioView): ResolvedClearance {
  if (scenarioView.kind === 'unresolved') {
    throw new Error(`seed ${SEED} resolved to nothing: ${scenarioView.reasons.join('; ')}`);
  }
  return scenarioView.clearance;
}

/** The dropdown values that spell out the clearance the engine resolved, in the order to pick them. */
/** The expect pick that answers the clause the engine resolved. */
function expectAnswer(clause: ResolvedClearance['expect']['value']): string {
  if (clause === null) return 'none';
  if (clause.kind === 'final') return 'final';
  return clause.minutes === 10 ? 'ten_minutes' : 'three_minutes';
}

function answerFor(clearance: ResolvedClearance): [PickKey, string][] {
  const expectValue = clearance.expect.value;
  const feet = clearance.altitude.value.feet;
  const answers: [PickKey, string][] = [
    ['routeTemplate', clearance.route.value.template],
    ['routeFix', clearance.route.value.fix ?? ''],
    ['altitudePhrase', clearance.altitude.value.phrase],
    ['expect', expectAnswer(expectValue)],
    ['frequency', clearance.frequency.value.value],
    ['runway', clearance.runway.value],
  ];
  if (feet === undefined) return answers;
  return [...answers, ['altitudeFeet', String(feet)]];
}

/** Every row of the form, in the order CRAFT speaks them. */
function groupsOf(state: AppState): readonly CraftGroup[] {
  if (state.view.kind !== 'clearance')
    throw new Error('the seeded scenario is not a clean clearance');
  return craftGroups(
    state.view.generated,
    state.airport,
    state.view.clearance,
    state.picks,
    'given',
  );
}

/** Every dropdown of the form, flattened out of its CRAFT groups. */
function fieldsOf(state: AppState): CraftField[] {
  return groupsOf(state).flatMap((group) => (group.kind === 'picked' ? [...group.fields] : []));
}

beforeAll(async () => {
  airport = await loadAirportData('KSFO');
  view = buildScenario(airport, SEED, ANY_SCENARIO, 'clearance');
});

describe('the bundled airport data', () => {
  it('lists KSFO', () => {
    expect(listAirports().map((entry) => entry.icao)).toContain('KSFO');
  });

  it('refuses an airport the index does not name', () => {
    return expect(loadAirportData('KZZZ')).rejects.toThrow('KZZZ');
  });

  it('loads every airport the index lists as the airport it names', async () => {
    for (const entry of listAirports()) {
      const loaded = await loadAirportData(entry.icao);
      expect(loaded.airport.icao, entry.file).toBe(entry.icao);
    }
  });

  it('draws a clearance scenario on every listed airport', async () => {
    for (const entry of listAirports()) {
      const loaded = await loadAirportData(entry.icao);
      const drawn = buildScenario(loaded, SEED, ANY_SCENARIO, 'clearance');
      const why = drawn.kind === 'unresolved' ? drawn.reasons.join('; ') : '';
      expect(drawn.kind, `${entry.icao}: ${why}`).toBe('clearance');
    }
  });
});

describe(`the scenario of seed ${SEED}`, () => {
  it('resolves to a clearance', () => {
    expect(view.kind).toBe('clearance');
  });

  it('is the same scenario every time the seed is drawn', () => {
    const again = buildScenario(airport, SEED, ANY_SCENARIO, 'clearance');
    expect(JSON.stringify(again)).toBe(JSON.stringify(view));
  });

  it('fills the strip and the ATIS from the scenario', () => {
    if (view.kind !== 'clearance') throw new Error('the seeded scenario is not a clean clearance');
    const scenario = view.generated;
    const strip = stripFields(scenario, airport, SEED);
    expect(strip.callsign).toBe(scenario.callsign);
    expect(strip.equipment).toContain(`${scenario.aircraftType}${scenario.equipmentSuffix ?? ''}`);
    expect(strip.depDest).toBe(`${airport.airport.icao} ${scenario.destination}`);
    expect(strip.routeLines.join(' ')).toContain(scenario.filedRoute.split(/\s+/)[0]);
    const atis = new Map(atisRows(scenario, airport).map(([label, value]) => [label, value]));
    expect(atis.get('departing')).toBe('28L, 28R');
    expect(atis.get('configuration')).toContain(scenario.runwayConfigId);
    for (const notice of activeNotices(scenario, airport)) {
      expect(notice.text.length).toBeGreaterThan(0);
    }
  });

  it('is read back as a spoken clearance', () => {
    if (view.kind !== 'clearance') throw new Error('the seeded scenario is not a clean clearance');
    const spoken = spokenFor(view.generated, view.generated, view.clearance, airport);
    console.log(`[seed ${SEED}] abbreviated: ${spoken.abbreviated}`);
    console.log(`[seed ${SEED}] full route:  ${spoken.fullRoute}`);
    expect(spoken.abbreviated).toContain('cleared to');
    expect(spoken.fullRoute).toContain('squawk');
  });
});

describe('an amendment scenario', () => {
  /** The seeds the amendment draw is exercised over. */
  const SEEDS = Array.from({ length: 20 }, (_, index) => index + 1);

  /** The amendment view one seed draws, or a failure naming what came back instead. */
  function amendmentOf(seed: number): Extract<ScenarioView, { kind: 'amendment' }> {
    const drawn = buildScenario(airport, seed, ANY_SCENARIO, 'amendment');
    if (drawn.kind === 'amendment') return drawn;
    const reasons = drawn.kind === 'unresolved' ? drawn.reasons.join('; ') : 'a clean clearance';
    throw new Error(`seed ${seed} drew no amendment scenario: ${reasons}`);
  }

  it('builds a plan to amend and the clearance for its corrected form, for every seed', () => {
    for (const seed of SEEDS) {
      const drawn = amendmentOf(seed);
      expect(drawn.kind, `seed ${seed}`).toBe('amendment');
      const { procedure } = drawn.clearance;
      expect(procedure.value.kind, `seed ${seed}`).toBe('sid');
      expect(procedure.value.spoken.length, `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it('draws the same plan every time a seed is drawn', () => {
    for (const seed of SEEDS) {
      expect(JSON.stringify(amendmentOf(seed)), `seed ${seed}`).toBe(
        JSON.stringify(amendmentOf(seed)),
      );
    }
  });

  it('speaks the amended altitude in the expect clause where the altitude box was amended', () => {
    const amended = SEEDS.map((seed) => amendmentOf(seed)).filter(
      (drawn) => drawn.drawn.result.corrected.filedAltitude !== drawn.drawn.filed.filedAltitude,
    );
    expect(amended.length, 'no seed of 1 to 20 amends the altitude box').toBeGreaterThan(0);
    for (const drawn of amended) {
      expect(['amended', 'final']).toContain(drawn.clearance.expect.value?.kind);
      expect(drawn.clearance.expect.value?.feet).toBe(drawn.drawn.result.corrected.filedAltitude);
    }
  });

  it('grades a typed clearance of the corrected plan in place of the procedure pick', () => {
    const seed = SEEDS.find((candidate) => {
      const { amendments } = amendmentOf(candidate).drawn.result;
      return amendments.length > 0 && amendments.every((one) => one.alternativeTo === undefined);
    });
    if (seed === undefined) throw new Error('no seed of 1 to 20 amends a box without a pair');
    const { drawn, clearance } = amendmentOf(seed);
    const answers = correctedAnswers(drawn.result.amendments);
    const spoken = spokenFor(drawn.result.corrected, drawn.filed, clearance, airport);
    const grades = amendmentGrades(drawn, clearance, airport, answers, {
      input: 'text',
      text: spoken.abbreviated,
    });
    const boxes = ['BOX.type', 'BOX.altitude', 'BOX.route'];
    const typed = ['C', 'R.sid', 'R.route', 'A.phrase', 'A.expect', 'F', 'T', 'RWY'];
    const elements = [...boxes, ...typed];
    expect(
      grades.map(({ element, verdict }) => `${element} ${verdict}`),
      `seed ${seed}: ${spoken.abbreviated}`,
    ).toStrictEqual(elements.map((element) => `${element} correct`));
  });
});

describe('the CRAFT form', () => {
  it('keeps the dependent dropdowns disabled until the pick they depend on is made', () => {
    const fields = new Map(
      fieldsOf(newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'clearance'))).map(
        (field) => [field.key, field],
      ),
    );
    expect(fields.get('routeFix')?.disabled).toBe(true);
    expect(fields.get('altitudeFeet')?.disabled).toBe(true);
    expect(fields.get('routeTemplate')?.disabled).toBe(false);
  });

  it('offers the clearance the engine resolved, and grades it green', () => {
    const clearance = clearanceOf(view);
    let state = newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'clearance'));
    for (const [key, raw] of answerFor(clearance)) state = withPick(state, key, raw);
    const picks = toPlayerPicks(state.picks);
    if (picks === undefined) throw new Error("the engine's own clearance did not fill the form");
    for (const [key, raw] of answerFor(clearance)) {
      const field = fieldsOf(state).find((candidate) => candidate.key === key);
      expect(field?.disabled).toBe(false);
      expect(field?.options.map((option) => option.value)).toContain(raw);
    }
    const submitted = withSubmitted(state);
    expect(submitted.submitted).toBe(true);
    for (const verdict of grade(picks, clearance)) {
      expect(verdict.verdict, `${verdict.element}: ${verdict.actualLabel}`).toBe('correct');
    }
  });

  it('opens with the clearance limit and the procedure the engine resolved', () => {
    if (view.kind !== 'clearance') throw new Error('the seeded scenario is not a clean clearance');
    const clearance = view.clearance;
    const [limit, procedure] = groupsOf(
      newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'clearance')),
    );
    if (limit?.kind !== 'given') throw new Error('the first row is not a given row');
    const icao = clearance.clearedTo.value;
    const spoken = airport.routeLibrary.destinations.find((row) => row.icao === icao)?.spoken;
    expect(spoken).toBeDefined();
    expect(limit.heading).toBe('C — clearance limit');
    expect(limit.value).toBe(`${icao} — ${String(spoken)}`);
    if (procedure?.kind !== 'given') throw new Error('the second row is not a given row');
    const assigned = clearance.procedure.value;
    if (assigned.kind !== 'sid') throw new Error('the clearance assigns no procedure');
    const chartName = airport.sids.find((sid) => sid.id === assigned.id)?.chartName;
    expect(chartName).toBeDefined();
    expect(procedure.heading).toBe('R — procedure');
    expect(procedure.value).toBe(chartName);
  });

  it('shows the squawk as a given row just before the runway', () => {
    if (view.kind !== 'clearance') throw new Error('the seeded scenario is not a clean clearance');
    const groups = groupsOf(
      newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'clearance')),
    );
    const squawkAt = groups.findIndex(
      (group) => group.kind === 'given' && group.heading.startsWith('T'),
    );
    const runwayAt = groups.findIndex(
      (group) => group.kind === 'picked' && group.element === 'RWY',
    );
    expect(groups[squawkAt]).toEqual({
      kind: 'given',
      heading: 'T — transponder',
      value: view.generated.squawk,
    });
    expect(runwayAt).toBe(squawkAt + 1);
  });

  it('refuses to submit a form with a dropdown still blank', () => {
    const state = newSession(airport, SEED, undefined, dropdowns(ANY_SCENARIO, 'clearance'));
    expect(withSubmitted(state).submitted).toBe(false);
  });
});
