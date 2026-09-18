import { describe, expect, it } from 'vitest';
import koakJson from '@data/koak.json';
import ksfoJson from '@data/ksfo.json';
import type {
  AircraftClass,
  AirportData,
  Direction,
  FleetEntry,
  RunwayConfig,
  Scenario,
} from '@/data/schema.ts';
import { ScenarioSchema } from '@/data/schema.ts';
import { resolveAmendments } from '@/rules/amend/engine.ts';
import { isNoiseWindowActive } from '@/rules/classify.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { directionOf, flightDirection, isSidToken, parseFiledRoute } from '@/rules/route.ts';
import { usableTecRouteOn } from '@/rules/tecRoutes.ts';
import type { Unresolved } from '@/rules/types.ts';
import { isUnresolved } from '@/rules/unresolved.ts';
import { generateAmendmentScenario } from '@/scenario/amend.ts';
import type { ScenarioFilter } from '@/scenario/filter.ts';
import { ANY_SCENARIO } from '@/scenario/filter.ts';
import {
  drawScenario,
  generateScenario,
  pickRunway,
  requestStands,
  tecRunway,
} from '@/scenario/generate.ts';
import { createRng } from '@/scenario/rng.ts';

const ksfo = ksfoJson as unknown as AirportData;
const koak = koakJson as unknown as AirportData;

/** The seeds the mix assertions are measured over; the plan requires 0..999 to all generate. */
const SEEDS = Array.from({ length: 1000 }, (_value, index) => index);

/**
 * How many of those raw draws may be thrown away.
 *
 * A draw is rejected when the plan is not clean as filed in the configuration drawn: the
 * configuration is drawn before the route, and a TRACON destination files one tail per plan, so a
 * tail written for SFOE is rejected in the SFOW configurations, which carry most of the training
 * weight. The route builder adopts most of those rather than throwing them away, so the ceiling is
 * far above what the sweep actually rejects; the test logs the figure it measures.
 */
const MAX_REDRAWN = 300;

/** The seeds the filtered draws are measured over. */
const FILTERED_SEEDS = Array.from({ length: 200 }, (_value, index) => index);

/**
 * A night non-RNAV prop off the 01s is a rare draw — night, a prop, a non-RNAV suffix and an 01
 * configuration all at once — so it is measured over more seeds than the other filtered sweeps,
 * which keeps the test from turning on the route library's row count.
 */
const NIGHT_HEADING_SEEDS = Array.from({ length: 1000 }, (_value, index) => index);

const generated = SEEDS.map((seed) => generateScenario(createRng(seed), ksfo, ANY_SCENARIO));

/** Every scenario the filter draws over the seeds given. */
function drawnUnder(filter: ScenarioFilter, seeds: number[]): Scenario[] {
  return seeds.map((seed) => generateScenario(createRng(seed), ksfo, filter));
}

/** The local time as minutes past midnight, which the bucket assertions compare. */
function minuteOf(entry: Scenario): number {
  const { localTime } = entry;
  return Number(localTime.slice(0, 2)) * 60 + Number(localTime.slice(2));
}

/** The fix the flight leaves the terminal on: the first filed token that is not a procedure. */
function exitFixOf(entry: Scenario): string {
  return entry.filedRoute.split(' ').find((token) => !isSidToken(token)) ?? '';
}

/**
 * The direction the flight departs in, which the engine reads off the whole route.
 *
 * A plan sent over a forced transition leaves the terminal by a gate of the other direction, so
 * the first fix of its route is not what the SOP assigned it its runway for.
 */
function directionFor(entry: Scenario): Direction | undefined {
  const parsed = parseFiledRoute(entry.filedRoute, ksfo);
  return isUnresolved(parsed) ? undefined : flightDirection(parsed, ksfo);
}

/** Which of the three time-of-day buckets the local time falls in. */
function timeBucket(localTime: string): 'day' | 'late night' | 'night' {
  const minute = Number(localTime.slice(0, 2)) * 60 + Number(localTime.slice(2));
  if (minute >= 8 * 60 && minute < 22 * 60) return 'day';
  if (minute >= 60 && minute < 5 * 60) return 'late night';
  return 'night';
}

