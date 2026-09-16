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
import type { Cited, ExpectClause, Unresolved } from '@/rules/types.ts';
import { unresolved } from '@/rules/unresolved.ts';

/** The altitude element of a clearance and the expect clause that follows it. */
export type ResolvedAltitude = {
  altitude: Cited<{ phrase: AltitudePhrase; feet?: number }>;
  expect: Cited<ExpectClause | null>;
  redundantExpect: Cited<{ feet: number; minutes: number } | null>;
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
 * @returns The feet the aircraft may climb to under this clearance, and `undefined` where there is
 *   no such altitude: a plain "climb via SID" on a SID that publishes no top altitude.
 */
function clearedToFeet(altitude: AltitudeValue, sid: Sid): number | undefined {
  if (altitude.feet !== undefined) return altitude.feet;
  return sid.topAltitude.kind === 'published' ? sid.topAltitude.feet : undefined;
}

/**
 * The expect clause, per the phraseology toggle the worksheets settle.
 *
 * `never` speaks it on no clearance. Every other mode compares the filed altitude with the altitude
 * the aircraft is actually cleared to climb to — the interim altitude under "maintain" and "climb
 * via SID except maintain", the SID's published top altitude under a plain "climb via SID" — and
 * drops the clause once the filed altitude is no longer above it, because a clause repeating the
 * altitude just assigned says nothing. A plain "climb via SID" on a SID that publishes no top
 * altitude has no altitude to compare with, so the comparison cannot drop the clause there.
 *
 * `unless_chart_publishes_it` drops it on top of that wherever the SID's chart carries the "expect
 * filed altitude N minutes after departure" note itself, which leaves the clause for the charts
 * that stay silent. A clause dropped that way is the one a controller may still speak without being
 * wrong, so it comes back as `redundant` rather than as nothing at all; a clause dropped because the
 * flight is cleared to the altitude it filed says something untrue, and comes back as nothing.
 *
 * @param row The interim-altitude row the flight matched.
 * @param altitude The resolved altitude phrase and its feet.
 * @param sid The selected SID.
 * @param scenario The filed flight plan.
 * @param phraseology The airport's phraseology toggles.
 * @returns The expect clause to speak, or null where none is; and the clause the chart already
 *   publishes, or null where nothing is redundant. The clause names the filed altitude, so it is
 *   never the amended one; `resolveAmendedClearance` writes that clause instead.
 */
function expectClause(
  row: AltitudeRule,
  altitude: AltitudeValue,
  sid: Sid,
  scenario: Scenario,
  phraseology: Phraseology,
): {
  clause: ExpectClause | null;
  redundant: { feet: number; minutes: number } | null;
} {
  const nothing = { clause: null, redundant: null };
  if (phraseology.expectAltitude === 'never') return nothing;
  const clearedTo = clearedToFeet(altitude, sid);
  if (clearedTo !== undefined && clearedTo >= scenario.filedAltitude) return nothing;
  if (
    phraseology.expectAltitude === 'unless_chart_publishes_it' &&
    sid.chartExpectFiledAltitudeMinutes !== null
  ) {
    return {
      clause: null,
      redundant: { feet: scenario.filedAltitude, minutes: sid.chartExpectFiledAltitudeMinutes },
    };
  }
  return {
    clause: { kind: 'filed', feet: scenario.filedAltitude, minutes: row.expectAfterMinutes },
    redundant: null,
  };
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
 * @returns The altitude element, the expect clause and the clause the chart already publishes, or
 *   `Unresolved` when no row is keyed to the flight.
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
  const { clause, redundant } = expectClause(row, value, sid, scenario, airport.phraseology);
  return {
    altitude: { value, citations: [...citePhraseology(airport, ruleId), toCitation(row)] },
    expect: { value: clause, citations: citePhraseology(airport, 'A-EXPECT') },
    redundantExpect: {
      value: redundant,
      citations: redundant === null ? [] : citePhraseology(airport, 'A-EXPECT-REDUNDANT'),
    },
  };
}
