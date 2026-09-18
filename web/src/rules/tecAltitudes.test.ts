import { describe, expect, it } from 'vitest';
import { checkedInAirports } from '@/data/checkedIn.ts';
import type {
  AirportData,
  DayOfWeek,
  FleetEntry,
  RunwayConfig,
  Scenario,
  TecRoute,
} from '@/data/schema.ts';
import { classify } from '@/rules/classify.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { tecHead, tecTokens, usableTecRoute } from '@/rules/tecRoutes.ts';
import type { ResolvedClearance } from '@/rules/types.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

/** The conditions every combination is composed under: an ordinary weekday afternoon. */
const LOCAL_TIME = '1300';
const DAY_OF_WEEK: DayOfWeek = 'tuesday';
const SQUAWK = '1234';

/** The registration flown by the fleet types that fly without an airline. */
const REGISTRATION = 'N123AB';

/** One flight the row could be issued to, with the label a finding names it by. */
type Combination = { scenario: Scenario; label: string };

/** Combinations counted under one key, with the first combination that gave it. */
type Tally = Map<string, { label: string; count: number }>;

/**
 * What the enumeration made of one row: the flights it routes, what each was cleared on, and what
 * the SOP rows alone would have cleared each flight to.
 */
type RowReport = {
  row: TecRoute;
  /** How many combinations the row was in fact the flight's TEC row for. */
  routed: number;
  /** The routed combinations the engine leaves unresolved, by reason. */
  unresolved: Tally;
  /** The routed combinations cleared on another procedure than the family the row begins on. */
  offProcedure: Tally;
  /** The routed combinations on a heading row whose SOP row answers otherwise, by that answer. */
  replaced: Tally;
  /** How many routed combinations the SOP rows name no altitude for, which cannot be compared. */
  unreadable: number;
  /** One line per distinct SOP altitude that differs from the initial altitude the row overrides it with. */
  differences: string[];
};

/** A distinct SOP altitude reading, with the first combination that gave it and how many did. */
type AltitudeGroup = { label: string; phrase: string; climbed: number; count: number };

/** Counts one combination under a key. */
function tally(counts: Tally, key: string, label: string): void {
  const entry = counts.get(key);
  if (entry === undefined) counts.set(key, { label, count: 1 });
  else entry.count += 1;
}

/** One line per key of a tally, with its count and the first combination that gave it. */
function tallyLines(counts: Tally): string[] {
  return [...counts].map(([key, { label, count }]) => `${key} (${count}, e.g. ${label})`);
}

/** The callsign the flight is composed with, which `drawScenario` takes from the fleet row. */
function callsignFor(fleet: FleetEntry): string {
  const airline = fleet.airlines[0];
  return airline === undefined ? REGISTRATION : `${airline}100`;
}

/** The departure runways of a configuration the row is written for, each named once. */
function runwaysOf(row: TecRoute, config: RunwayConfig): string[] {
  const families = row.runwayFamilies;
  const runways = config.departureRunways
    .map((assignment) => assignment.runway)
    .filter((runway) => families.length === 0 || families.includes(runway.slice(0, 2)));
  return [...new Set(runways)];
}

/**
 * Every flight the row could be the TEC route of, filed on the row's own route and final altitude.
 *
 * The plan the row is written for names its configurations, those name the departure runways the
 * row's families allow, and the classes name the fleet types and the suffixes each type files. The
 * route is the row's, at the SID versions in force; a row naming a family the airport no longer
 * publishes has no route to file, so it composes nothing.
 *
 * @param row The TEC route row under audit.
 * @param airport The airport data.
 * @returns One combination per configuration, runway, type and suffix.
 */
function combinationsOf(row: TecRoute, airport: AirportData): Combination[] {
  const tokens = tecTokens(row, airport);
  if (isUnresolved(tokens)) return [];
  const fleet = airport.routeLibrary.fleet.filter((entry) => row.classes.includes(entry.class));
  const combinations: Combination[] = [];
  for (const config of airport.runwayConfigs.filter((entry) => entry.plan === row.plan)) {
    for (const runway of runwaysOf(row, config)) {
      for (const entry of fleet) {
        for (const suffix of entry.suffixes) {
          combinations.push({
            scenario: {
              callsign: callsignFor(entry),
              aircraftType: entry.type,
              equipmentSuffix: suffix,
              destination: row.destination,
              filedRoute: tokens.join(' '),
              filedAltitude: row.finalAltitudeFeet ?? 0,
              runwayConfigId: config.id,
              departureRunway: runway,
              localTime: LOCAL_TIME,
              dayOfWeek: DAY_OF_WEEK,
              squawk: SQUAWK,
            },
            label: `${config.id} ${runway} ${entry.type}${suffix}`,
          });
        }
      }
    }
  }
  return combinations;
}

