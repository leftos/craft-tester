import type {
  AirportData,
  Destination,
  LoaRule,
  LoaRuleKind,
  Scenario,
  TecRoute,
} from '@/data/schema.ts';
import { magneticCourse } from '@/rules/amend/course.ts';
import type { ResolvedAmendment } from '@/rules/amend/types.ts';
import { citePhraseology, toCitation } from '@/rules/cite.ts';
import type { Classification } from '@/rules/classify.ts';
import { formatFeet } from '@/rules/grade.ts';
import type { RuleCitation, Unresolved } from '@/rules/types.ts';
import { unresolved } from '@/rules/unresolved.ts';

/** Which half of the direction-of-flight table a flight reads its altitudes from. */
type Parity = 'odd' | 'even';

/** The LOA rule kinds that decide a parity, as against the ones that cap or route a flight. */
type ParityRule = Extract<LoaRuleKind, { kind: 'parity_rotated' | 'even' | 'odd' }>;

/** A parity LOA row that applies to the destination, with its rule already narrowed. */
type ParityOverride = { row: LoaRule; rule: ParityRule };

/** One legality test the altitude must pass, with what to say and what to cite when it fails. */
type Constraint = {
  legal: (feet: number) => boolean;
  reason: string;
  citations: RuleCitation[];
};

/** Feet below which the direction-of-flight rule is not read; see `parityConstraint`. */
const PARITY_FLOOR_FEET = 3000;

/** The highest altitude on the 1,000-ft series; above it the 4,000-ft series takes over. */
const PARITY_SERIES_TOP_FEET = 41000;

/** The lowest odd and even altitudes of the 4,000-ft series flown above `PARITY_SERIES_TOP_FEET`. */
const HIGH_SERIES_BASE_FEET: Record<Parity, number> = { odd: 45000, even: 43000 };

const HIGH_SERIES_STEP_FEET = 4000;

/** The RVSM band, inclusive: an aircraft with no RVSM approval is not assigned an altitude in it. */
const RVSM_FLOOR_FEET = 29000;
const RVSM_CEILING_FEET = 41000;

/** Altitudes at and above this are spoken as flight levels. */
const FLIGHT_LEVEL_FLOOR_FEET = 18000;

/** The steps a proposal walks down in, and the altitude it gives up at. */
const STEP_FEET = 1000;
const LOWEST_PROPOSAL_FEET = 1000;

/**
 * Writes an altitude the way a controller says it.
 *
 * @param feet The altitude in feet.
 * @returns The altitude with thousands separators below 18,000, and as a flight level at or above
 *   it, e.g. `10,000` and `FL330`.
 */
function altitudeText(feet: number): string {
  return feet < FLIGHT_LEVEL_FLOOR_FEET ? formatFeet(feet) : `FL${Math.round(feet / 100)}`;
}

/**
 * Cites a TEC route row, which is the one citable row that carries no `text` of its own.
 *
 * @param row The TEC route row the check read.
 * @returns The citation, with the row's own key facts written out as its text.
 */
export function citeTec(row: TecRoute): RuleCitation {
  const runways = row.runwayFamilies.length === 0 ? '' : ` ${row.runwayFamilies.join('/')}`;
  const cap =
    row.altitudeCapFeet === undefined ? '' : ` at or below ${formatFeet(row.altitudeCapFeet)}`;
  const keys = `${row.destination} ${row.plan}${runways} ${row.classes.join('/')}`;
  return { id: row.id, source: row.source, text: `${keys}: ${row.route}${cap}` };
}

/** Whether an LOA row is written for this destination, by its ARTCC or by name. */
function appliesTo(row: LoaRule, destination: Destination): boolean {
  return row.artcc === destination.artcc || (row.destinations?.includes(destination.icao) ?? false);
}

/** The first parity LOA row written for the destination, where the data holds one. */
function parityOverride(
  airport: AirportData,
  destination: Destination,
): ParityOverride | undefined {
  for (const row of airport.loaRules) {
    if (!appliesTo(row, destination)) continue;
    const { rule } = row;
    if (rule.kind === 'parity_rotated' || rule.kind === 'even' || rule.kind === 'odd') {
      return { row, rule };
    }
  }
  return undefined;
}

/** Whether a course falls inside a range of degrees that may wrap past 359. */
function inCourseRange(course: number, from: number, to: number): boolean {
  return from <= to ? course >= from && course <= to : course >= from || course <= to;
}

/** The half of the table this course reads, under the LOA rotation where one applies. */
function parityFor(course: number, override: ParityOverride | undefined): Parity {
  if (override === undefined) return course < 180 ? 'odd' : 'even';
  const { rule } = override;
  if (rule.kind === 'parity_rotated') {
    return inCourseRange(course, rule.oddCourseFrom, rule.oddCourseTo) ? 'odd' : 'even';
  }
  return rule.kind;
}

