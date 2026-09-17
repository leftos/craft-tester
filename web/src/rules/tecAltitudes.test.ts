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
import { tecRouteFor, tecTokens } from '@/rules/amend/tec.ts';
import { classify } from '@/rules/classify.ts';
import { resolveClearance } from '@/rules/engine.ts';
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

/** What the enumeration made of one row: what the SOP rows alone would have cleared each flight to. */
type RowReport = {
  row: TecRoute;
  /** How many combinations the row was in fact the flight's TEC row for. */
  routed: number;
  /** How many of those the SOP rows name no altitude for, which cannot be compared. */
  unreadable: number;
  /** One line per distinct SOP altitude that differs from the initial altitude the row overrides it with. */
  differences: string[];
};

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
 * Reports what the SOP rows alone would clear every flight this row routes to.
 *
 * A combination counts only where the row is in fact the flight's TEC row: the destination, plan,
 * runway family and class key it, and the row's departure must be one the SOP would issue the
 * flight, which is the same test the amendment engine puts a row to. The clearance is then resolved
 * against a copy of the airport whose row states no initial altitude, which is the reading the SOP
 * rows alone give, and that is what the row's initial altitude is compared with. A SOP reading that
 * names no altitude at all cannot be compared and is counted instead.
 *
 * @param row The TEC route row under report.
 * @param airport The airport data.
 * @returns What the enumeration made of the row.
 */
function auditRow(row: TecRoute, airport: AirportData): RowReport {
  const destination = airport.routeLibrary.destinations.find(
    (entry) => entry.icao === row.destination,
  );
  const sopAirport = withoutInitial(row, airport);
  const report: RowReport = { row, routed: 0, unreadable: 0, differences: [] };
  const groups = new Map<
    string,
    { label: string; phrase: string; climbed: number; count: number }
  >();
  for (const { scenario, label } of combinationsOf(row, airport)) {
    const ctx = classify(scenario, airport);
    if (isUnresolved(ctx)) continue;
    if (tecRouteFor(ctx, scenario, airport, destination) !== row) continue;
    if (!resolveClearance(scenario, airport).ok) continue;
    report.routed += 1;
    const sopResult = resolveClearance(scenario, sopAirport);
    const climbed = sopResult.ok ? climbedTo(sopResult.clearance, sopAirport) : undefined;
    if (!sopResult.ok || climbed === undefined) {
      report.unreadable += 1;
      continue;
    }
    if (climbed === row.initialAltitudeFeet) continue;
    const phrase = sopResult.clearance.altitude.value.phrase;
    const key = `${phrase} ${climbed}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { label, phrase, climbed, count: 1 });
    else group.count += 1;
  }
  for (const group of groups.values()) {
    report.differences.push(
      `${row.id}: the SOP rows alone would clear ${group.label} "${group.phrase}" to ${group.climbed} on ${group.count} of ${report.routed} combinations; the TEC initial overrides with ${row.initialAltitudeFeet}`,
    );
  }
  return report;
}

/** The rows whose initial altitude differs from the SOP reading, plus what could not be read. */
function findings(icao: string, reports: readonly RowReport[]): string {
  const unrouted = reports.filter((report) => report.routed === 0).map((report) => report.row.id);
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
    `  rows no combination routed: ${unrouted.length === 0 ? 'none' : unrouted.join(', ')}`,
    `  rows with an unreadable SOP altitude: ${unreadable.length === 0 ? 'none' : unreadable.join('; ')}`,
  ].join('\n');
}

describe.each(checkedInAirports())(
  '$icao TEC initial altitudes against the SOP reading',
  ({ icao, data }) => {
    const reports = data.tecRoutes
      .filter((row) => row.kind === 'tec' && row.initialAltitudeFeet !== undefined)
      .map((row) => auditRow(row, data));

    it('reports where a TEC initial altitude overrides what the SOP rows would clear', () => {
      console.info(findings(icao, reports));
      const routed = reports.filter((report) => report.routed > 0).length;
      expect(
        reports.length === 0 || routed > 0,
        `${icao} states ${reports.length} TEC initial altitudes and the enumeration routed none of them`,
      ).toBe(true);
    });
  },
);
