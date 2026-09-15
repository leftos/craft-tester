import type {
  AirportData,
  AltitudePhrase,
  AltitudeRule,
  Phraseology,
  Scenario,
  Sid,
} from '@/data/schema.ts';
import type { Classification } from '@/rules/classify.ts';
import { citePhraseology, toCitation } from '@/rules/cite.ts';
import type { Cited, Unresolved } from '@/rules/types.ts';
import { unresolved } from '@/rules/unresolved.ts';

/** The altitude element of a clearance and the expect clause that follows it. */
export type ResolvedAltitude = {
  altitude: Cited<{ phrase: AltitudePhrase; feet?: number }>;
  expect: Cited<{ feet: number; minutes: number } | null>;
};

/** The altitude phrase and, where one is spoken, the feet it carries. */
type AltitudeValue = { phrase: AltitudePhrase; feet?: number };

/** Whether an interim altitude is issued as "climb via SID except maintain" on this runway. */
function isClimbViaEligible(sid: Sid, runwayFamily: string): boolean {
  return sid.crossingRestrictionsByRunwayFamily?.[runwayFamily] ?? sid.climbViaEligible;
}

/** Whether an interim altitude row is keyed to this flight and this SID family. */
function rowMatches(row: AltitudeRule, ctx: Classification, sid: Sid): boolean {
  return (
    row.plan === ctx.plan &&
    row.runwayFamilies.includes(ctx.runwayFamily) &&
    row.classes.includes(ctx.aircraftClass) &&
    (row.sidFamilies === undefined || row.sidFamilies.includes(sid.family))
  );
}

/**
 * Applies the row to the SID: a published top altitude wins where the row defers to it.
 *
 * A plain "climb via SID" would climb the aircraft to the SID's published top altitude, so a flight
 * filed below that top is held at the altitude it filed instead: FAA JO 7110.65 4-3-2 c 4 has the
 * controller say "climb via SID except maintain (altitude)" whenever the altitude to maintain
 * differs from the published top. A flight filed at or above the top keeps the plain climb via SID.
 *
 * @param row The interim-altitude row the flight matched.
 * @param sid The selected SID.
 * @param ctx The classified flight.
 * @param scenario The filed flight plan.
 * @returns The altitude phrase with its feet, and the phraseology rule that produced it.
 */
function altitudeValue(
  row: AltitudeRule,
  sid: Sid,
  ctx: Classification,
  scenario: Scenario,
): { value: AltitudeValue; ruleId: string } {
  const publishedWins =
    sid.topAltitude.kind === 'published' && row.whenTopAltitudePublished === 'climb_via';
  if (publishedWins || row.outcome.kind === 'climb_via') {
    if (sid.topAltitude.kind === 'published' && scenario.filedAltitude < sid.topAltitude.feet) {
      return {
        value: { phrase: 'climb_via_except', feet: scenario.filedAltitude },
        ruleId: 'A-CLIMB-VIA-EXCEPT',
      };
    }
    return { value: { phrase: 'climb_via' }, ruleId: 'A-CLIMB-VIA' };
  }
  const feet = Math.min(row.outcome.feet, scenario.filedAltitude);
  return isClimbViaEligible(sid, ctx.runwayFamily)
    ? { value: { phrase: 'climb_via_except', feet }, ruleId: 'A-CLIMB-VIA-EXCEPT' }
    : { value: { phrase: 'maintain', feet }, ruleId: 'A-MAINTAIN' };
}

/**
 * The altitude the clearance climbs the aircraft to: the interim altitude where one is issued, and
 * the SID's published top altitude on a plain "climb via SID".
 *
 * @param altitude The resolved altitude phrase and its feet, where the phrase carries any.
 * @param sid The selected SID.
 * @returns The feet the aircraft may climb to under this clearance.
 * @throws Error When a plain "climb via SID" falls on a SID with no published top altitude, which
 *   leaves no altitude to compare the filed altitude with.
 */
function clearedToFeet(altitude: AltitudeValue, sid: Sid): number {
  if (altitude.feet !== undefined) return altitude.feet;
  if (sid.topAltitude.kind !== 'published') {
    throw new Error(
      `${sid.id} is cleared "climb via SID" but publishes no top altitude to compare the filed altitude with`,
    );
  }
  return sid.topAltitude.feet;
}

/**
 * The expect clause, per the phraseology toggle the worksheets settle.
 *
 * `always` speaks it on every clearance and `never` on none. `only_when_interim_below_filed`
 * compares the filed altitude with the altitude the aircraft is actually cleared to climb to — the
 * interim altitude under "maintain" and "climb via SID except maintain", the SID's published top
 * altitude under a plain "climb via SID" — and speaks the clause only while the filed altitude is
 * above it. A flight filed at the altitude it was just cleared to hears no expect clause.
 *
 * @param row The interim-altitude row the flight matched.
 * @param altitude The resolved altitude phrase and its feet.
 * @param sid The selected SID.
 * @param scenario The filed flight plan.
 * @param phraseology The airport's phraseology toggles.
 * @returns The expect clause, or null where none is spoken.
 */
function expectClause(
  row: AltitudeRule,
  altitude: AltitudeValue,
  sid: Sid,
  scenario: Scenario,
  phraseology: Phraseology,
): { feet: number; minutes: number } | null {
  if (phraseology.expectAltitude === 'never') return null;
  const clause = { feet: scenario.filedAltitude, minutes: row.expectAfterMinutes };
  if (phraseology.expectAltitude === 'always') return clause;
  return clearedToFeet(altitude, sid) < scenario.filedAltitude ? clause : null;
}

/**
 * Resolves the altitude a flight is cleared to and the expect clause that goes with it.
 *
 * The first interim-altitude row keyed to the plan, runway family, class, and SID family decides:
 * a SID whose published top altitude the row defers to is cleared "climb via SID", an interim
 * altitude is capped at the filed altitude and spoken as "climb via SID except maintain" where the
 * SID has crossing restrictions off that runway, and as "maintain" where it has none.
 *
 * @param ctx The classified flight.
 * @param sid The selected SID.
 * @param scenario The filed flight plan.
 * @param airport The airport data.
 * @returns The altitude and expect elements, or `Unresolved` when no row is keyed to the flight.
 */
export function resolveAltitude(
  ctx: Classification,
  sid: Sid,
  scenario: Scenario,
  airport: AirportData,
): ResolvedAltitude | Unresolved {
  const row = airport.altitudeRules.find((entry) => rowMatches(entry, ctx, sid));
  if (row === undefined) {
    return unresolved(
      'A.phrase',
      `no altitude rule for ${ctx.plan} runway ${ctx.runwayFamily} class ${ctx.aircraftClass} on ${sid.family}`,
    );
  }
  const { value, ruleId } = altitudeValue(row, sid, ctx, scenario);
  return {
    altitude: { value, citations: [...citePhraseology(airport, ruleId), toCitation(row)] },
    expect: {
      value: expectClause(row, value, sid, scenario, airport.phraseology),
      citations: citePhraseology(airport, 'A-EXPECT'),
    },
  };
}
