import type {
  AircraftClass,
  AirportData,
  Destination,
  LoaRule,
  Scenario,
  TecRoute,
} from '@/data/schema.ts';
import type { BuiltRoute } from '@/rules/amend/build.ts';
import { buildRoute, builtTokens } from '@/rules/amend/build.ts';
import { citeTec } from '@/rules/amend/cite.ts';
import { tecRouteFor, tecTokens } from '@/rules/amend/tec.ts';
import type { ResolvedAmendment } from '@/rules/amend/types.ts';
import { citePhraseology, toCitation } from '@/rules/cite.ts';
import type { Classification } from '@/rules/classify.ts';
import { flightDirection, isSidToken, parseFiledRoute } from '@/rules/route.ts';
import { unservedSids } from '@/rules/sidSelection.ts';
import type { ResolvedClearance, RuleCitation, Unresolved } from '@/rules/types.ts';
import { isUnresolved, unresolved } from '@/rules/unresolved.ts';

/** A procedure token split into the family and the version digit the AIRAC cycle bumps. */
const PROCEDURE_TOKEN = /^([A-Z]+)(\d)$/;

/** What a controller calls each performance class when reading a reason aloud. */
const CLASS_WORDS: Record<AircraftClass, string> = {
  P: 'piston',
  T: 'turboprop',
  J: 'jet',
};

/** The filed route box split into the procedure it files, where it files one, and the rest. */
type FiledRoute = {
  procedure: string | undefined;
  tail: string[];
  tokens: string[];
};

/**
 * The route box as it should read, and the TEC row or the built route that decided it where one did.
 *
 * `exitElement` travels with a built route because the reason names the element the flight filed out
 * of the terminal on, which is what the SID the SOP assigns does not reach.
 */
type ExpectedRoute = {
  tokens: string[];
  tec: TecRoute | undefined;
  built?: BuiltRoute;
  exitElement?: string;
};

/** Splits the route box on whitespace, taking a leading procedure token off the front. */
function splitFiled(filedRoute: string): FiledRoute {
  const tokens = filedRoute
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  const head = tokens[0];
  const procedure = head !== undefined && isSidToken(head) ? head : undefined;
  return { procedure, tail: procedure === undefined ? tokens : tokens.slice(1), tokens };
}

/** The family half of a procedure token, e.g. `TRUKN` of `TRUKN1`. */
function familyOf(token: string): string | undefined {
  return PROCEDURE_TOKEN.exec(token)?.[1];
}

/** Whether an LOA row is written for this destination, by its ARTCC or by name. */
function appliesTo(row: LoaRule, icao: string, destination: Destination | undefined): boolean {
  if (row.destinations?.includes(icao) === true) return true;
  return destination !== undefined && row.artcc === destination.artcc;
}

/** The route library's row for a destination, absent when the library does not hold it. */
function destinationRow(airport: AirportData, icao: string): Destination | undefined {
  return airport.routeLibrary.destinations.find((row) => row.icao === icao);
}

/**
 * The route box built on the procedure the pilot filed, where the filed route can be reached from it.
 *
 * A plan filed on a procedure the SOP would have assigned, but which publishes no transition to the
 * fix the route leaves the terminal at, takes the vector SID further down the assignment table only
 * when nothing connects it back: a transition of the filed SID that connects onward to a fix the
 * flight already filed is fewer changes than replacing the procedure. A row that forces a
 * transition is built whatever the plan files, because that is the SOP's routing for the hour.
 */
function builtExpectation(
  scenario: Scenario,
  ctx: Classification,
  airport: AirportData,
): ExpectedRoute | undefined {
  const parsed = parseFiledRoute(scenario.filedRoute, airport);
  if (isUnresolved(parsed)) return undefined;
  const direction = flightDirection(parsed, airport);
  const candidates = unservedSids(ctx, parsed.exitElement, direction, scenario, airport);
  const filedFamily =
    parsed.filedSidToken === undefined ? undefined : familyOf(parsed.filedSidToken);
  const built = buildRoute(parsed.tokens, candidates, filedFamily, airport);
  if (built === undefined) return undefined;
  return {
    tokens: builtTokens(built, parsed.tokens),
    tec: undefined,
    built,
    exitElement: parsed.exitElement,
  };
}