/**
 * The altitude the clearance climbs the flight to.
 *
 * A clearance that speaks an altitude — "maintain 5,000", "climb via SID except maintain 9,000" —
 * climbs the flight to the one it speaks. A plain "climb via SID" speaks none, so the flight climbs
 * to the SID's published top altitude, and where the chart publishes none there is no altitude to
 * audit at all.
 *
 * @param clearance The clearance the engine resolved.
 * @param airport The airport data, whose `sids` carry the published top altitude.
 * @returns The altitude in feet, or `undefined` where the clearance names none.
 */
function climbedTo(clearance: ResolvedClearance, airport: AirportData): number | undefined {
  const spoken = clearance.altitude.value.feet;
  if (spoken !== undefined) return spoken;
  const procedure = clearance.procedure.value;
  if (procedure.kind !== 'sid') return undefined;
  const topAltitude = airport.sids.find((entry) => entry.id === procedure.id)?.topAltitude;
  return topAltitude?.kind === 'published' ? topAltitude.feet : undefined;
}

/** The same airport data with one row's initial altitude removed, which is the SOP-only reading. */
function withoutInitial(row: TecRoute, airport: AirportData): AirportData {
  return {
    ...airport,
    tecRoutes: airport.tecRoutes.map((entry) =>
      entry.id === row.id ? { ...entry, initialAltitudeFeet: undefined } : entry,
    ),
  };
}

/**
 * How the assignment row a clearance cites first answers the flight, read off that row's data.
 *
 * The row is the one the table walk reached; a notice cited with it that issues a heading for the
 * row's family is its answer, and otherwise the row's own family or heading is.
 */
function sopAnswer(clearance: ResolvedClearance, airport: AirportData): string {
  const [first, ...rest] = clearance.procedure.citations;
  const row = airport.assignmentRules.find((entry) => entry.id === first?.id);
  if (row === undefined) return 'no assignment row';
  const notice = airport.notices.find(
    (entry) =>
      rest.some((citation) => citation.id === entry.id) &&
      entry.effect.sidFamily === row.sidFamily &&
      entry.effect.heading !== undefined,
  );
  if (notice !== undefined) return `heading ${notice.effect.heading} (${row.id}, ${notice.id})`;
  if (row.sidFamily !== null) return `${row.sidFamily}# (${row.id})`;
  return `heading ${row.nonDpHeading} (${row.id})`;
}

/**
 * Records what a routed flight was cleared on against what its row begins on.
 *
 * A family-headed row's flight is expected on that family; a flight cleared on anything else is
 * tallied for the invariant to fail on. A heading-headed row's flight is tallied where the SOP row
 * the walk reached would have answered otherwise, which is where the row replaces the SOP's answer.
 */
function recordProcedure(
  report: RowReport,
  clearance: ResolvedClearance,
  label: string,
  airport: AirportData,
): void {
  const head = tecHead(report.row);
  const procedure = clearance.procedure.value;
  if (head.kind === 'family') {
    if (procedure.kind !== 'sid' || procedure.family !== head.family) {
      tally(report.offProcedure, procedure.spoken, label);
    }
    return;
  }
  if (head.kind !== 'heading') return;
  const answer = sopAnswer(clearance, airport);
  if (!answer.startsWith(`heading ${head.heading} `)) {
    tally(
      report.replaced,
      `the SOP answers ${answer}, the row issues heading ${head.heading}`,
      label,
    );
  }
}

/**
 * Records what the SOP rows alone would clear a routed flight to, where it differs from the row's
 * initial altitude.
 *
 * The clearance is resolved against a copy of the airport whose row states no initial altitude,
 * which is the reading the SOP rows alone give. A SOP reading that names no altitude at all cannot
 * be compared and is counted instead.
 */
function recordAltitude(
  report: RowReport,
  groups: Map<string, AltitudeGroup>,
  combination: Combination,
  sopAirport: AirportData,
): void {
  const { scenario, label } = combination;
  const sopResult = resolveClearance(scenario, sopAirport);
  const climbed = sopResult.ok ? climbedTo(sopResult.clearance, sopAirport) : undefined;
  if (!sopResult.ok || climbed === undefined) {
    report.unreadable += 1;
    return;
  }
  if (climbed === report.row.initialAltitudeFeet) return;
  const phrase = sopResult.clearance.altitude.value.phrase;
  const key = `${phrase} ${climbed}`;
  const group = groups.get(key);
  if (group === undefined) groups.set(key, { label, phrase, climbed, count: 1 });
  else group.count += 1;
}

