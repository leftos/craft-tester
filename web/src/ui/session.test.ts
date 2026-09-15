import { beforeAll, describe, expect, it } from 'vitest';
import type { AirportData } from '@/data/schema.ts';
import { grade } from '@/rules/grade.ts';
import type { ResolvedClearance } from '@/rules/types.ts';
import { activeNotices, atisRows } from '@/ui/atis.ts';
import { craftGroups } from '@/ui/craftForm.ts';
import type { CraftField } from '@/ui/craftForm.ts';
import { buildScenario, listAirports, loadAirportData, spokenFor } from '@/ui/session.ts';
import type { ScenarioView } from '@/ui/session.ts';
import type { AppState, PickKey } from '@/ui/state.ts';
import { newSession, toPlayerPicks, withPick, withSubmitted } from '@/ui/state.ts';
import { stripRows } from '@/ui/strip.ts';

/** The seed the wiring test renders, which is the one the report quotes. */
const SEED = 1;

let airport: AirportData;
let view: ScenarioView;

/** The clearance of the seeded scenario, or a failure naming why the engine issued none. */
function clearanceOf(scenarioView: ScenarioView): ResolvedClearance {
  if (scenarioView.kind === 'unresolved') {
    throw new Error(`seed ${SEED} resolved to nothing: ${scenarioView.reasons.join('; ')}`);
  }
  return scenarioView.clearance;
}

/** The dropdown values that spell out the clearance the engine resolved, in the order to pick them. */
function answerFor(clearance: ResolvedClearance): [PickKey, string][] {
  const expectValue = clearance.expect.value;
  const feet = clearance.altitude.value.feet;
  const answers: [PickKey, string][] = [
    ['clearedTo', clearance.clearedTo.value],
    ['sidId', clearance.sid.value.id],
    ['routeTemplate', clearance.route.value.template],
    ['routeFix', clearance.route.value.fix ?? ''],
    ['altitudePhrase', clearance.altitude.value.phrase],
    [
      'expect',
      expectValue === null ? 'none' : `${expectValue.minutes === 10 ? 'ten' : 'three'}_minutes`,
    ],
    ['frequency', clearance.frequency.value.value],
  ];
  if (feet === undefined) return answers;
  return [...answers, ['altitudeFeet', String(feet)]];
}

/** Every dropdown of the form, flattened out of its CRAFT groups. */
function fieldsOf(state: AppState): CraftField[] {
  if (state.view.kind === 'unresolved') throw new Error('the seeded scenario has no clearance');
  return craftGroups(state.view.generated.scenario, state.airport, state.picks).flatMap((group) => [
    ...group.fields,
  ]);
}

beforeAll(async () => {
  airport = await loadAirportData('KSFO');
  view = buildScenario(airport, SEED);
});

describe('the bundled airport data', () => {
  it('lists KSFO', () => {
    expect(listAirports().map((entry) => entry.icao)).toContain('KSFO');
  });

  it('refuses an airport the index does not name', () => {
    return expect(loadAirportData('KZZZ')).rejects.toThrow('KZZZ');
  });
});

describe(`the scenario of seed ${SEED}`, () => {
  it('resolves to a clearance', () => {
    expect(view.kind).toBe('clearance');
  });

  it('is the same scenario every time the seed is drawn', () => {
    const again = buildScenario(airport, SEED);
    expect(JSON.stringify(again)).toBe(JSON.stringify(view));
  });

  it('fills the strip and the ATIS from the scenario', () => {
    if (view.kind === 'unresolved') throw new Error('the seeded scenario has no clearance');
    const { scenario } = view.generated;
    const strip = new Map(stripRows(view.generated).map(([label, value]) => [label, value]));
    expect(strip.get('callsign')).toBe(scenario.callsign);
    expect(strip.get('type')).toBe(`${scenario.aircraftType}${view.generated.suffix}`);
    expect(strip.get('route')).toBe(scenario.filedRoute);
    const atis = new Map(atisRows(scenario, airport).map(([label, value]) => [label, value]));
    expect(atis.get('departing')).toBe(scenario.departureRunway);
    expect(atis.get('configuration')).toContain(scenario.runwayConfigId);
    for (const notice of activeNotices(scenario, airport)) {
      expect(notice.text.length).toBeGreaterThan(0);
    }
  });

  it('is read back as a spoken clearance', () => {
    if (view.kind === 'unresolved') throw new Error('the seeded scenario has no clearance');
    const spoken = spokenFor(view.generated.scenario, view.clearance, airport);
    console.log(`[seed ${SEED}] abbreviated: ${spoken.abbreviated}`);
    console.log(`[seed ${SEED}] full route:  ${spoken.fullRoute}`);
    expect(spoken.abbreviated).toContain('cleared to');
    expect(spoken.fullRoute).toContain('squawk');
  });
});

describe('the CRAFT form', () => {
  it('keeps the dependent dropdowns disabled until the pick they depend on is made', () => {
    const fields = new Map(
      fieldsOf(newSession(airport, SEED, undefined)).map((field) => [field.key, field]),
    );
    expect(fields.get('routeFix')?.disabled).toBe(true);
    expect(fields.get('altitudeFeet')?.disabled).toBe(true);
    expect(fields.get('clearedTo')?.disabled).toBe(false);
  });

  it('offers the clearance the engine resolved, and grades it green', () => {
    const clearance = clearanceOf(view);
    let state = newSession(airport, SEED, undefined);
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
    for (const verdict of grade(picks, clearance, airport.sids)) {
      expect(verdict.ok, `${verdict.element}: ${verdict.actualLabel}`).toBe(true);
    }
  });

  it('refuses to submit a form with a dropdown still blank', () => {
    const state = newSession(airport, SEED, undefined);
    expect(withSubmitted(state).submitted).toBe(false);
  });
});