/**
 * The route box as it should read: the TEC route for a TRACON destination, else the route built on
 * the assigned procedure, else that procedure followed by the tail the pilot filed.
 *
 * The TEC route is only one whose departure the SOP would issue this flight; where no row's is,
 * the flight is vectored on its assigned departure and the filed tail stands.
 */
function expectedRoute(
  filed: FiledRoute,
  scenario: Scenario,
  ctx: Classification,
  assigned: string,
  airport: AirportData,
): ExpectedRoute | Unresolved {
  const destination = destinationRow(airport, scenario.destination);
  const tec = tecRouteFor(ctx, scenario, airport, destination);
  if (tec === undefined) {
    return (
      builtExpectation(scenario, ctx, airport) ?? {
        tokens: [assigned, ...filed.tail],
        tec: undefined,
      }
    );
  }
  const tokens = tecTokens(tec, airport);
  return isUnresolved(tokens) ? tokens : { tokens, tec };
}

/** The reason a TEC destination's route box reads the published route rather than what was filed. */
function tecReason(ctx: Classification, expected: ExpectedRoute, destination: string): string {
  return `${destination} is inside NorCal TRACON; the TEC route for a ${CLASS_WORDS[ctx.aircraftClass]} in ${ctx.plan} is ${expected.tokens.join(' ')}`;
}

/** How a reason names the flight the assignment table answered, e.g. "an RNAV jet". */
function flightWords(ctx: Classification): string {
  return `${ctx.rnavCapable ? 'an RNAV' : 'a non-RNAV'} ${CLASS_WORDS[ctx.aircraftClass]}`;
}

/** The reason a filed procedure is not the one the SOP assigns this flight. */
function procedureReason(
  filed: string,
  assigned: string,
  scenario: Scenario,
  ctx: Classification,
): string {
  const family = familyOf(filed);
  if (family !== undefined && family === familyOf(assigned)) {
    return `${filed} is not the current version of the ${family} departure, which is ${assigned}`;
  }
  return `${filed} is not the procedure the SOP assigns ${flightWords(ctx)} from ${scenario.departureRunway} in ${ctx.config.id}; it is ${assigned}`;
}

/**
 * The reason a route was built rather than the procedure replaced.
 *
 * A forced transition is the assignment row speaking for itself, so the row's own text carries the
 * reason; a connection build has to say which transition was taken and which rows of the cheat
 * sheet carry the route from there back to what the pilot filed.
 */
function builtReason(
  built: BuiltRoute,
  exitElement: string,
  scenario: Scenario,
  ctx: Classification,
): string {
  if (built.connections.length === 0) {
    return `${built.row.text}: ${built.sid.id} with the ${built.transition} transition, then the filed route`;
  }
  const links = built.connections
    .map((row) => `${row.from} ${row.connects} connects to ${row.to}`)
    .join(', ');
  return (
    `${built.sid.id} is the procedure the SOP assigns ${flightWords(ctx)} from ${scenario.departureRunway} ` +
    `in ${ctx.config.id}, and ${exitElement} is not one of its transitions, but ${built.transition} is ` +
    `and ${links} (route building), so the SID is kept`
  );
}

/**
 * The rows a built route is cited to, in place of the ones the vector-SID clearance was decided by.
 *
 * The assignment row is the SOP's answer the build kept, and what follows it is how the route got
 * back to the filed one: the connection rows of the chain and the rule that says to build it, or,
 * for a forced transition, the rule that a transition is spoken with the procedure.
 */
function builtCitations(built: BuiltRoute, airport: AirportData): RuleCitation[] {
  if (built.connections.length === 0) {
    return [toCitation(built.row), ...citePhraseology(airport, 'R-TRANSITION')];
  }
  return [
    toCitation(built.row),
    ...built.connections.map(toCitation),
    ...citePhraseology(airport, 'R-ROUTE-BUILD'),
  ];
}

/** Which of the four cases the route box is wrong for, written out for the player. */
function routeReason(
  filed: FiledRoute,
  expected: ExpectedRoute,
  scenario: Scenario,
  ctx: Classification,
  assigned: string,
): string {
  if (expected.tec !== undefined) return tecReason(ctx, expected, scenario.destination);
  if (expected.built !== undefined) {
    return builtReason(expected.built, expected.exitElement ?? '', scenario, ctx);
  }
  if (filed.procedure === undefined) {
    return `the route files no departure procedure; the SOP assigns ${assigned} from ${scenario.departureRunway} in ${ctx.config.id}`;
  }
  return procedureReason(filed.procedure, assigned, scenario, ctx);
}

