import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AircraftClass, AirportData, RunwayConfig } from '@/data/schema.ts';
import { ScenarioSchema } from '@/data/schema.ts';
import { isNoiseWindowActive } from '@/rules/classify.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { directionOf, isSidToken } from '@/rules/route.ts';
import { isUnresolved } from '@/rules/unresolved.ts';
import type { GeneratedScenario } from '@/scenario/generate.ts';
import { drawScenario, generateScenario } from '@/scenario/generate.ts';
import { createRng } from '@/scenario/rng.ts';

const ksfo = ksfoJson as unknown as AirportData;

/** The seeds the mix assertions are measured over; the plan requires 0..999 to all generate. */
const SEEDS = Array.from({ length: 1000 }, (_value, index) => index);

const generated = SEEDS.map((seed) => generateScenario(createRng(seed), ksfo));

/** Which of the three filed-route shapes the scenario drew. */
function tokenKind(entry: GeneratedScenario): 'correct' | 'none' | 'wrong' {
  const first = entry.scenario.filedRoute.split(' ')[0] ?? '';
  if (!isSidToken(first)) return 'none';
  return first === entry.correctSidId ? 'correct' : 'wrong';
}

/** The fix the flight leaves the terminal on: the first filed token that is not a procedure. */
function exitFixOf(entry: GeneratedScenario): string {
  return entry.scenario.filedRoute.split(' ').find((token) => !isSidToken(token)) ?? '';
}

/** Which of the three time-of-day buckets the local time falls in. */
function timeBucket(localTime: string): 'day' | 'late night' | 'night' {
  const minute = Number(localTime.slice(0, 2)) * 60 + Number(localTime.slice(2));
  if (minute >= 8 * 60 && minute < 22 * 60) return 'day';
  if (minute >= 60 && minute < 5 * 60) return 'late night';
  return 'night';
}

/** The share of the scenarios, in percentage points, whose filed route has this shape. */
function shareOf(kind: 'correct' | 'none' | 'wrong'): number {
  return (generated.filter((entry) => tokenKind(entry) === kind).length * 100) / generated.length;
}

/** The aircraft class of the scenario's type, as `aircraftClasses` in the airport data keys it. */
function classOf(entry: GeneratedScenario): AircraftClass {
  const aircraftClass = ksfo.aircraftClasses[entry.scenario.aircraftType];
  if (aircraftClass === undefined) {
    throw new Error(
      `type ${entry.scenario.aircraftType} has no aircraft class in the airport data`,
    );
  }
  return aircraftClass;
}

/** The runway the configuration defaults a class to, or undefined when it defaults none. */
function defaultRunwayFor(config: RunwayConfig, aircraftClass: AircraftClass): string | undefined {
  return config.departureRunways.find((assignment) =>
    assignment.defaultForClasses.includes(aircraftClass),
  )?.runway;
}

/** The scenarios drawn in one runway configuration whose aircraft is of one of the classes. */
function drawnIn(configId: string, classes: readonly AircraftClass[]): GeneratedScenario[] {
  return generated.filter(
    (entry) => entry.scenario.runwayConfigId === configId && classes.includes(classOf(entry)),
  );
}

/** One line naming the scenario, for a failing assertion to point at. */
function label(entry: GeneratedScenario): string {
  const { scenario } = entry;
  return [
    `${scenario.callsign} ${scenario.aircraftType}${entry.suffix}`,
    `${scenario.runwayConfigId} ${scenario.departureRunway}`,
    `${scenario.localTime} ${scenario.dayOfWeek}`,
    `"${scenario.filedRoute}" (assigned ${entry.correctSidId})`,
  ].join(' | ');
}

