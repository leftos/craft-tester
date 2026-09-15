import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AircraftClass, AirportData, FleetEntry, RunwayConfig } from '@/data/schema.ts';
import { ScenarioSchema } from '@/data/schema.ts';
import { isNoiseWindowActive } from '@/rules/classify.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { directionOf, isSidToken } from '@/rules/route.ts';
import { isUnresolved } from '@/rules/unresolved.ts';
import type { ScenarioFilter } from '@/scenario/filter.ts';
import { ANY_SCENARIO } from '@/scenario/filter.ts';
import type { GeneratedScenario } from '@/scenario/generate.ts';
import { drawScenario, generateScenario } from '@/scenario/generate.ts';
import { createRng } from '@/scenario/rng.ts';

const ksfo = ksfoJson as unknown as AirportData;

/** The seeds the mix assertions are measured over; the plan requires 0..999 to all generate. */
const SEEDS = Array.from({ length: 1000 }, (_value, index) => index);

/** The seeds the filtered draws are measured over. */
const FILTERED_SEEDS = Array.from({ length: 200 }, (_value, index) => index);

const generated = SEEDS.map((seed) => generateScenario(createRng(seed), ksfo, ANY_SCENARIO));

/** Every scenario the filter draws over `FILTERED_SEEDS`. */
function drawnUnder(filter: ScenarioFilter): GeneratedScenario[] {
  return FILTERED_SEEDS.map((seed) => generateScenario(createRng(seed), ksfo, filter));
}

/** The local time as minutes past midnight, which the bucket assertions compare. */
function minuteOf(entry: GeneratedScenario): number {
  const { localTime } = entry.scenario;
  return Number(localTime.slice(0, 2)) * 60 + Number(localTime.slice(2));
}

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

/** The fleet row of the type a scenario drew. */
function fleetOf(entry: GeneratedScenario): FleetEntry {
  const fleet = ksfo.routeLibrary.fleet.find((row) => row.type === entry.scenario.aircraftType);
  if (fleet === undefined) {
    throw new Error(`type ${entry.scenario.aircraftType} is not in the route library fleet`);
  }
  return fleet;
}

/** Whether the flight is one of the kinds the 28s of 28/01 are held for on request. */
function mayRequestThe28s(entry: GeneratedScenario): boolean {
  const fleet = fleetOf(entry);
  return (
    fleet.wtc === 'H' ||
    fleet.airlines.some((airline) => ksfo.routeLibrary.cargoAirlines.includes(airline)) ||
    directionOf(exitFixOf(entry), ksfo.gates) === 'oceanic'
  );
}

/** The runway the configuration defaults a class to, or undefined when it defaults none. */
function defaultRunwayFor(config: RunwayConfig, aircraftClass: AircraftClass): string | undefined {
  return config.departureRunways.find((assignment) =>
    assignment.defaultForClasses.includes(aircraftClass),
  )?.runway;
}

