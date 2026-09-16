import { describe, expect, it } from 'vitest';
import { checkedInAirports } from '@/data/checkedIn.ts';
import type { AircraftClass, AirportData, RouteLibraryEntry, Scenario } from '@/data/schema.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { directionOf } from '@/rules/route.ts';
import type { EngineResult } from '@/rules/types.ts';

const CLASSES: readonly AircraftClass[] = ['P', 'T', 'J'];

/** Midday, inside the night window, inside both night windows, and the later Sunday end. */
const TIME_BUCKETS = [
  { localTime: '1400', dayOfWeek: 'tuesday' },
  { localTime: '2300', dayOfWeek: 'tuesday' },
  { localTime: '0300', dayOfWeek: 'tuesday' },
  { localTime: '0730', dayOfWeek: 'sunday' },
] as const;

/** The notices a scenario can present: the data's defaults, or none at all. */
const NOTICE_SETS = [
  { label: 'default notices', activeNotices: undefined },
  { label: 'no notices', activeNotices: [] },
] as const;

/** One enumerated scenario plus the facts the assertions are keyed by. */
type Combination = {
  scenario: Scenario;
  exitFix: string;
  plan: string;
  runwayFamily: string;
  label: string;
};

/** One enumerated scenario and what the engine made of it. */
type Outcome = {
  combination: Combination;
  result: EngineResult;
};

/** How many combinations hit one `element + reason`, and the first combination that did. */
type UnresolvedGroups = Map<string, { count: number; example: string }>;

/** The facts about one airport's data that the assertions key on. */
type AirportFacts = {
  /** Every fix that some SID publishes as an enroute transition. */
  enrouteTransitionFixes: ReadonlySet<string>;
  /** The rows that clear a flight without a procedure, which v1 deliberately cannot issue. */
  nonDpRowTexts: ReadonlySet<string>;
};

/** Reads the two sets the assertions key on out of one airport's data. */
function airportFacts(data: AirportData): AirportFacts {
  return {
    enrouteTransitionFixes: new Set(
      data.sids.flatMap((sid) =>
        sid.transitions.filter((transition) => transition.kind === 'enroute').map((t) => t.fix),
      ),
    ),
    nonDpRowTexts: new Set(
      data.assignmentRules.filter((row) => row.nonDpHeading !== undefined).map((row) => row.text),
    ),
  };
}

/** A sample fleet type of each class, so the scenarios use types the data knows. */
function typeOfClass(data: AirportData, aircraftClass: AircraftClass): string {
  const entry = data.routeLibrary.fleet.find((fleet) => fleet.class === aircraftClass);
  if (entry === undefined) throw new Error(`the fleet has no ${aircraftClass} type`);
  return entry.type;
}

/** One curated route per exit fix that the class may fly. */
function routesOfClass(data: AirportData, aircraftClass: AircraftClass): RouteLibraryEntry[] {
  const chosen = new Map<string, RouteLibraryEntry>();
  for (const route of data.routeLibrary.routes) {
    if (route.classes.includes(aircraftClass) && !chosen.has(route.exitFix)) {
      chosen.set(route.exitFix, route);
    }
  }
  return [...chosen.values()];
}

/** Every config, departure runway, class, equipment, gate fix, time, and notice state. */
function enumerateCombinations(data: AirportData): Combination[] {
  const combinations: Combination[] = [];
  for (const config of data.runwayConfigs) {
    for (const assignment of config.departureRunways) {
      for (const aircraftClass of CLASSES) {
        for (const route of routesOfClass(data, aircraftClass)) {
          for (const equipmentSuffix of ['/L', '/A'] as const) {
            for (const time of TIME_BUCKETS) {
              for (const notices of NOTICE_SETS) {
                const base: Scenario = {
                  callsign: 'TST123',
                  aircraftType: typeOfClass(data, aircraftClass),
                  equipmentSuffix,
                  destination: route.destination,
                  filedRoute: route.tail,
                  filedAltitude: route.altitudes[0] ?? 10000,
                  runwayConfigId: config.id,
                  departureRunway: assignment.runway,
                  localTime: time.localTime,
                  dayOfWeek: time.dayOfWeek,
                  squawk: '1234',
                };
                const scenario = Object.assign(
                  base,
                  notices.activeNotices === undefined
                    ? {}
                    : { activeNotices: [...notices.activeNotices] },
                );
                combinations.push({
                  scenario,
                  exitFix: route.exitFix,
                  plan: config.plan,
                  runwayFamily: assignment.runway.slice(0, 2),
                  label: `${config.id} ${assignment.runway} ${aircraftClass} ${
                    equipmentSuffix === '/L' ? 'RNAV' : 'non-RNAV'
                  } via ${route.exitFix} at ${time.localTime} ${time.dayOfWeek}, ${notices.label}`,
                });
              }
            }
          }
        }
      }
    }
  }
  return combinations;
}

