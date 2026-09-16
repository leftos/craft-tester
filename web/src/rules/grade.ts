import type { AirportData, RouteTemplate } from '@/data/schema.ts';
import type {
  ExpectClause,
  Grade,
  PlayerPicks,
  ResolvedClearance,
  Verdict,
} from '@/rules/types.ts';
import { HEADING_PROCEDURE_LABEL } from '@/rules/types.ts';

/**
 * What an expect clause answers: the delay in minutes, the final-altitude reading, or no clause.
 *
 * The altitude in the clause is never a pick — it is the one the strip reads — so the answer is the
 * shape of the clause alone, which is what a pick and a resolved clause are compared on.
 */
type ExpectAnswer = number | 'final' | null;

/** What each expect-clause pick answers; `none` means no expect clause at all. */
const EXPECT_ANSWERS: Record<PlayerPicks['expect'], ExpectAnswer> = {
  ten_minutes: 10,
  five_minutes: 5,
  three_minutes: 3,
  final: 'final',
  none: null,
};

/** What the clause the engine resolved answers, which is what a pick has to match. */
function expectAnswer(clause: ExpectClause | null): ExpectAnswer {
  if (clause === null) return null;
  return clause.kind === 'final' ? 'final' : clause.minutes;
}

/**
 * Renders feet with thousands separators, e.g. `10000` as `10,000`.
 *
 * @param feet The altitude in feet.
 * @returns The altitude as it is written on a strip or in a dropdown.
 */
export function formatFeet(feet: number): string {
  return String(feet).replace(/\B(?=(?:\d{3})+$)/g, ',');
}

/**
 * How the form and the results view name each route shape on its own, when the pick names no element.
 *
 * "Then as filed" is not a shape: it follows the SID and the transition or exit fix whatever the
 * shape, so the shape for a bare exit fix is the fix with nothing in front of it.
 */
const ROUTE_PHRASES: Record<RouteTemplate, string> = {
  transition: 'transition',
  radar_vectors_fix: 'radar vectors',
  radar_vectors_airway: 'radar vectors to join',
  as_filed: '(no prefix)',
};

/**
 * Renders a route element the way the results view names it, e.g. `DEDHD transition`.
 *
 * @param route The route shape and, where the clearance names one, the element it speaks.
 * @returns The label, which is the bare shape when the route names no element.
 */
export function routeLabel(route: ResolvedClearance['route']['value']): string {
  const { template, fix } = route;
  if (fix === undefined) return ROUTE_PHRASES[template];
  if (template === 'transition') return `${fix} transition`;
  if (template === 'as_filed') return fix;
  return `${ROUTE_PHRASES[template]} ${fix}`;
}

/**
 * Renders an altitude element, e.g. `climb via SID except maintain 10,000`.
 *
 * @param altitude The altitude phrase and, where the phrase speaks one, the feet.
 * @returns The label, which is the bare phrase when no feet are spoken.
 */
export function altitudeLabel(altitude: ResolvedClearance['altitude']['value']): string {
  const { phrase, feet } = altitude;
  if (phrase === 'climb_via') return 'climb via SID';
  const suffix = feet === undefined ? '' : ` ${formatFeet(feet)}`;
  return phrase === 'maintain' ? `maintain${suffix}` : `climb via SID except maintain${suffix}`;
}

/**
 * Renders a clause spoken at a delay, which names the filed altitude or the amended one.
 *
 * The altitude in the clause is the one the strip reads rather than a pick, so the label names
 * which of the two it is and leaves the feet to the reading itself.
 */
function delayLabel(minutes: number, amended: boolean): string {
  return `expect ${amended ? 'amended' : 'filed'} altitude ${minutes} minutes after departure`;
}

/** Renders the clause that says the altitude just spoken is the one the flight tops out at. */
function finalLabel(feet: number | undefined): string {
  return feet === undefined
    ? 'the filed altitude will be your final'
    : `${formatFeet(feet)} will be your final`;
}

/**
 * Renders the expect clause the engine resolved, the way the results view names it.
 *
 * @param clause The clause the clearance speaks, or null where it speaks none.
 * @returns The label, e.g. `expect filed altitude 10 minutes after departure`.
 */