/** The aircraft class of the scenario's type, as `aircraftClasses` in the airport data keys it. */
function classOf(entry: Scenario): AircraftClass {
  const aircraftClass = ksfo.aircraftClasses[entry.aircraftType];
  if (aircraftClass === undefined) {
    throw new Error(`type ${entry.aircraftType} has no aircraft class in the airport data`);
  }
  return aircraftClass;
}

/** The fleet row of the type a scenario drew. */
function fleetOf(entry: Scenario): FleetEntry {
  const fleet = ksfo.routeLibrary.fleet.find((row) => row.type === entry.aircraftType);
  if (fleet === undefined) {
    throw new Error(`type ${entry.aircraftType} is not in the route library fleet`);
  }
  return fleet;
}

/** Whether the flight is one of the kinds the 28s of 28/01 are held for on request. */
function mayRequestThe28s(entry: Scenario): boolean {
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
function departsOnRequestRunway(entry: Scenario): boolean {
  const config = ksfo.runwayConfigs.find((row) => row.id === entry.runwayConfigId);
  const aircraftClass = classOf(entry);
  return (config?.departureRunways ?? []).some(
    (row) =>
      row.runway === entry.departureRunway &&
      row.classes.includes(aircraftClass) &&
      row.onRequestFor.length > 0,
  );
}

/** The scenarios drawn in one runway configuration whose aircraft is of one of the classes. */
function drawnIn(configId: string, classes: readonly AircraftClass[]): Scenario[] {
  return generated.filter(
    (entry) => entry.runwayConfigId === configId && classes.includes(classOf(entry)),
  );
}

/**
 * The three reasons that rejected the most raw draws, so a rise in the rejection rate says why.
 *
 * Draws are grouped by the blocked element and the reason with the callsign and every figure taken
 * out, which is what makes two draws rejected for the same rule read as one line.
 *
 * @param rejected Every raw draw the engines would not present.
 * @returns Up to three lines, the most rejections first.
 */
function topRejections(rejected: readonly Unresolved[]): string[] {
  const counts = new Map<string, number>();
  for (const gap of rejected) {
    const key = `${gap.element} | ${gap.reason.replace(/^\S+ to /, '').replaceAll(/\d+/g, '#')}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([, left], [, right]) => right - left)
    .slice(0, 3)
    .map(([key, count]) => `  ${String(count).padStart(3)}  ${key}`);
}

/** One line naming the scenario, for a failing assertion to point at. */
function label(scenario: Scenario): string {
  return [
    `${scenario.callsign} ${scenario.aircraftType}${scenario.equipmentSuffix ?? ''}`,
    `${scenario.runwayConfigId} ${scenario.departureRunway}`,
    `${scenario.localTime} ${scenario.dayOfWeek}`,
    `"${scenario.filedRoute}"`,
  ].join(' | ');
}

describe('generateScenario', () => {
  it('generates a clearable scenario for every seed', () => {
    expect(generated).toHaveLength(SEEDS.length);
    const blocked = generated.filter((entry) => !resolveClearance(entry, ksfo).ok).map(label);
    expect(blocked).toEqual([]);
  });

  it('files the assigned procedure on every draw, and none where the SOP assigns none', () => {
    const misfiled = generated
      .filter((entry) => {
        const result = resolveClearance(entry, ksfo);
        if (!result.ok) return true;
        const procedure = result.clearance.procedure.value;
        const head = entry.filedRoute.split(' ')[0] ?? '';
        return procedure.kind === 'sid' ? head !== procedure.id : isSidToken(head);
      })
      .map(label);
    expect(misfiled).toEqual([]);
  });

  it('every draw is clean as filed', () => {
    const dirty = generated
      .slice(0, 300)
      .filter((entry) => {
        const result = resolveAmendments(entry, ksfo);
        return !result.ok || result.amendments.length > 0;
      })
      .map(label);
    expect(dirty).toEqual([]);
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
      .filter((entry) => !ScenarioSchema.safeParse(entry).success)
      .map(label);
    expect(invalid).toEqual([]);
  });

  it('covers every time bucket and every runway configuration', () => {
    const buckets = new Set(generated.map((entry) => timeBucket(entry.localTime)));
    expect([...buckets].sort()).toEqual(['day', 'late night', 'night']);
    const configs = new Set(generated.map((entry) => entry.runwayConfigId));
    for (const config of ksfo.runwayConfigs) {
      expect(configs, `configuration ${config.id} was never drawn`).toContain(config.id);
    }
  });

  it('draws configurations by their training weight', () => {
    const lopsided: AirportData = {
      ...ksfo,
      runwayConfigs: ksfo.runwayConfigs.map((config) => ({
        ...config,
        trainingWeight: config.id === '19/19' ? 1000 : 1,
      })),
    };
    const drawn = FILTERED_SEEDS.map(
      (seed) => generateScenario(createRng(seed), lopsided, ANY_SCENARIO).runwayConfigId,
    );
    const nineteens = drawn.filter((id) => id === '19/19').length;
    expect(nineteens / drawn.length).toBeGreaterThanOrEqual(0.95);
    const counts = new Map<string, number>();
    for (const entry of generated) {
      const id = entry.runwayConfigId;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
    expect(ranked[0]?.[0]).toBe('28/01');
  });

  it('departs the runway the SOP sends that direction off', () => {
    const wrongRunway = generated
      .filter((entry) => {
        const config = ksfo.runwayConfigs.find((row) => row.id === entry.runwayConfigId);
        const direction = directionFor(entry);
        if (config === undefined || direction === undefined) return false;
        if (defaultRunwayFor(config, classOf(entry)) !== undefined) return false;
        const family = entry.departureRunway.slice(0, 2);
        const preferred = ksfo.directionRunwayPreference[config.plan]?.[direction]?.[family];
        return preferred !== undefined && preferred !== entry.departureRunway;
      })
      .map(label);
    expect(wrongRunway).toEqual([]);
  });

  it('sends northbound SFOW departures off the 01s from 1R and southbound ones from 1L', () => {
    const offThe01s = generated.filter(
      (entry) =>
        entry.departureRunway.startsWith('01') &&
        ksfo.runwayConfigs.find((row) => row.id === entry.runwayConfigId)?.plan === 'SFOW',
    );
    const north = offThe01s.filter((entry) => directionFor(entry) === 'north');
    const south = offThe01s.filter((entry) => directionFor(entry) === 'south');
    expect(north.length).toBeGreaterThan(0);
    expect(south.length).toBeGreaterThan(0);
    expect(north.filter((entry) => entry.departureRunway !== '01R').map(label)).toEqual([]);
    expect(south.filter((entry) => entry.departureRunway !== '01L').map(label)).toEqual([]);
  });

  it('a turboprop in 28/01 departs 28R by default, unless its TEC route moves it off', () => {
    const propsAndTurboprops = drawnIn('28/01', ['P', 'T']);
    expect(propsAndTurboprops.length).toBeGreaterThan(0);
    const offDefault = propsAndTurboprops.filter((entry) => entry.departureRunway !== '28R');
    const unmoved = offDefault.filter(
      (entry) =>
        usableTecRouteOn('28R', entry, ksfo) !== undefined ||
        usableTecRouteOn(entry.departureRunway, entry, ksfo) === undefined,
    );
    expect(unmoved.map(label)).toEqual([]);
  });

  it('a jet in 28/01 departs the 01s', () => {
    const jetDefaults = ksfo.runwayConfigs
      .filter((config) => config.id === '28/01')
      .map((config) => defaultRunwayFor(config, 'J'));
    expect(jetDefaults).toEqual([undefined]);
    const jets = drawnIn('28/01', ['J']);
    expect(jets.filter((entry) => entry.departureRunway.startsWith('01')).length).toBeGreaterThan(
      0,
    );
    expect(jets.filter((entry) => entry.departureRunway === '28R').map(label)).toEqual([]);
  });

  it('draws a heavy in 28/01 both off the 28s it may ask for and off the advertised 01s', () => {
    const heavies = generated.filter(
      (entry) => entry.runwayConfigId === '28/01' && fleetOf(entry).wtc === 'H',
    );
    expect(heavies.length).toBeGreaterThan(0);
    const requested = heavies.filter((entry) => entry.departureRunway === '28L');
    const advertised = heavies.filter((entry) => entry.departureRunway.startsWith('01'));
    expect(requested.length).toBeGreaterThan(0);
    expect(advertised.length).toBeGreaterThan(0);
    expect(heavies.length).toBe(requested.length + advertised.length);
  });

  it('files the request in the remarks of every flight drawn onto a runway it asked for', () => {
    const asked = generated.filter((entry) => entry.remarks !== undefined);
    console.log(`[seeds 0..${SEEDS.length - 1}] ${asked.length} scenarios filed remarks`);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.filter((entry) => !departsOnRequestRunway(entry)).map(label)).toEqual([]);
    const misremarked = asked.filter(
      (entry) => entry.remarks !== `REQ RWY ${entry.departureRunway.slice(0, 2)}`,
    );
    expect(misremarked.map(label)).toEqual([]);
  });

  it('never departs a runway it had to ask for without the remark that asked', () => {
    const silent = generated.filter((entry) => entry.remarks === undefined);
    expect(silent.length).toBeGreaterThan(0);
    expect(silent.filter(departsOnRequestRunway).map(label)).toEqual([]);
  });

  it('never gives the 28s of 28/01 to a light jet that cannot ask for them', () => {
    const lightJets = generated.filter(
      (entry) =>
        entry.runwayConfigId === '28/01' &&
        fleetOf(entry).class === 'J' &&
        fleetOf(entry).wtc === 'L' &&
        !mayRequestThe28s(entry),
    );
    expect(lightJets.length).toBeGreaterThan(0);
    expect(lightJets.filter((entry) => entry.departureRunway.startsWith('28')).map(label)).toEqual(
      [],
    );
  });

  it('redraws rather than presenting a plan the amendment engine would amend', () => {
    const redrawn = SEEDS.map((seed) => drawScenario(createRng(seed), ksfo, ANY_SCENARIO)).filter(
      isUnresolved,
    );
    console.log(
      [
        `[seeds 0..${SEEDS.length - 1}] ${redrawn.length} raw draws were redrawn; most common:`,
        ...topRejections(redrawn),
      ].join('\n'),
    );
    expect(redrawn.length).toBeLessThan(MAX_REDRAWN);
  });

  it('presents the non-RNAV prop the noise window sends off the 01s on the runway heading', () => {
    const night = drawnUnder({ time: 'night', config: { kind: 'any' } }, NIGHT_HEADING_SEEDS);
    const headings = night.filter((scenario) => {
      const result = resolveClearance(scenario, ksfo);
      return result.ok && result.clearance.procedure.value.kind === 'heading';
    });
    console.log(
      `[night, seeds 0..${NIGHT_HEADING_SEEDS.length - 1}] ${headings.length} draws are cleared on the runway heading`,
    );
    expect(headings.map(label).length).toBeGreaterThan(0);
    for (const scenario of headings) {
      expect(classOf(scenario), label(scenario)).toBe('P');
      expect(scenario.departureRunway.startsWith('01'), label(scenario)).toBe(true);
      expect(
        ksfo.equipmentSuffixes.find((row) => row.suffix === scenario.equipmentSuffix)?.rnav ??
          false,
        label(scenario),
      ).toBe(false);
      expect(isSidToken(scenario.filedRoute.split(' ')[0] ?? ''), label(scenario)).toBe(false);
      const window = ksfo.noiseWindows.find((row) => row.id === 'night');
      expect(
        window !== undefined && isNoiseWindowActive(window, scenario.localTime, scenario.dayOfWeek),
        label(scenario),
      ).toBe(true);
    }
  });
});

const PROP_CLASSES: AircraftClass[] = ['P', 'T'];

/** The 28/01 configuration with its 28L row turned into the prop default for the airline PCM. */
function pcmOff28L(): RunwayConfig {
  const config = ksfo.runwayConfigs.find((row) => row.id === '28/01');
  if (config === undefined) throw new Error('KSFO has no 28/01 configuration');
  return {
    ...config,
    departureRunways: config.departureRunways.map((row) =>
      row.runway !== '28L'
        ? row
        : { ...row, classes: PROP_CLASSES, defaultForAirlines: ['PCM'], onRequestFor: [] },
    ),
  };
}

/** A fleet row of the turboprop class, which both defaults in 28/01 address. */
function turbopropFleet(): FleetEntry {
  const entry = ksfo.routeLibrary.fleet.find((row) => row.class === 'T');
  if (entry === undefined) throw new Error('KSFO has no turboprop fleet row');
  return entry;
}

/** KSFO with the group that takes the jets whole and adds the Dash 8 by type. */
function groupedAirport(): AirportData {
  return { ...ksfo, aircraftGroups: { jets_and_dh8d: { classes: ['J'], types: ['DH8D'] } } };
}

/** The 28/01 configuration with a 30 added that the jets-and-Dash-8 group departs by default. */
function dash8Off30(): RunwayConfig {
  const config = ksfo.runwayConfigs.find((row) => row.id === '28/01');
  if (config === undefined) throw new Error('KSFO has no 28/01 configuration');
  return {
    ...config,
    departureRunways: [
      ...config.departureRunways,
      {
        runway: '30',
        classes: PROP_CLASSES,
        defaultForAirlines: [],
        defaultForGroups: ['jets_and_dh8d'],
        defaultForClasses: [],
        onRequestFor: [],
      },
    ],
  };
}

/** A fleet row of the Dash 8, the turboprop the group adds by type. */
function dash8Fleet(): FleetEntry {
  return { ...turbopropFleet(), type: 'DH8D' };
}

describe('pickRunway', () => {
  it('departs a defaulted airline off its own runway, ahead of the class default', () => {
    const picked = pickRunway(createRng(1), {
      airport: ksfo,
      config: pcmOff28L(),
      fleet: turbopropFleet(),
      callsign: 'PCM7679',
      direction: 'north',
      mayRequest: true,
    });
    expect(picked).toStrictEqual({ runway: '28L', requested: false });
  });

  it('departs a prop of another airline off the class default', () => {
    const picked = pickRunway(createRng(1), {
      airport: ksfo,
      config: pcmOff28L(),
      fleet: turbopropFleet(),
      callsign: 'SKW1234',
      direction: 'north',
      mayRequest: true,
    });
    expect(picked).toStrictEqual({ runway: '28R', requested: false });
  });

  it('departs a type the group adds off the group runway, ahead of the class default', () => {
    const picked = pickRunway(createRng(1), {
      airport: groupedAirport(),
      config: dash8Off30(),
      fleet: dash8Fleet(),
      callsign: 'QXE2451',
      direction: 'north',
      mayRequest: true,
    });
    expect(picked).toStrictEqual({ runway: '30', requested: false });
  });

  it('departs a turboprop outside the group off the class default', () => {
    const picked = pickRunway(createRng(1), {
      airport: groupedAirport(),
      config: dash8Off30(),
      fleet: turbopropFleet(),
      callsign: 'SKW1234',
      direction: 'north',
      mayRequest: true,
    });
    expect(picked).toStrictEqual({ runway: '28R', requested: false });
  });

  it('departs a registration off the class default, having no airline to default', () => {
    const picked = pickRunway(createRng(1), {
      airport: ksfo,
      config: pcmOff28L(),
      fleet: turbopropFleet(),
      callsign: 'N483KA',
      direction: 'north',
      mayRequest: true,
    });
    expect(picked).toStrictEqual({ runway: '28R', requested: false });
  });
});

describe('the scenario filter', () => {
  it('draws the scenario the unfiltered seed always drew', () => {
    const first = generateScenario(createRng(1), ksfo, ANY_SCENARIO);
    expect(first.callsign).toBe('SKW2811');
    expect(first.runwayConfigId).toBe('28 RT');
  });

  it('sets every day scenario between 0800 and 2159 local', () => {
    const day = drawnUnder({ time: 'day', config: { kind: 'any' } }, FILTERED_SEEDS);
    expect(day).toHaveLength(FILTERED_SEEDS.length);
    expect(day.filter((entry) => minuteOf(entry) < 8 * 60).map(label)).toEqual([]);
    expect(day.filter((entry) => minuteOf(entry) >= 22 * 60).map(label)).toEqual([]);
  });

  it('sets every night scenario between 2200 and 0759 local', () => {
    const night = drawnUnder({ time: 'night', config: { kind: 'any' } }, FILTERED_SEEDS);
    expect(night).toHaveLength(FILTERED_SEEDS.length);
    const daylight = night.filter(
      (entry) => minuteOf(entry) >= 8 * 60 && minuteOf(entry) < 22 * 60,
    );
    expect(daylight.map(label)).toEqual([]);
    expect(new Set(night.map((entry) => timeBucket(entry.localTime)))).toStrictEqual(
      new Set(['late night', 'night']),
    );
  });

  it('draws only the configurations of the plan it is narrowed to', () => {
    const east = drawnUnder(
      { time: 'either', config: { kind: 'plan', plan: 'SFOE' } },
      FILTERED_SEEDS,
    );
    expect(east).toHaveLength(FILTERED_SEEDS.length);
    const planOf = (entry: Scenario): string | undefined =>
      ksfo.runwayConfigs.find((row) => row.id === entry.runwayConfigId)?.plan;
    expect(east.filter((entry) => planOf(entry) !== 'SFOE').map(label)).toEqual([]);
    expect(new Set(east.map((entry) => entry.runwayConfigId)).size).toBeGreaterThan(1);
  });

  it('draws only the configuration whose id it is narrowed to', () => {
    const straightOut = drawnUnder(
      { time: 'either', config: { kind: 'id', id: '28 SO' } },
      FILTERED_SEEDS,
    );
    expect(straightOut).toHaveLength(FILTERED_SEEDS.length);
    expect(straightOut.filter((entry) => entry.runwayConfigId !== '28 SO').map(label)).toEqual([]);
  });

  it('refuses a configuration the airport does not have', () => {
    expect(() =>
      generateScenario(createRng(1), ksfo, { time: 'either', config: { kind: 'id', id: '07/07' } }),
    ).toThrow('07/07');
  });
});

describe('the forced destination', () => {
  /** The seeds the forced destination is measured over, in both halves of the trainer. */
  const DESTINATION_SEEDS = Array.from({ length: 50 }, (_value, index) => index);

  it('files every clearance-mode draw to the destination it names', () => {
    const drawn = DESTINATION_SEEDS.map((seed) =>
      generateScenario(createRng(seed), ksfo, { ...ANY_SCENARIO, destination: 'KLVK' }),
    );
    expect(drawn).toHaveLength(DESTINATION_SEEDS.length);
    expect(drawn.filter((entry) => entry.destination !== 'KLVK').map(label)).toEqual([]);
  });

  it('files every amendment-mode draw to the destination it names', () => {
    const drawn = DESTINATION_SEEDS.map((seed) =>
      generateAmendmentScenario(createRng(seed), ksfo, { ...ANY_SCENARIO, destination: 'KSMF' }),
    );
    expect(drawn).toHaveLength(DESTINATION_SEEDS.length);
    expect(
      drawn
        .filter((entry) => entry.filed.destination !== 'KSMF')
        .map((entry) => label(entry.filed)),
    ).toEqual([]);
  });

  it('refuses a destination the route library files nothing to', () => {
    const draw = (): Scenario =>
      generateScenario(createRng(1), ksfo, { ...ANY_SCENARIO, destination: 'KZZZ' });
    expect(draw).toThrow('KZZZ');
    expect(draw).toThrow('KSMF');
  });
});

describe('the route the draw files', () => {
  it('files the transition the noise row forces on a late-night southbound draw', () => {
    const drawn = drawnUnder(
      {
        time: 'night',
        config: { kind: 'id', id: '28/01' },
        destination: 'KSAN',
      },
      FILTERED_SEEDS,
    ).filter(
      (entry) =>
        timeBucket(entry.localTime) === 'late night' &&
        entry.departureRunway.startsWith('01') &&
        entry.filedRoute.startsWith('NIITE'),
    );
    expect(drawn.length).toBeGreaterThan(0);
    expect(
      drawn.filter((entry) => entry.filedRoute !== 'NIITE4 GOBBS YYUNG LAX COMIX2').map(label),
    ).toEqual([]);
  });
});

/** A flight drawn onto a runway, before its TEC route has been read. */
function drawnFlight(overrides: Partial<Scenario>): Scenario {
  return {
    callsign: 'N436MS',
    aircraftType: 'TBM9',
    equipmentSuffix: '/L',
    destination: 'KSMF',
    filedRoute: 'TRUKN FEVTA FEVTA1',
    filedAltitude: 10000,
    runwayConfigId: '28/01',
    departureRunway: '28R',
    localTime: '1300',
    dayOfWeek: 'tuesday',
    squawk: '4621',
    ...overrides,
  };
}

/** An RNAV jet drawn onto a KSFO runway, before its TEC route has been read. */
function rnavJet(overrides: Partial<Scenario>): Scenario {
  return drawnFlight({ callsign: 'SWA1', aircraftType: 'B738', ...overrides });
}

describe('tecRunway', () => {
  it('moves a TBM9 to KSMF in 28/01 off its class default 28R to 01R, where TRUKN is in use', () => {
    expect(tecRunway(drawnFlight({}), ksfo)).toBe('01R');
  });

  it('keeps an RNAV jet to KLVK on 28L in 28/01, where TEC-KLVK-SFOW-JT-28 is usable', () => {
    const flight = rnavJet({
      destination: 'KLVK',
      filedRoute: 'TRUKN ALTAM',
      departureRunway: '28L',
    });
    expect(tecRunway(flight, ksfo)).toBe('28L');
  });

  it('keeps an RNAV jet to KSMF on 28L in 28 SO, where TRUKN is in use from no runway', () => {
    const flight = rnavJet({ runwayConfigId: '28 SO', departureRunway: '28L' });
    expect(tecRunway(flight, ksfo)).toBe('28L');
  });

  it('moves an RNAV jet to KSMF in 01/01 off 01L, which TRUKN2 is not published from, to 01R', () => {
    const flight = rnavJet({ runwayConfigId: '01/01', departureRunway: '01L' });
    expect(tecRunway(flight, ksfo)).toBe('01R');
  });

  it('moves a KOAK prop to KMRY in SFOW off 33, which NUEVO8 is not published from, to 28L', () => {
    const flight = drawnFlight({
      callsign: 'N172SP',
      aircraftType: 'C172',
      equipmentSuffix: '/G',
      destination: 'KMRY',
      filedRoute: 'EUGEN',
      filedAltitude: 7000,
      runwayConfigId: 'SFOW',
      departureRunway: '33',
    });
    expect(tecRunway(flight, koak)).toBe('28L');
  });
});

describe('the on-request draw', () => {
  it('carries a SID published off the requested runway family alone on every requested draw', () => {
    const asked = generated.filter((entry) => entry.remarks !== undefined);
    expect(asked.length).toBeGreaterThan(0);
    const offFamily = asked.filter((entry) => {
      const result = resolveClearance(entry, ksfo);
      if (!result.ok) return true;
      const procedure = result.clearance.procedure.value;
      if (procedure.kind !== 'sid') return true;
      const sid = ksfo.sids.find((row) => row.id === procedure.id);
      const family = entry.departureRunway.slice(0, 2);
      return sid === undefined || sid.runways.some((runway) => runway.slice(0, 2) !== family);
    });
    expect(offFamily.map(label)).toEqual([]);
  });

  it('never lets the request of a heavy whose procedure is GAPP7 stand as REQ RWY 28', () => {
    const heavy = drawnFlight({
      callsign: 'UPS2896',
      aircraftType: 'A306',
      destination: 'KRNO',
      filedRoute: 'TRUKN CCR CCR2',
      filedAltitude: 35000,
      departureRunway: '28L',
      remarks: 'REQ RWY 28',
    });
    const result = resolveClearance(heavy, ksfo);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    const procedure = result.clearance.procedure.value;
    expect(procedure).toMatchObject({ kind: 'sid', family: 'GAPP' });
    expect(requestStands(procedure, heavy.departureRunway, ksfo)).toBe(false);
  });
});

/** The departure runways of the scenario's configuration listed for its class. */
function listedRunways(entry: Scenario, airport: AirportData): string[] {
  const config = airport.runwayConfigs.find((row) => row.id === entry.runwayConfigId);
  const aircraftClass = airport.aircraftClasses[entry.aircraftType];
  if (config === undefined || aircraftClass === undefined) {
    throw new Error(`${label(entry)} has no configuration or class in the data`);
  }
  return config.departureRunways
    .filter((row) => row.classes.includes(aircraftClass))
    .map((row) => row.runway);
}

describe('the runway a TEC-routed draw departs', () => {
  it.each([
    ['KSFO', ksfo, generated],
    ['KOAK', koak, SEEDS.map((seed) => generateScenario(createRng(seed), koak, ANY_SCENARIO))],
  ])(
    'is one its TEC route is usable from, at %s, wherever a runway of its class has one',
    (_icao, airport, drawn) => {
      const routed = drawn.filter((entry) =>
        listedRunways(entry, airport).some(
          (runway) => usableTecRouteOn(runway, entry, airport) !== undefined,
        ),
      );
      expect(routed.length).toBeGreaterThan(0);
      const stranded = routed.filter(
        (entry) => usableTecRouteOn(entry.departureRunway, entry, airport) === undefined,
      );
      expect(stranded.map(label)).toEqual([]);
    },
  );
});
