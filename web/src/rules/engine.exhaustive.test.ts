import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AircraftClass, AirportData, RouteLibraryEntry, Scenario } from '@/data/schema.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { directionOf } from '@/rules/route.ts';
import type { EngineResult } from '@/rules/types.ts';

const ksfo = ksfoJson as unknown as AirportData;

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

/** Every fix that some SID publishes as an enroute transition. */
const ENROUTE_TRANSITION_FIXES = new Set(
  ksfo.sids.flatMap((sid) =>
    sid.transitions.filter((transition) => transition.kind === 'enroute').map((t) => t.fix),
  ),
);

/** The rows that clear a flight without a procedure, which v1 deliberately cannot issue. */
const NON_DP_ROW_TEXTS = new Set(
  ksfo.assignmentRules.filter((row) => row.nonDpHeading !== undefined).map((row) => row.text),
);

/** One enumerated scenario plus the facts the assertions are keyed by. */
type Combination = {
  scenario: Scenario;
  exitFix: string;
  plan: string;
  runwayFamily: string;
  label: string;
};

/** A sample fleet type of each class, so the scenarios use types the data knows. */
function typeOfClass(aircraftClass: AircraftClass): string {
  const entry = ksfo.routeLibrary.fleet.find((fleet) => fleet.class === aircraftClass);
  if (entry === undefined) throw new Error(`the fleet has no ${aircraftClass} type`);
  return entry.type;
}

/** One curated route per exit fix that the class may fly. */
function routesOfClass(aircraftClass: AircraftClass): RouteLibraryEntry[] {
  const chosen = new Map<string, RouteLibraryEntry>();
  for (const route of ksfo.routeLibrary.routes) {
    if (route.classes.includes(aircraftClass) && !chosen.has(route.exitFix)) {
      chosen.set(route.exitFix, route);
    }
  }
  return [...chosen.values()];
}

/** Every config, departure runway, class, equipment, gate fix, time, and notice state. */
function enumerateCombinations(): Combination[] {
  const combinations: Combination[] = [];
  for (const config of ksfo.runwayConfigs) {
    for (const assignment of config.departureRunways) {
      for (const aircraftClass of CLASSES) {
        for (const route of routesOfClass(aircraftClass)) {
          for (const equipmentSuffix of ['/L', '/A'] as const) {
            for (const time of TIME_BUCKETS) {
              for (const notices of NOTICE_SETS) {
                const base: Scenario = {
                  callsign: 'TST123',
                  aircraftType: typeOfClass(aircraftClass),
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
function departsPreferredRunway(combination: Combination): boolean {
  const direction = directionOf(combination.exitFix, ksfo.gates);
  if (direction === undefined) return false;
  const preferred =
    ksfo.directionRunwayPreference[combination.plan]?.[direction]?.[combination.runwayFamily];
  return preferred === undefined || preferred === combination.scenario.departureRunway;
}

/** A clearance the SOP deliberately withholds: the row sends the flight off without a procedure. */
function isNonDpRow(result: EngineResult): boolean {
  return !result.ok && result.unresolved.some((item) => NON_DP_ROW_TEXTS.has(item.reason));
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

const combinations = enumerateCombinations();
const outcomes = combinations.map((combination) => ({
  combination,
  result: resolveClearance(combination.scenario, ksfo),
}));

const unresolvedGroups = new Map<string, { count: number; example: string }>();
for (const { combination, result } of outcomes) {
  if (result.ok) continue;
  for (const item of result.unresolved) {
    const key = `${item.element} | ${item.reason}`;
    const group = unresolvedGroups.get(key);
    if (group === undefined) {
      unresolvedGroups.set(key, { count: 1, example: combination.label });
    } else {
      group.count += 1;
    }
  }
}

describe('every reachable KSFO scenario', () => {
  it('reports the combinations the data cannot clear', () => {
    const resolved = outcomes.filter((outcome) => outcome.result.ok).length;
    console.info(
      [
        `KSFO engine enumeration: ${resolved} of ${outcomes.length} combinations resolved,`,
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
          ENROUTE_TRANSITION_FIXES.has(outcome.combination.exitFix) &&
          departsPreferredRunway(outcome.combination) &&
          !outcome.result.ok &&
          !isNonDpRow(outcome.result),
      )
      .map((outcome) => `${outcome.combination.label}`);
    expect(gaps).toEqual([]);
  });

  it('cites at least one data row on every element of every clearance it does resolve', () => {
    const uncited: string[] = [];
    for (const { combination, result } of outcomes) {
      if (!result.ok) continue;
      const { clearedTo, sid, route, altitude, expect: expectClause, frequency } = result.clearance;
      const elements = { clearedTo, sid, route, altitude, expect: expectClause, frequency };
      for (const [element, cited] of Object.entries(elements)) {
        if (cited.citations.length === 0) uncited.push(`${element}: ${combination.label}`);
      }
    }
    expect(uncited).toEqual([]);
  });
});
