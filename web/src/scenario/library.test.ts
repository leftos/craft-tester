import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type {
  AirportData,
  DayOfWeek,
  FleetEntry,
  RouteLibraryEntry,
  RunwayConfig,
  Scenario,
} from '@/data/schema.ts';
import { resolveAmendments } from '@/rules/amend/engine.ts';
import { resolveClearance } from '@/rules/engine.ts';
import type { Unresolved } from '@/rules/types.ts';

const ksfo = ksfoJson as unknown as AirportData;

/** The conditions every combination is composed under: an ordinary weekday afternoon. */
const LOCAL_TIME = '1300';
const DAY_OF_WEEK: DayOfWeek = 'tuesday';
const SQUAWK = '1234';

/** The registration flown by the fleet types that fly without an airline. */
const REGISTRATION = 'N123AB';

/** One combination of the conditions a row may be drawn in. */
type Combination = {
  config: RunwayConfig;
  runway: string;
  fleet: FleetEntry;
  suffix: string | null;
  altitude: number;
};

/** What the enumeration made of one library row. */
type RowReport = {
  route: RouteLibraryEntry;
  clean: number;
  total: number;
  cleanAltitudes: Set<number>;
  /** The first reason each altitude was not the correct plan, which is what a failure reads. */
  reasons: Map<number, string>;
};

/** The callsign the row is drawn with, which `drawScenario` takes from the fleet row's airlines. */
function callsignFor(fleet: FleetEntry): string {
  const airline = fleet.airlines[0];
  return airline === undefined ? REGISTRATION : `${airline}100`;
}

/** The departure runways of a configuration this class may be assigned, each named once. */
function runwaysOf(config: RunwayConfig, fleet: FleetEntry): string[] {
  const runways = config.departureRunways
    .filter((assignment) => assignment.classes.includes(fleet.class))
    .map((assignment) => assignment.runway);
  return [...new Set(runways)];
}

/** Every combination of configuration, runway, fleet type, suffix and altitude a row may be drawn in. */
function combinationsOf(route: RouteLibraryEntry): Combination[] {
  const fleet = ksfo.routeLibrary.fleet.filter((entry) => route.classes.includes(entry.class));
  const combinations: Combination[] = [];
  for (const config of ksfo.runwayConfigs) {
    for (const entry of fleet) {
      for (const runway of runwaysOf(config, entry)) {
        for (const suffix of entry.suffixes) {
          for (const altitude of route.altitudes) {
            combinations.push({ config, runway, fleet: entry, suffix, altitude });
          }
        }
      }
    }
  }
  return combinations;
}

/** Reads a list of blocked elements the way a failing test names them. */
function gapsOf(gaps: readonly Unresolved[]): string {
  return gaps.map((gap) => `${gap.element}: ${gap.reason}`).join('; ');
}

/**
 * Why the plan this combination composes is not the correctly-filed one.
 *
 * The plan is composed the way `drawScenario` composes it: the row's tail is put to the clearance
 * engine, and the procedure the engine assigns is written at the head of the route box. The plan is
 * clean when the amendment engine resolves it and has nothing to amend, which is the definition the
 * draw itself rejects a combination by.
 *
 * @param route The route library row.
 * @param combination The conditions the row is drawn in.
 * @returns The gap or the first amendment that makes the plan unclean, or `undefined` when the plan
 *   needs no amendment.
 */
function uncleanReason(route: RouteLibraryEntry, combination: Combination): string | undefined {
  const filed: Scenario = {
    callsign: callsignFor(combination.fleet),
    aircraftType: combination.fleet.type,
    equipmentSuffix: combination.suffix,
    destination: route.destination,
    filedRoute: route.tail,
    filedAltitude: combination.altitude,
    runwayConfigId: combination.config.id,
    departureRunway: combination.runway,
    localTime: LOCAL_TIME,
    dayOfWeek: DAY_OF_WEEK,
    squawk: SQUAWK,
  };
  const result = resolveClearance(filed, ksfo);
  if (!result.ok) return gapsOf(result.unresolved);
  const clean: Scenario = {
    ...filed,
    filedRoute: `${result.clearance.sid.value.id} ${route.tail}`,
  };
  const amended = resolveAmendments(clean, ksfo);
  if (!amended.ok) return gapsOf(amended.unresolved);
  const amendment = amended.amendments[0];
  return amendment === undefined ? undefined : `${amendment.box}: ${amendment.reason}`;
}

/** Runs every combination of one row and counts the clean ones, altitude by altitude. */
function reportFor(route: RouteLibraryEntry): RowReport {
  const cleanAltitudes = new Set<number>();
  const reasons = new Map<number, string>();
  let clean = 0;
  const combinations = combinationsOf(route);
  for (const combination of combinations) {
    const reason = uncleanReason(route, combination);
    if (reason === undefined) {
      clean += 1;
      cleanAltitudes.add(combination.altitude);
      continue;
    }
    if (!reasons.has(combination.altitude)) reasons.set(combination.altitude, reason);
  }
  return { route, clean, total: combinations.length, cleanAltitudes, reasons };
}

/** How a row reads in a test name and in the rates table. */
function label(route: RouteLibraryEntry): string {
  return `${route.exitFix} -> ${route.destination} ${route.tail} [${route.classes.join('')}]`;
}

const reports: RowReport[] = ksfo.routeLibrary.routes.map(reportFor);

describe('every route library row is the correct plan somewhere', () => {
  for (const report of reports) {
    it(`${label(report.route)} is clean in at least one combination`, () => {
      const dirty = report.route.altitudes.filter((feet) => !report.cleanAltitudes.has(feet));
      const why = dirty.map((feet) => `${feet}: ${report.reasons.get(feet)}`).join('\n');
      expect(report.clean, why).toBeGreaterThan(0);
      expect(dirty, why).toEqual([]);
    });
  }

  it('reports how often every row is the correct plan', () => {
    const lines = [...reports]
      .sort((left, right) => left.clean / left.total - right.clean / right.total)
      .map(
        (report) =>
          `${label(report.route)} altitudes: ${report.route.altitudes.join('/')}: clean ${report.clean} of ${report.total}`,
      );
    console.log(['route library clean rates:', ...lines].join('\n'));
    expect(reports.length).toBe(ksfo.routeLibrary.routes.length);
  });
});
