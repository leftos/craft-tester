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

/** Applies the row to the SID: a published top altitude wins where the row defers to it. */
function altitudeValue(
  row: AltitudeRule,
  sid: Sid,
  ctx: Classification,
  scenario: Scenario,
): { value: AltitudeValue; ruleId: string } {
  const publishedWins =
    sid.topAltitude.kind === 'published' && row.whenTopAltitudePublished === 'climb_via';
  if (publishedWins || row.outcome.kind === 'climb_via') {
    return { value: { phrase: 'climb_via' }, ruleId: 'A-CLIMB-VIA' };
  }
  const feet = Math.min(row.outcome.feet, scenario.filedAltitude);
  return isClimbViaEligible(sid, ctx.runwayFamily)
    ? { value: { phrase: 'climb_via_except', feet }, ruleId: 'A-CLIMB-VIA-EXCEPT' }
    : { value: { phrase: 'maintain', feet }, ruleId: 'A-MAINTAIN' };
}

/** The expect clause, per the phraseology toggle the worksheets settle. */
function expectClause(
  row: AltitudeRule,
  altitude: AltitudeValue,
  scenario: Scenario,
  phraseology: Phraseology,
): { feet: number; minutes: number } | null {
  if (phraseology.expectAltitude === 'never') return null;
  const clause = { feet: scenario.filedAltitude, minutes: row.expectAfterMinutes };
  if (phraseology.expectAltitude === 'always') return clause;
  return altitude.feet !== undefined && altitude.feet < scenario.filedAltitude ? clause : null;
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
      value: expectClause(row, value, scenario, airport.phraseology),
      citations: citePhraseology(airport, 'A-EXPECT'),
    },
  };
}