/**
 * Whether an altitude is on the series a parity allows.
 *
 * Below `PARITY_FLOOR_FEET` every altitude passes: 14 CFR 91.179 states the rule for flight above
 * 3,000 ft AGL, and the airports this trainer covers are near enough sea level for the field
 * elevation to make no difference to that reading.
 *
 * @param feet The altitude to test.
 * @param parity The half of the table the flight reads.
 * @returns True when the altitude is one the flight may be assigned.
 */
function isOnSeries(feet: number, parity: Parity): boolean {
  if (feet < PARITY_FLOOR_FEET) return true;
  if (feet <= PARITY_SERIES_TOP_FEET) {
    return feet % (2 * STEP_FEET) === (parity === 'odd' ? STEP_FEET : 0);
  }
  const base = HIGH_SERIES_BASE_FEET[parity];
  return feet >= base && (feet - base) % HIGH_SERIES_STEP_FEET === 0;
}

/**
 * The direction-of-flight constraint: odd or even by the magnetic course to the destination.
 *
 * @param scenario The filed flight plan.
 * @param airport The airport data.
 * @param destination The destination row the course is measured to.
 * @returns The constraint, citing the parity rule and the LOA row where one rotates it.
 */
function parityConstraint(
  scenario: Scenario,
  airport: AirportData,
  destination: Destination,
): Constraint {
  const course = Math.round(magneticCourse(airport.airport, destination)) % 360;
  const override = parityOverride(airport, destination);
  const parity = parityFor(course, override);
  const under = override === undefined ? '' : ` under ${override.row.id}`;
  const filed = altitudeText(scenario.filedAltitude);
  return {
    legal: (feet) => isOnSeries(feet, parity),
    reason: `filed ${filed} on a ${course}° magnetic course to ${destination.spoken} needs an ${parity} level${under}`,
    citations: [
      ...citePhraseology(airport, 'A-PARITY'),
      ...(override === undefined ? [] : [toCitation(override.row)]),
    ],
  };
}

/**
 * The RVSM constraint, for a suffix that carries no RVSM approval.
 *
 * A suffix the equipment table does not hold, and a plan filed with no suffix at all, both read as
 * non-RVSM.
 *
 * @param scenario The filed flight plan.
 * @param airport The airport data.
 * @returns The constraint, or `undefined` when the flight is RVSM approved.
 */
function rvsmConstraint(scenario: Scenario, airport: AirportData): Constraint | undefined {
  const entry = airport.equipmentSuffixes.find((row) => row.suffix === scenario.equipmentSuffix);
  if (entry?.rvsm === true) return undefined;
  const who =
    scenario.equipmentSuffix === null
      ? 'a flight with no equipment suffix'
      : `a ${scenario.equipmentSuffix} flight`;
  const band = `${altitudeText(RVSM_FLOOR_FEET)} through ${altitudeText(RVSM_CEILING_FEET)}`;
  return {
    legal: (feet) => feet < RVSM_FLOOR_FEET || feet > RVSM_CEILING_FEET,
    reason: `filed ${altitudeText(scenario.filedAltitude)} is inside RVSM airspace (${band}), which ${who} may not enter`,
    citations: citePhraseology(airport, 'A-RVSM'),
  };
}

/** Whether a TEC row is the one this flight would be routed on, and carries a cap to read. */
function tecMatches(row: TecRoute, ctx: Classification, destination: Destination): boolean {
  return (
    row.kind === 'tec' &&
    row.destination === destination.icao &&
    row.plan === ctx.plan &&
    (row.runwayFamilies.length === 0 || row.runwayFamilies.includes(ctx.runwayFamily)) &&
    row.classes.includes(ctx.aircraftClass) &&
    row.altitudeCapFeet !== undefined
  );
}

/**
 * The TEC route cap, for a destination inside the TRACON.
 *
 * @param ctx The classified flight.
 * @param airport The airport data.
 * @param destination The destination row.
 * @returns The constraint, or `undefined` for a destination outside the TRACON or one whose
 *   matching row publishes no cap.
 */
function tecConstraint(
  ctx: Classification,
  airport: AirportData,
  destination: Destination,
): Constraint | undefined {
  if (destination.nct !== true) return undefined;
  const row = airport.tecRoutes.find((entry) => tecMatches(entry, ctx, destination));
  const cap = row?.altitudeCapFeet;
  if (row === undefined || cap === undefined) return undefined;
  return {
    legal: (feet) => feet <= cap,
    reason: `the TEC route to ${destination.spoken} is at or below ${altitudeText(cap)}`,
    citations: [citeTec(row)],
  };
}

/**
 * The LOA ceilings written for the destination, one constraint per row.
 *
 * @param airport The airport data.
 * @param destination The destination row.
 * @returns A constraint for every `max` row that applies, which is usually none.
 */