export function expectLabel(clause: ExpectClause | null): string {
  if (clause === null) return 'no expect altitude';
  if (clause.kind === 'final') return finalLabel(clause.feet);
  return delayLabel(clause.minutes, clause.kind === 'amended');
}

/**
 * Renders an expect-clause choice the way the form and the results view name it.
 *
 * A delay names the amended altitude wherever the altitude box was amended, which is either
 * reading the amendment engine writes; `final` names the altitude itself.
 *
 * @param choice The expect clause the player picked, or `none` for no expect clause at all.
 * @param clause The clause the clearance speaks, or null where it speaks none.
 * @param finalFeet The altitude the `final` choice names: the amended altitude where the altitude
 *   box was amended, else the filed one.
 * @returns The label, e.g. `expect filed altitude 10 minutes after departure`.
 */
export function expectChoiceLabel(
  choice: PlayerPicks['expect'],
  clause: ExpectClause | null,
  finalFeet: number | undefined,
): string {
  const answer = EXPECT_ANSWERS[choice];
  if (answer === null) return 'no expect altitude';
  if (answer === 'final') return finalLabel(finalFeet);
  return delayLabel(answer, clause !== null && clause.kind !== 'filed');
}

/**
 * The route element matches when the template matches and, where one is spoken, the element too.
 *
 * Every shape names an element now, "as filed" included, so the fix is always compared.
 */
function routeOk(picks: PlayerPicks, route: ResolvedClearance['route']['value']): boolean {
  return picks.routeTemplate === route.template && picks.routeFix === route.fix;
}

/** The altitude element matches when the phrase matches and, where one is spoken, the feet too. */
function altitudeOk(picks: PlayerPicks, altitude: ResolvedClearance['altitude']['value']): boolean {
  if (picks.altitudePhrase !== altitude.phrase) return false;
  if (altitude.phrase === 'climb_via') return true;
  return picks.altitudeFeet === altitude.feet;
}

/**
 * The verdict for an element that is either right or wrong, with nothing in between.
 *
 * @param ok Whether the answer matched what the engine resolved.
 * @returns `correct` or `wrong`.
 */
export function verdictOf(ok: boolean): Verdict {
  return ok ? 'correct' : 'wrong';
}

/**
 * The altitude a "will be your final" label names, which the clearance already carries.
 *
 * The clause names the amended altitude wherever the altitude box was amended and the filed one
 * otherwise; where the clearance speaks no clause at all, the flight is cleared to the altitude it
 * filed, which the altitude element names wherever the phrase speaks feet and the clause the chart
 * publishes names wherever it does not.
 */
function finalFeetOf(expected: ResolvedClearance): number | undefined {
  return (
    expected.expect.value?.feet ??
    expected.altitude.value.feet ??
    expected.redundantExpect.value?.feet
  );
}

/**
 * Grades the expect clause on its shape alone; the altitude in it is the strip's, not a pick.
 *
 * A delay is right at the delay the clearance speaks, and "will be your final" only where the
 * clearance speaks that reading. A delay is acceptable rather than wrong wherever the clearance
 * carries a longer reading the rules still allow at that same delay — the note the SID chart
 * already publishes, or the amended clause beside "will be your final". Any other delay is a miss,
 * as is speaking a clause where the clearance drops it for any other reason.
 */
function gradeExpect(picks: PlayerPicks, expected: ResolvedClearance): Grade {
  const picked = EXPECT_ANSWERS[picks.expect];
  const clause = expected.expect.value;
  const wanted = expectAnswer(clause);
  const redundant = expected.redundantExpect.value;
  const acceptable = picked !== wanted && redundant !== null && picked === redundant.minutes;
  return {
    element: 'A.expect',
    verdict: acceptable ? 'acceptable' : verdictOf(picked === wanted),
    expectedLabel: expectLabel(clause),
    actualLabel: expectChoiceLabel(picks.expect, clause, finalFeetOf(expected)),
    citations: acceptable ? expected.redundantExpect.citations : expected.expect.citations,
  };
}

/** What the procedure dropdown carries for a clearance the SOP issues without a procedure. */
export const HEADING_PROCEDURE_PICK = 'runway heading';