/** Whether the flight departs the runway the plan sends that direction off, as the SOP does. */
function departsPreferredRunway(data: AirportData, combination: Combination): boolean {
  const direction = directionOf(combination.exitFix, data.gates);
  if (direction === undefined) return false;
  const preferred =
    data.directionRunwayPreference[combination.plan]?.[direction]?.[combination.runwayFamily];
  return preferred === undefined || preferred === combination.scenario.departureRunway;
}

/** A clearance the SOP deliberately withholds: the row sends the flight off without a procedure. */
function isNonDpRow(facts: AirportFacts, result: EngineResult): boolean {
  return !result.ok && result.unresolved.some((item) => facts.nonDpRowTexts.has(item.reason));
}

/** Counts every blocked element of every outcome against its `element + reason` group. */
function groupUnresolved(outcomes: readonly Outcome[]): UnresolvedGroups {
  const groups: UnresolvedGroups = new Map();
  for (const { combination, result } of outcomes) {
    if (result.ok) continue;
    for (const item of result.unresolved) {
      const key = `${item.element} | ${item.reason}`;
      const group = groups.get(key);
      if (group === undefined) {
        groups.set(key, { count: 1, example: combination.label });
      } else {
        group.count += 1;
      }
    }
  }
  return groups;
}

/** One line per `element + reason`, with how many combinations hit it and one that did. */
function formatGroups(groups: ReadonlyMap<string, { count: number; example: string }>): string {
  const lines = [...groups.entries()]
    .sort(([, left], [, right]) => right.count - left.count)
    .map(
      ([key, group]) =>
        `  ${String(group.count).padStart(5)}  ${key}\n           e.g. ${group.example}`,
    );
  return lines.join('\n');
}

describe.each(checkedInAirports())('every reachable $icao scenario', ({ icao, data }) => {
  const facts = airportFacts(data);
  const combinations = enumerateCombinations(data);
  const outcomes: Outcome[] = combinations.map((combination) => ({
    combination,
    result: resolveClearance(combination.scenario, data),
  }));
  const unresolvedGroups = groupUnresolved(outcomes);

  it('reports the combinations the data cannot clear', () => {
    const resolved = outcomes.filter((outcome) => outcome.result.ok).length;
    console.info(
      [
        `${icao} engine enumeration: ${resolved} of ${outcomes.length} combinations resolved,`,
        `${unresolvedGroups.size} unresolved groups (count, element, reason, example):`,
        formatGroups(unresolvedGroups),
      ].join('\n'),
    );
    expect(combinations.length).toBeGreaterThan(1000);
    expect(resolved).toBeGreaterThan(0);
  });

  it('clears every flight leaving on a published enroute transition from its SOP runway', () => {
    const gaps = outcomes
      .filter(
        (outcome) =>
          facts.enrouteTransitionFixes.has(outcome.combination.exitFix) &&
          departsPreferredRunway(data, outcome.combination) &&
          !outcome.result.ok &&
          !isNonDpRow(facts, outcome.result),
      )
      .map((outcome) => `${outcome.combination.label}`);
    expect(gaps).toEqual([]);
  });

  it('cites at least one data row on every element of every clearance it does resolve', () => {
    const uncited: string[] = [];
    for (const { combination, result } of outcomes) {
      if (!result.ok) continue;
      const {
        clearedTo,
        procedure,
        route,
        altitude,
        expect: expectClause,
        frequency,
      } = result.clearance;
      const elements = { clearedTo, procedure, route, altitude, expect: expectClause, frequency };
      for (const [element, cited] of Object.entries(elements)) {
        if (cited.citations.length === 0) uncited.push(`${element}: ${combination.label}`);
      }
    }
    expect(uncited).toEqual([]);
  });
});
