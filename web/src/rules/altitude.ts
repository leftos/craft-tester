import type {
  AirportData,
  AltitudePhrase,
  AltitudeRule,
  Phraseology,
  Scenario,
  Sid,
  TecRoute,
} from '@/data/schema.ts';
import { citeTec } from '@/rules/amend/cite.ts';
import type { Classification } from '@/rules/classify.ts';
import { addresses } from '@/rules/classify.ts';
import { citePhraseology, toCitation } from '@/rules/cite.ts';
import { tecHead, usableTecRoute } from '@/rules/tecRoutes.ts';
import type {
  Cited,
  ExpectClause,
  RedundantExpect,
  RuleCitation,
  SelectedProcedure,
  Unresolved,
} from '@/rules/types.ts';
import { isUnresolved, unresolved } from '@/rules/unresolved.ts';

/** The altitude element of a clearance and the expect clause that follows it. */
export type ResolvedAltitude = {
  altitude: Cited<{ phrase: AltitudePhrase; feet?: number }>;
  expect: Cited<ExpectClause | null>;
  redundantExpect: Cited<RedundantExpect | null>;
};

/** The altitude phrase and, where one is spoken, the feet it carries. */
type AltitudeValue = { phrase: AltitudePhrase; feet?: number };

/** Whether an interim altitude is issued as "climb via SID except maintain" on this runway. */
function isClimbViaEligible(sid: Sid, runwayFamily: string): boolean {
  return sid.crossingRestrictionsByRunwayFamily?.[runwayFamily] ?? sid.climbViaEligible;
}

/**
 * Whether the row is keyed to the procedure the flight flies.
 *
 * A row naming SID families answers the flights on one of them; a row naming non-DP headings
 * answers the flights cleared on one of those headings and has nothing to match a SID against; a
 * row naming neither answers whatever the flight flies, procedure or heading.
 */
function procedureMatches(row: AltitudeRule, procedure: SelectedProcedure): boolean {
  if (row.sidFamilies !== undefined) {
    return procedure.kind === 'sid' && row.sidFamilies.includes(procedure.sid.family);
  }
  if (row.nonDpHeadings !== undefined) {
    return procedure.kind === 'heading' && row.nonDpHeadings.includes(procedure.heading);
  }
  return true;
}

/**
 * Whether an interim altitude row is keyed to this flight and the procedure it flies.
 *
 * The row's audience is the class and the groups it is written for, which `addresses` reads against
 * the airport's `aircraftGroups`.
 */
