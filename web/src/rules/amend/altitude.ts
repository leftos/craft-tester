import type { AirportData, Destination, LoaRule, LoaRuleKind, Scenario } from '@/data/schema.ts';
import { citeTec } from '@/rules/amend/cite.ts';
import { magneticCourse } from '@/rules/amend/course.ts';
import { tecRouteFor } from '@/rules/amend/tec.ts';
import type { ResolvedAmendment } from '@/rules/amend/types.ts';
import { citePhraseology, toCitation } from '@/rules/cite.ts';
import type { Classification } from '@/rules/classify.ts';
import { formatAltitude } from '@/rules/grade.ts';
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

/** The steps a proposal walks down in, and the altitude it gives up at. */
const STEP_FEET = 1000;
const LOWEST_PROPOSAL_FEET = 1000;

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
  const filed = formatAltitude(scenario.filedAltitude);
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
  const band = `${formatAltitude(RVSM_FLOOR_FEET)} through ${formatAltitude(RVSM_CEILING_FEET)}`;
  return {
    legal: (feet) => feet < RVSM_FLOOR_FEET || feet > RVSM_CEILING_FEET,
    reason: `filed ${formatAltitude(scenario.filedAltitude)} is inside RVSM airspace (${band}), which ${who} may not enter`,
    citations: citePhraseology(airport, 'A-RVSM'),
  };
}

/**
 * The TEC route final altitude, for a destination inside the TRACON.
 *
 * The final altitude is the one published by the row that routes the flight, which must begin on a
 * departure the SOP would issue it; a row beginning on a departure this flight would not be issued
 * caps nothing here, and a flight routed on a row that publishes no final altitude is not capped at
 * all.
 *
 * @param ctx The classified flight.
 * @param scenario The filed flight plan, which decides which rows are issuable to it.
 * @param airport The airport data.
 * @param destination The destination row.
 * @returns The constraint, or `undefined` for a destination outside the TRACON, one no TEC row
 *   routes this flight to, or one whose routing row publishes no final altitude.
 */
function tecConstraint(
  ctx: Classification,
  scenario: Scenario,
  airport: AirportData,
  destination: Destination,
): Constraint | undefined {
  const row = tecRouteFor(ctx, scenario, airport, destination);
  const final = row?.finalAltitudeFeet;
  if (row === undefined || final === undefined) return undefined;
  return {
    legal: (feet) => feet <= final,
    reason: `the TEC route to ${destination.spoken} is at or below ${formatAltitude(final)}`,
    citations: [citeTec(row)],
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
 * rotates it; the RVSM band for a suffix without RVSM approval; the final altitude of the TEC route
 * a TRACON destination is routed on, which is the row beginning on a departure the SOP would issue
 * this flight and nothing where no row does. The proposal is the highest altitude at or below the filed
 * one that satisfies all of them at once, so an amendment never trades one broken rule for another.
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
    tecConstraint(ctx, scenario, airport, destination),
  ].filter((constraint) => constraint !== undefined);
  const broken = constraints.filter((constraint) => !constraint.legal(scenario.filedAltitude));
  if (broken.length === 0) return undefined;
  const reasons = broken.map((constraint) => constraint.reason).join('; ');
  const proposedFeet = highestLegal(scenario.filedAltitude, constraints);
  if (proposedFeet === undefined) {
    return unresolved(
      'BOX.altitude',
      `no altitude at or below ${formatAltitude(scenario.filedAltitude)} is legal for this flight: ${reasons}`,
    );
  }
  return {
    box: 'altitude',
    proposedFeet,
    reason: `${reasons}; the highest legal altitude at or below it is ${formatAltitude(proposedFeet)}`,
    citations: dedupe(broken.flatMap((constraint) => constraint.citations)),
  };
}