/** Whether the runway the scenario departs is one its configuration holds for the flights that ask. */
function departsOnRequestRunway(entry: GeneratedScenario): boolean {
  const config = ksfo.runwayConfigs.find((row) => row.id === entry.scenario.runwayConfigId);
  const aircraftClass = classOf(entry);
  return (config?.departureRunways ?? []).some(
    (row) =>
      row.runway === entry.scenario.departureRunway &&
      row.classes.includes(aircraftClass) &&
      row.onRequestFor.length > 0,
  );
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
      expect(generateScenario(createRng(seed), ksfo, ANY_SCENARIO)).toEqual(
        generateScenario(createRng(seed), ksfo, ANY_SCENARIO),
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

  it('draws a heavy in 28/01 both off the 28s it may ask for and off the advertised 01s', () => {
    const heavies = generated.filter(
      (entry) => entry.scenario.runwayConfigId === '28/01' && fleetOf(entry).wtc === 'H',
    );
    expect(heavies.length).toBeGreaterThan(0);
    const requested = heavies.filter((entry) => entry.scenario.departureRunway === '28L');
    const advertised = heavies.filter((entry) => entry.scenario.departureRunway.startsWith('01'));
    expect(requested.length).toBeGreaterThan(0);
    expect(advertised.length).toBeGreaterThan(0);
    expect(heavies.length).toBe(requested.length + advertised.length);
  });

  it('files the request in the remarks of every flight drawn onto a runway it asked for', () => {
    const asked = generated.filter((entry) => entry.scenario.remarks !== undefined);
    console.log(`[seeds 0..${SEEDS.length - 1}] ${asked.length} scenarios filed remarks`);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.filter((entry) => !departsOnRequestRunway(entry)).map(label)).toEqual([]);
    const misremarked = asked.filter(
      (entry) => entry.scenario.remarks !== `REQ RWY ${entry.scenario.departureRunway.slice(0, 2)}`,
    );
    expect(misremarked.map(label)).toEqual([]);
  });

  it('never departs a runway it had to ask for without the remark that asked', () => {
    const silent = generated.filter((entry) => entry.scenario.remarks === undefined);
    expect(silent.length).toBeGreaterThan(0);
    expect(silent.filter(departsOnRequestRunway).map(label)).toEqual([]);
  });

  it('never gives the 28s of 28/01 to a light jet that cannot ask for them', () => {
    const lightJets = generated.filter(
      (entry) =>
        entry.scenario.runwayConfigId === '28/01' &&
        fleetOf(entry).class === 'J' &&
        fleetOf(entry).wtc === 'L' &&
        !mayRequestThe28s(entry),
    );
    expect(lightJets.length).toBeGreaterThan(0);
    expect(
      lightJets.filter((entry) => entry.scenario.departureRunway.startsWith('28')).map(label),
    ).toEqual([]);
  });

  it('redraws rather than presenting a flight the SOP clears without a procedure', () => {
    const redrawn = SEEDS.map((seed) => drawScenario(createRng(seed), ksfo, ANY_SCENARIO)).filter(
      (drawn) => isUnresolved(drawn),
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

describe('the scenario filter', () => {
  it('draws the scenario the unfiltered seed always drew', () => {
    const first = generateScenario(createRng(1), ksfo, ANY_SCENARIO);
    expect(first.scenario.callsign).toBe('QXE4553');
    expect(first.scenario.runwayConfigId).toBe('28 RT');
  });

  it('sets every day scenario between 0800 and 2159 local', () => {
    const day = drawnUnder({ time: 'day', config: { kind: 'any' } });
    expect(day).toHaveLength(FILTERED_SEEDS.length);
    expect(day.filter((entry) => minuteOf(entry) < 8 * 60).map(label)).toEqual([]);
    expect(day.filter((entry) => minuteOf(entry) >= 22 * 60).map(label)).toEqual([]);
  });

  it('sets every night scenario between 2200 and 0759 local', () => {
    const night = drawnUnder({ time: 'night', config: { kind: 'any' } });
    expect(night).toHaveLength(FILTERED_SEEDS.length);
    const daylight = night.filter(
      (entry) => minuteOf(entry) >= 8 * 60 && minuteOf(entry) < 22 * 60,
    );
    expect(daylight.map(label)).toEqual([]);
    expect(new Set(night.map((entry) => timeBucket(entry.scenario.localTime)))).toStrictEqual(
      new Set(['late night', 'night']),
    );
  });

  it('draws only the configurations of the plan it is narrowed to', () => {
    const east = drawnUnder({ time: 'either', config: { kind: 'plan', plan: 'SFOE' } });
    expect(east).toHaveLength(FILTERED_SEEDS.length);
    const planOf = (entry: GeneratedScenario): string | undefined =>
      ksfo.runwayConfigs.find((row) => row.id === entry.scenario.runwayConfigId)?.plan;
    expect(east.filter((entry) => planOf(entry) !== 'SFOE').map(label)).toEqual([]);
    expect(new Set(east.map((entry) => entry.scenario.runwayConfigId)).size).toBeGreaterThan(1);
  });

  it('draws only the configuration whose id it is narrowed to', () => {
    const straightOut = drawnUnder({ time: 'either', config: { kind: 'id', id: '28 SO' } });
    expect(straightOut).toHaveLength(FILTERED_SEEDS.length);
    expect(
      straightOut.filter((entry) => entry.scenario.runwayConfigId !== '28 SO').map(label),
    ).toEqual([]);
  });

  it('refuses a configuration the airport does not have', () => {
    expect(() =>
      generateScenario(createRng(1), ksfo, { time: 'either', config: { kind: 'id', id: '07/07' } }),
    ).toThrow('07/07');
  });
});