/** Names one procedure as its chart does, falling back to the identifier where none is published. */
function procedureLabel(id: string, airport: AirportData): string {
  return airport.sids.find((sid) => sid.id === id)?.chartName ?? id;
}

/** How the clearance names what it sends the flight out on, for the expected label. */
function expectedProcedureLabel(expected: ResolvedClearance, airport: AirportData): string {
  const procedure = expected.procedure.value;
  return procedure.kind === 'sid' ? procedureLabel(procedure.id, airport) : HEADING_PROCEDURE_LABEL;
}

/**
 * Grades the procedure the player assigned against the one the engine resolved.
 *
 * The comparison is by family rather than by identifier, because an AIRAC cycle bumps the version
 * in the identifier without changing the procedure the controller assigns. A clearance the SOP
 * sends off on the runway heading names no procedure, so every published procedure is wrong for it
 * and the runway heading itself is the right answer; that same heading is wrong for a clearance
 * that does assign a procedure.
 *
 * @param procedureId The identifier of the SID the player picked, e.g. `TRUKN2`, or
 *   `HEADING_PROCEDURE_PICK` where the player answered with the runway heading.
 * @param expected The clearance the engine resolved for the same scenario.
 * @param airport The airport data, which names the published procedures.
 * @returns The verdict for `R.sid`, labelled as the charts name the two procedures.
 */
export function gradeProcedure(
  procedureId: string,
  expected: ResolvedClearance,
  airport: AirportData,
): Grade {
  const procedure = expected.procedure.value;
  const heading = procedureId === HEADING_PROCEDURE_PICK;
  const family = airport.sids.find((sid) => sid.id === procedureId)?.family;
  return {
    element: 'R.sid',
    verdict: verdictOf(
      heading
        ? procedure.kind === 'heading'
        : procedure.kind === 'sid' && family !== undefined && family === procedure.family,
    ),
    expectedLabel: expectedProcedureLabel(expected, airport),
    actualLabel: heading ? HEADING_PROCEDURE_LABEL : procedureLabel(procedureId, airport),
    citations: expected.procedure.citations,
  };
}

/** Grades the runway on the bare runway the player expected, e.g. `01R`. */
function gradeRunway(picks: PlayerPicks, expected: ResolvedClearance): Grade {
  return {
    element: 'RWY',
    verdict: verdictOf(picks.runway === expected.runway.value),
    expectedLabel: expected.runway.value,
    actualLabel: picks.runway,
    citations: expected.runway.citations,
  };
}

/**
 * Grades a player's CRAFT entry element by element against the engine's clearance.
 *
 * Every element but the expect clause is either correct or wrong; the expect clause can also come
 * back acceptable, where the reading is longer than it needs to be without being a miss.
 *
 * @param picks What the player entered in the form.
 * @param expected The clearance the engine resolved for the same scenario.
 * @returns Exactly five verdicts, in the order R.route, A.phrase, A.expect, F, RWY.
 */
export function grade(picks: PlayerPicks, expected: ResolvedClearance): Grade[] {
  const route = expected.route.value;
  const altitude = expected.altitude.value;
  const actualRoute =
    picks.routeFix === undefined
      ? { template: picks.routeTemplate }
      : { template: picks.routeTemplate, fix: picks.routeFix };
  const actualAltitude =
    picks.altitudeFeet === undefined
      ? { phrase: picks.altitudePhrase }
      : { phrase: picks.altitudePhrase, feet: picks.altitudeFeet };
  return [
    {
      element: 'R.route',
      verdict: verdictOf(routeOk(picks, route)),
      expectedLabel: routeLabel(route),
      actualLabel: routeLabel(actualRoute),
      citations: expected.route.citations,
    },
    {
      element: 'A.phrase',
      verdict: verdictOf(altitudeOk(picks, altitude)),
      expectedLabel: altitudeLabel(altitude),
      actualLabel: altitudeLabel(actualAltitude),
      citations: expected.altitude.citations,
    },
    gradeExpect(picks, expected),
    {
      element: 'F',
      verdict: verdictOf(picks.frequency === expected.frequency.value.value),
      expectedLabel: expected.frequency.value.value,
      actualLabel: picks.frequency,
      citations: expected.frequency.citations,
    },
    gradeRunway(picks, expected),
  ];
}