describe('generateScenario', () => {
  it('generates a clearable scenario for every seed', () => {
    expect(generated).toHaveLength(SEEDS.length);
    const blocked = generated
      .filter((entry) => !resolveClearance(entry.scenario, ksfo).ok)
      .map(label);
    expect(blocked).toEqual([]);
  });

  it('draws the same scenario from the same seed', () => {
    for (const seed of [0, 7, 42, 999]) {
      expect(generateScenario(createRng(seed), ksfo)).toEqual(
        generateScenario(createRng(seed), ksfo),
      );
    }
  });

  it('produces scenarios that parse under the fixture schema', () => {
    const invalid = generated
      .filter((entry) => !ScenarioSchema.safeParse(entry.scenario).success)
      .map(label);
    expect(invalid).toEqual([]);
  });

  it('files the assigned procedure half the time, none a third, and a wrong one the rest', () => {
    expect(shareOf('correct')).toBeGreaterThan(40);
    expect(shareOf('correct')).toBeLessThan(60);
    expect(shareOf('none')).toBeGreaterThan(20);
    expect(shareOf('none')).toBeLessThan(40);
    expect(shareOf('wrong')).toBeGreaterThan(10);
    expect(shareOf('wrong')).toBeLessThan(30);
  });

  it('never files a wrong procedure that is in fact the assigned one', () => {
    const wrong = generated.filter((entry) => tokenKind(entry) === 'wrong');
    expect(wrong.length).toBeGreaterThan(0);
    const accidental = wrong
      .filter((entry) => entry.scenario.filedRoute.startsWith(`${entry.correctSidId} `))
      .map(label);
    expect(accidental).toEqual([]);
  });

  it('covers every time bucket and every runway configuration', () => {
    const buckets = new Set(generated.map((entry) => timeBucket(entry.scenario.localTime)));
    expect([...buckets].sort()).toEqual(['day', 'late night', 'night']);
    const configs = new Set(generated.map((entry) => entry.scenario.runwayConfigId));
    for (const config of ksfo.runwayConfigs) {
      expect(configs, `configuration ${config.id} was never drawn`).toContain(config.id);
    }
  });

  it('departs the runway the SOP sends that direction off', () => {
    const wrongRunway = generated
      .filter((entry) => {
        const config = ksfo.runwayConfigs.find((row) => row.id === entry.scenario.runwayConfigId);
        const direction = directionOf(exitFixOf(entry), ksfo.gates);
        if (config === undefined || direction === undefined) return false;
        if (defaultRunwayFor(config, classOf(entry)) !== undefined) return false;
        const family = entry.scenario.departureRunway.slice(0, 2);
        const preferred = ksfo.directionRunwayPreference[config.plan]?.[direction]?.[family];
        return preferred !== undefined && preferred !== entry.scenario.departureRunway;
      })
      .map(label);
    expect(wrongRunway).toEqual([]);
  });

  it('sends northbound SFOW departures off the 01s from 1R and southbound ones from 1L', () => {
    const offThe01s = generated.filter(
      (entry) =>
        entry.scenario.departureRunway.startsWith('01') &&
        ksfo.runwayConfigs.find((row) => row.id === entry.scenario.runwayConfigId)?.plan === 'SFOW',
    );
    const north = offThe01s.filter((entry) => ksfo.gates.north.includes(exitFixOf(entry)));
    const south = offThe01s.filter((entry) => ksfo.gates.south.includes(exitFixOf(entry)));
    expect(north.length).toBeGreaterThan(0);
    expect(south.length).toBeGreaterThan(0);
    expect(north.filter((entry) => entry.scenario.departureRunway !== '01R').map(label)).toEqual(
      [],
    );
    expect(south.filter((entry) => entry.scenario.departureRunway !== '01L').map(label)).toEqual(
      [],
    );
  });

  it('a turboprop in 28/01 departs 28R by default', () => {
    const propsAndTurboprops = drawnIn('28/01', ['P', 'T']);
    expect(propsAndTurboprops.length).toBeGreaterThan(0);
    expect(
      propsAndTurboprops.filter((entry) => entry.scenario.departureRunway !== '28R').map(label),
    ).toEqual([]);
  });

  it('a jet in 28/01 departs the 01s', () => {
    const jetDefaults = ksfo.runwayConfigs
      .filter((config) => config.id === '28/01')
      .map((config) => defaultRunwayFor(config, 'J'));
    expect(jetDefaults).toEqual([undefined]);
    const jets = drawnIn('28/01', ['J']);
    expect(
      jets.filter((entry) => entry.scenario.departureRunway.startsWith('01')).length,
    ).toBeGreaterThan(0);
    expect(jets.filter((entry) => entry.scenario.departureRunway === '28R').map(label)).toEqual([]);
  });

  it('redraws rather than presenting a flight the SOP clears without a procedure', () => {
    const redrawn = SEEDS.map((seed) => drawScenario(createRng(seed), ksfo)).filter((drawn) =>
      isUnresolved(drawn),
    );
    expect(redrawn.length).toBeLessThan(100);
    const night = ksfo.noiseWindows.find((window) => window.id === 'night');
    const stranded = generated
      .filter((entry) => {
        const { scenario } = entry;
        const config = ksfo.runwayConfigs.find((row) => row.id === scenario.runwayConfigId);
        return (
          config?.plan === 'SFOW' &&
          scenario.departureRunway.startsWith('01') &&
          ksfo.aircraftClasses[scenario.aircraftType] === 'P' &&
          !scenario.rnavCapable &&
          night !== undefined &&
          isNoiseWindowActive(night, scenario.localTime, scenario.dayOfWeek)
        );
      })
      .map(label);
    expect(stranded).toEqual([]);
  });
});