function rowMatches(
  row: AltitudeRule,
  ctx: Classification,
  procedure: SelectedProcedure,
  airport: AirportData,
): boolean {
  return (
    row.plan === ctx.plan &&
    row.runwayFamilies.includes(ctx.runwayFamily) &&
    addresses(row, ctx, airport) &&
    procedureMatches(row, procedure)
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
 * A flight cleared on the runway heading is on no procedure, so there is nothing to climb via and
 * nothing publishing a top altitude: it is held at the row's own interim altitude, capped at the
 * altitude it filed, and told so plainly. A row that defers to a procedure cannot answer such a
 * flight, and says so rather than clearing it to nothing.
 *
 * @param row The interim-altitude row the flight matched.
 * @param procedure The selected SID, or the heading the flight is cleared on.
 * @param ctx The classified flight.
 * @param scenario The filed flight plan.
 * @returns The altitude phrase with its feet, and the phraseology rule that produced it, or
 *   `Unresolved` where the row has no altitude for a flight on no procedure.
 */
function altitudeValue(
  row: AltitudeRule,
  procedure: SelectedProcedure,
  ctx: Classification,
  scenario: Scenario,
): { value: AltitudeValue; ruleId: string } | Unresolved {
  if (procedure.kind === 'heading') {
    if (row.outcome.kind !== 'interim') {
      return unresolved(
        'A.phrase',
        `${row.id} clears the flight via its procedure, and this one is cleared on the runway heading with none`,
      );
    }
    const feet = Math.min(row.outcome.feet, scenario.filedAltitude);
    return { value: { phrase: 'maintain', feet }, ruleId: 'A-MAINTAIN' };
  }
  const { sid } = procedure;
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
 * The TEC route row whose initial altitude the clearance is issued with, where one applies.
 *
 * The row is the one that routes the flight — the first keyed to its destination, plan, runway
 * family and class whose departure it can use — and it is read only where its route begins on what
 * the flight is in fact cleared on: the departure family it names, or the initial heading it is
 * issued on. A noise-abatement row or a notice that clears the flight on something else leaves the
 * altitude to the SOP rows. A row that begins on a fix or an airway carries no such condition.
 *
 * @param ctx The classified flight.
 * @param procedure The selected SID, or the heading the flight is cleared on.
 * @param scenario The filed flight plan, which names the destination.
 * @param airport The airport data, whose `tecRoutes` hold the transcribed rows.
 * @returns The row, or `undefined` where none routes the flight, the routing one publishes no
 *   initial altitude, or its route begins on a departure this clearance does not issue.
 */
function tecInitialRow(
  ctx: Classification,
  procedure: SelectedProcedure,
  scenario: Scenario,
  airport: AirportData,
): TecRoute | undefined {
  const row = usableTecRoute(ctx, scenario, airport);
  if (row === undefined || row.initialAltitudeFeet === undefined) return undefined;
  const head = tecHead(row);
  if (head.kind === 'family') {
    return procedure.kind === 'sid' && procedure.sid.family === head.family ? row : undefined;
  }
  if (head.kind === 'heading') {
    return procedure.kind === 'heading' && procedure.heading === head.heading ? row : undefined;
  }
  return row;
}

/**
 * The altitude phrase a TEC route's initial altitude is issued with.
 *
 * The initial altitude is what the facility directive issues the route with, so it stands whatever
 * an SOP row would have said and is not capped at the filed altitude: the route's final altitude is
 * the cruise, and the initial altitude is never above it. The phrase is chosen as it is for an SOP
 * interim altitude — "climb via SID except maintain" where the SID's chart publishes a top altitude
 * above it or carries crossing restrictions off this runway, a plain "climb via SID" where the
 * initial altitude is the published top or above it, and "maintain" for a flight on no procedure.
 *
 * @param initialFeet The row's initial altitude.
 * @param procedure The selected SID, or the heading the flight is cleared on.
 * @param ctx The classified flight, whose runway family decides the climb-via eligibility.
 * @returns The altitude phrase with its feet, and the phraseology rule that produced it.
 */
function tecAltitudeValue(
  initialFeet: number,
  procedure: SelectedProcedure,
  ctx: Classification,
): { value: AltitudeValue; ruleId: string } {
  if (procedure.kind === 'heading') {
    return { value: { phrase: 'maintain', feet: initialFeet }, ruleId: 'A-MAINTAIN' };
  }
  const { sid } = procedure;
  if (sid.topAltitude.kind === 'published') {
    return initialFeet < sid.topAltitude.feet
      ? { value: { phrase: 'climb_via_except', feet: initialFeet }, ruleId: 'A-CLIMB-VIA-EXCEPT' }
      : { value: { phrase: 'climb_via' }, ruleId: 'A-CLIMB-VIA' };
  }
  return isClimbViaEligible(sid, ctx.runwayFamily)
    ? { value: { phrase: 'climb_via_except', feet: initialFeet }, ruleId: 'A-CLIMB-VIA-EXCEPT' }
    : { value: { phrase: 'maintain', feet: initialFeet }, ruleId: 'A-MAINTAIN' };
}

/**
 * The altitude the clearance climbs the aircraft to: the interim altitude where one is issued, and
 * the SID's published top altitude on a plain "climb via SID".
 *
 * @param altitude The resolved altitude phrase and its feet, where the phrase carries any.
 * @param procedure The selected SID, or the heading the flight is cleared on.
 * @returns The feet the aircraft may climb to under this clearance, and `undefined` where there is
 *   no such altitude: a plain "climb via SID" on a SID that publishes no top altitude.
 */
function clearedToFeet(altitude: AltitudeValue, procedure: SelectedProcedure): number | undefined {
  if (altitude.feet !== undefined) return altitude.feet;
  if (procedure.kind === 'heading') return undefined;
  const { topAltitude } = procedure.sid;
  return topAltitude.kind === 'published' ? topAltitude.feet : undefined;
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
 * A flight cleared on the runway heading has no chart to publish the note, so nothing drops the
 * clause there but the comparison with the altitude it is cleared to.
 *
 * @param altitude The resolved altitude phrase and its feet.
 * @param procedure The selected SID, or the heading the flight is cleared on.
 * @param scenario The filed flight plan.
 * @param phraseology The airport's phraseology toggles.
 * @param minutes How long after departure the clause says to expect the filed altitude: the row's
 *   own delay for an SOP interim altitude, and the phraseology default for a TEC initial altitude,
 *   which is issued by a row that states no delay of its own.
 * @returns The expect clause to speak, or null where none is; and the clause the chart already
 *   publishes, or null where nothing is redundant. The clause names the filed altitude, so it is
 *   never the amended one; `resolveAmendedClearance` writes that clause instead.
 */
function expectClause(
  altitude: AltitudeValue,
  procedure: SelectedProcedure,
  scenario: Scenario,
  phraseology: Phraseology,
  minutes: number,
): {
  clause: ExpectClause | null;
  redundant: RedundantExpect | null;
} {
  const nothing = { clause: null, redundant: null };
  if (phraseology.expectAltitude === 'never') return nothing;
  const clearedTo = clearedToFeet(altitude, procedure);
  if (clearedTo !== undefined && clearedTo >= scenario.filedAltitude) return nothing;
  const chartMinutes =
    procedure.kind === 'sid' ? procedure.sid.chartExpectFiledAltitudeMinutes : null;
  if (phraseology.expectAltitude === 'unless_chart_publishes_it' && chartMinutes !== null) {
    return {
      clause: null,
      redundant: { kind: 'filed', feet: scenario.filedAltitude, minutes: chartMinutes },
    };
  }
  return {
    clause: { kind: 'filed', feet: scenario.filedAltitude, minutes },
    redundant: null,
  };
}

/** One resolved altitude phrase with the rule and the row that produced it, and its expect delay. */
type AltitudeParts = {
  value: AltitudeValue;
  /** The phraseology rule id the phrase reads under. */
  ruleId: string;
  /** The data row that decided the altitude: an SOP interim row, or the TEC route row. */
  source: RuleCitation;
  minutes: number;
};

/**
 * Assembles the altitude element and the expect clause from what decided the altitude.
 *
 * @param parts The phrase, the phraseology rule, the row that decided it, and the expect delay.
 * @param procedure The selected SID, or the heading the flight is cleared on.
 * @param scenario The filed flight plan.
 * @param airport The airport data.
 * @returns The altitude element, the expect clause and the clause the chart already publishes.
 */
function altitudeWith(
  parts: AltitudeParts,
  procedure: SelectedProcedure,
  scenario: Scenario,
  airport: AirportData,
): ResolvedAltitude {
  const { value, ruleId, source, minutes } = parts;
  const { clause, redundant } = expectClause(
    value,
    procedure,
    scenario,
    airport.phraseology,
    minutes,
  );
  return {
    altitude: { value, citations: [...citePhraseology(airport, ruleId), source] },
    expect: { value: clause, citations: citePhraseology(airport, 'A-EXPECT') },
    redundantExpect: {
      value: redundant,
      citations: redundant === null ? [] : citePhraseology(airport, 'A-EXPECT-REDUNDANT'),
    },
  };
}

/**
 * Resolves the altitude a flight is cleared to and the expect clause that goes with it.
 *
 * A flight whose TEC route row states an initial altitude is issued that altitude, whatever an SOP
 * row would have said: the TEC route is a facility directive, and its initial altitude overrides the
 * SOP (user 2026-09-16). The row must be the one keyed to the flight and must begin on what the
 * clearance in fact issues; every other flight — a row that states no initial altitude, a row whose
 * departure this clearance does not issue, a destination with no row at all — is read against the
 * SOP rows alone.
 *
 * The first interim-altitude row keyed to the plan, runway family, class, and SID family decides:
 * a SID whose published top altitude the row defers to is cleared "climb via SID", an interim
 * altitude is capped at the filed altitude and spoken as "climb via SID except maintain" where the
 * SID has crossing restrictions off that runway, and as "maintain" where it has none. A flight
 * cleared on a heading is keyed to the first row written for that heading, or for every procedure,
 * and is always told to maintain that row's altitude.
 *
 * @param ctx The classified flight.
 * @param procedure The selected SID, or the heading the flight is cleared on.
 * @param scenario The filed flight plan.
 * @param airport The airport data.
 * @returns The altitude element, the expect clause and the clause the chart already publishes, or
 *   `Unresolved` when no row is keyed to the flight.
 */
export function resolveAltitude(
  ctx: Classification,
  procedure: SelectedProcedure,
  scenario: Scenario,
  airport: AirportData,
): ResolvedAltitude | Unresolved {
  const tecRow = tecInitialRow(ctx, procedure, scenario, airport);
  const initialFeet = tecRow?.initialAltitudeFeet;
  if (tecRow !== undefined && initialFeet !== undefined) {
    const { value, ruleId } = tecAltitudeValue(initialFeet, procedure, ctx);
    return altitudeWith(
      {
        value,
        ruleId,
        source: citeTec(tecRow),
        minutes: airport.phraseology.nonStandardInterimExpectMinutes,
      },
      procedure,
      scenario,
      airport,
    );
  }
  const row = airport.altitudeRules.find((entry) => rowMatches(entry, ctx, procedure, airport));
  if (row === undefined) {
    const on = procedure.kind === 'sid' ? procedure.sid.family : 'the runway heading';
    return unresolved(
      'A.phrase',
      `no altitude rule for ${ctx.plan} runway ${ctx.runwayFamily} class ${ctx.aircraftClass} on ${on}`,
    );
  }
  const resolved = altitudeValue(row, procedure, ctx, scenario);
  if (isUnresolved(resolved)) return resolved;
  const { value, ruleId } = resolved;
  return altitudeWith(
    { value, ruleId, source: toCitation(row), minutes: row.expectAfterMinutes },
    procedure,
    scenario,
    airport,
  );
}