/**
 * The LOA routing row, if any, that the route box satisfies none of the tokens of.
 *
 * An LOA row names the fixes an arrival stream must be routed over, so a route that names none of
 * them is wrong; but the row does not say which of its fixes this flight should be given, and the
 * airway structure that would reach one is not in the data, so no route can be proposed from it.
 * The box is reported unresolved rather than guessed at.
 *
 * @param tail The route the flight would fly after its procedure, as the box should read it.
 * @param icao The destination the flight filed to.
 * @param airport The airport data, whose `loaRules` hold the routing rows.
 * @param destination The destination row, absent when the route library does not hold it.
 * @returns The gap, or `undefined` when every routing row written for the destination is met.
 */
export function loaRouteGap(
  tail: readonly string[],
  icao: string,
  airport: AirportData,
  destination: Destination | undefined,
): Unresolved | undefined {
  for (const row of airport.loaRules) {
    const { rule } = row;
    if (rule.kind !== 'route' || !appliesTo(row, icao, destination)) continue;
    if (rule.tokens.some((token) => tail.includes(token))) continue;
    return unresolved(
      'BOX.route',
      `${row.id}: ${row.text}; the route names none of ${rule.tokens.join(', ')}`,
    );
  }
  return undefined;
}

/**
 * Checks the route box of the strip against the procedure the SOP assigns and the routings the
 * letters of agreement demand.
 *
 * The box must read the assigned procedure, at the version in force this cycle, followed by the
 * tail the pilot filed; for a destination inside the TRACON it must read the published TEC route
 * instead, where one begins on a departure the SOP would issue this flight. A row beginning on a
 * departure this flight would not be issued is not a route it can be given, and the box then reads
 * the assigned procedure and the filed tail like any other. That one rule covers a plan filed with no
 * procedure, a stale version, another configuration's procedure, and one an operational notice has
 * taken out of use, and the reason says which of those it is. Where the assignment table only
 * reached the procedure it did because the procedure the pilot filed publishes no transition to the
 * fix the route leaves the terminal at, the box is built on the filed procedure instead, by a
 * transition that connects onward to the filed route; a row that forces a transition builds the box
 * on that row's own SID whatever was filed. A box that already reads right is then held against the
 * LOA routing rows written for the destination. A flight the SOP clears on the runway heading has no
 * procedure for the box to read, and the box is reported unresolved rather than guessed at.
 *
 * @param scenario The filed flight plan.
 * @param ctx The classified flight, which keys the TEC route rows.
 * @param clearance The clearance the engine resolved for the plan, which carries the assigned SID.
 * @param airport The airport data.
 * @returns The amendment for the route box, `undefined` when the box reads right, or `Unresolved`
 *   when the data cannot say what the box should read.
 */
export function checkRoute(
  scenario: Scenario,
  ctx: Classification,
  clearance: ResolvedClearance,
  airport: AirportData,
): ResolvedAmendment | undefined | Unresolved {
  const filed = splitFiled(scenario.filedRoute);
  const procedure = clearance.procedure.value;
  if (procedure.kind === 'heading') {
    return unresolved(
      'BOX.route',
      'the SOP clears this flight on the runway heading with no departure procedure, and the route box for a clearance without one is not written yet',
    );
  }
  const expected = expectedRoute(filed, scenario, ctx, procedure.id, airport);
  if (isUnresolved(expected)) return expected;
  const tail = expected.tokens.slice(1);
  if (expected.tokens.join(' ') === filed.tokens.join(' ')) {
    const destination = destinationRow(airport, scenario.destination);
    return loaRouteGap(tail, scenario.destination, airport, destination);
  }
  return {
    box: 'route',
    proposed: expected.tokens.join(' '),
    reason: routeReason(filed, expected, scenario, ctx, procedure.id),
    citations:
      expected.built === undefined
        ? [
            ...clearance.procedure.citations,
            ...(expected.tec === undefined ? [] : [citeTec(expected.tec)]),
          ]
        : builtCitations(expected.built, airport),
  };
}