/**
 * Enumerates every flight the row could route, and reports what each routed one was cleared on.
 *
 * A combination counts only where the row is in fact the flight's TEC row: the first row keyed to
 * the destination, plan, runway family and class whose departure the flight can use, which is the
 * row choice the engine makes. A routed flight the engine leaves unresolved is tallied by reason;
 * one it resolves has its procedure recorded, and, on a row that states an initial altitude, the SOP
 * reading that initial altitude overrides.
 *
 * @param row The TEC route row under report.
 * @param airport The airport data.
 * @returns What the enumeration made of the row.
 */
function auditRow(row: TecRoute, airport: AirportData): RowReport {
  const sopAirport = withoutInitial(row, airport);
  const report: RowReport = {
    row,
    routed: 0,
    unresolved: new Map(),
    offProcedure: new Map(),
    replaced: new Map(),
    unreadable: 0,
    differences: [],
  };
  const groups = new Map<string, AltitudeGroup>();
  for (const combination of combinationsOf(row, airport)) {
    const { scenario, label } = combination;
    const ctx = classify(scenario, airport);
    if (isUnresolved(ctx) || usableTecRoute(ctx, scenario, airport) !== row) continue;
    report.routed += 1;
    const result = resolveClearance(scenario, airport);
    if (!result.ok) {
      tally(report.unresolved, result.unresolved.map((item) => item.reason).join('; '), label);
      continue;
    }
    recordProcedure(report, result.clearance, label, airport);
    if (row.initialAltitudeFeet !== undefined) {
      recordAltitude(report, groups, combination, sopAirport);
    }
  }
  for (const group of groups.values()) {
    report.differences.push(
      `${row.id}: the SOP rows alone would clear ${group.label} "${group.phrase}" to ${group.climbed} on ${group.count} of ${report.routed} combinations; the TEC initial overrides with ${row.initialAltitudeFeet}`,
    );
  }
  return report;
}

/** The routed flights the engine leaves unresolved, and those a heading row now clears otherwise. */
function routingFindings(icao: string, reports: readonly RowReport[]): string {
  const lines = [`${icao} TEC routing: ${reports.length} TEC rows enumerated at ${LOCAL_TIME}.`];
  for (const report of reports) {
    const id = report.row.id;
    lines.push(...tallyLines(report.unresolved).map((line) => `  unresolved ${id}: ${line}`));
    lines.push(...tallyLines(report.replaced).map((line) => `  heading row ${id}: ${line}`));
  }
  return lines.join('\n');
}

/** The rows whose initial altitude differs from the SOP reading, plus what could not be read. */
function findings(icao: string, reports: readonly RowReport[]): string {
  const unreadable = reports
    .filter((report) => report.routed > 0 && report.unreadable > 0)
    .map(
      (report) =>
        `${report.row.id} (${report.unreadable} of ${report.routed} combinations read no SOP altitude at all)`,
    );
  const differences = reports.flatMap((report) => report.differences);
  return [
    `${icao} TEC initial altitudes: ${reports.length} rows state one, and it overrides the SOP.`,
    `  rows whose initial altitude differs from the SOP reading: ${differences.length === 0 ? 'none' : ''}`,
    ...differences.map((line) => `    ${line}`),
    `  rows with an unreadable SOP altitude: ${unreadable.length === 0 ? 'none' : unreadable.join('; ')}`,
  ].join('\n');
}

describe.each(checkedInAirports())(
  '$icao TEC rows against the flights they route',
  ({ icao, data }) => {
    const reports = data.tecRoutes
      .filter((row) => row.kind === 'tec')
      .map((row) => auditRow(row, data));
    const initial = reports.filter((report) => report.row.initialAltitudeFeet !== undefined);

    it('reports where a TEC initial altitude overrides what the SOP rows would clear', () => {
      console.info(findings(icao, initial));
      const routed = initial.filter((report) => report.routed > 0).length;
      expect(
        initial.length === 0 || routed > 0,
        `${icao} states ${initial.length} TEC initial altitudes and the enumeration routed none of them`,
      ).toBe(true);
    });

    it("clears every flight a family-headed row routes on that row's SID", () => {
      console.info(routingFindings(icao, reports));
      const off = reports.flatMap((report) =>
        tallyLines(report.offProcedure).map((line) => `${report.row.id}: ${line}`),
      );
      expect(off).toEqual([]);
    });

    it('routes at least one enumerated flight on every TEC row', () => {
      const unrouted = reports
        .filter((report) => report.routed === 0)
        .map((report) => report.row.id);
      expect(unrouted).toEqual([]);
    });
  },
);