function maxConstraints(airport: AirportData, destination: Destination): Constraint[] {
  return airport.loaRules.flatMap((row) => {
    if (!appliesTo(row, destination) || row.rule.kind !== 'max') return [];
    const { feet } = row.rule;
    return [
      {
        legal: (candidate: number) => candidate <= feet,
        reason: `${row.id} caps altitudes to ${destination.spoken} at ${altitudeText(feet)}`,
        citations: [toCitation(row)],
      },
    ];
  });
}

/**
 * The service ceiling of the filed type, for a type the fleet holds.
 *
 * @param scenario The filed flight plan.
 * @param airport The airport data.
 * @returns The constraint, or `undefined` for a type the fleet does not list, which has no ceiling
 *   in the data to check against.
 */
function ceilingConstraint(scenario: Scenario, airport: AirportData): Constraint | undefined {
  const entry = airport.routeLibrary.fleet.find((row) => row.type === scenario.aircraftType);
  if (entry === undefined) return undefined;
  const ceiling = entry.ceilingFeet;
  return {
    legal: (feet) => feet <= ceiling,
    reason: `a ${entry.type} has a service ceiling of ${altitudeText(ceiling)}`,
    citations: [
      {
        id: `FLEET-${entry.type}`,
        source: 'routes.yaml fleet',
        text: `${entry.type} service ceiling ${formatFeet(ceiling)} ft`,
      },
    ],
  };
}

/** The highest altitude at or below the filed one that every constraint accepts. */
function highestLegal(filedFeet: number, constraints: Constraint[]): number | undefined {
  for (let feet = filedFeet; feet >= LOWEST_PROPOSAL_FEET; feet -= STEP_FEET) {
    if (constraints.every((constraint) => constraint.legal(feet))) return feet;
  }
  return undefined;
}

/** The citations of the broken constraints, first occurrence of each id kept in order. */
function dedupe(citations: RuleCitation[]): RuleCitation[] {
  const seen = new Set<string>();
  const unique: RuleCitation[] = [];
  for (const citation of citations) {
    if (seen.has(citation.id)) continue;
    seen.add(citation.id);
    unique.push(citation);
  }
  return unique;
}

/**
 * Checks the altitude box of the strip against every rule the data holds for the flight.
 *
 * The constraints are the direction-of-flight parity, rotated where an LOA row for the destination
 * rotates it; the RVSM band for a suffix without RVSM approval; the cap on the TEC route a TRACON
 * destination is routed on; an LOA ceiling; and the service ceiling of the filed type. The proposal
 * is the highest altitude at or below the filed one that satisfies all of them at once, so an
 * amendment never trades one broken rule for another.
 *
 * Only the constraints the *filed* altitude broke are reported and cited: the reason says what is
 * wrong with what the pilot filed, and a rule the filed altitude honours is not part of that, even
 * where it is the rule that ruled out the altitudes in between.
 *
 * @param scenario The filed flight plan.
 * @param ctx The classified flight, which keys the TEC route rows.
 * @param airport The airport data.
 * @returns The amendment for the altitude box, `undefined` when the filed altitude is legal, or
 *   `Unresolved` when the data cannot answer: an unknown destination, or no legal altitude at all.
 */
export function checkAltitude(
  scenario: Scenario,
  ctx: Classification,
  airport: AirportData,
): ResolvedAmendment | undefined | Unresolved {
  const destination = airport.routeLibrary.destinations.find(
    (row) => row.icao === scenario.destination,
  );
  if (destination === undefined) {
    return unresolved(
      'BOX.altitude',
      `destination ${scenario.destination} is not in the route library, so the course to it and the rules written for it are unknown`,
    );
  }
  const constraints = [
    parityConstraint(scenario, airport, destination),
    rvsmConstraint(scenario, airport),
    tecConstraint(ctx, airport, destination),
    ...maxConstraints(airport, destination),
    ceilingConstraint(scenario, airport),
  ].filter((constraint) => constraint !== undefined);
  const broken = constraints.filter((constraint) => !constraint.legal(scenario.filedAltitude));
  if (broken.length === 0) return undefined;
  const reasons = broken.map((constraint) => constraint.reason).join('; ');
  const proposedFeet = highestLegal(scenario.filedAltitude, constraints);
  if (proposedFeet === undefined) {
    return unresolved(
      'BOX.altitude',
      `no altitude at or below ${altitudeText(scenario.filedAltitude)} is legal for this flight: ${reasons}`,
    );
  }
  return {
    box: 'altitude',
    proposedFeet,
    reason: `${reasons}; the highest legal altitude at or below it is ${altitudeText(proposedFeet)}`,
    citations: dedupe(broken.flatMap((constraint) => constraint.citations)),
  };
}
