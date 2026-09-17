import type {
  AircraftClass,
  AirportData,
  Destination,
  LoaRule,
  Scenario,
  TecRoute,
} from '@/data/schema.ts';
import { changeArrival } from '@/rules/amend/arrival.ts';
import { citeTec } from '@/rules/amend/cite.ts';
import { tecRouteFor, tecTokens } from '@/rules/amend/tec.ts';
import type { ResolvedAmendment } from '@/rules/amend/types.ts';
import { citePhraseology } from '@/rules/cite.ts';
import type { Classification } from '@/rules/classify.ts';
import { flightDirection, isSidToken, parseFiledRoute } from '@/rules/route.ts';
import type { BuildScope, BuiltRoute } from '@/rules/routeBuild.ts';
import { buildRoute, builtCitations, builtTokens } from '@/rules/routeBuild.ts';
import { unservedSids } from '@/rules/sidSelection.ts';
import type { Procedure, ResolvedClearance, Unresolved } from '@/rules/types.ts';
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

/** The filed plan, how it classifies, the clearance it was given, and the airport data, as one. */
type RouteCheck = {
  scenario: Scenario;
  ctx: Classification;
  clearance: ResolvedClearance;
  airport: AirportData;
};

/**
 * The route box as it should read, and the TEC row or the built route that decided it where one did.
 *
 * `exitElement` travels with a built route because the reason names the element the flight filed out
 * of the terminal on, which is what the SID the SOP assigns does not reach. `scope` travels with it
 * because the reason closes differently on the two paths: a flight already being given a procedure
 * keeps its SID, while a flight the SOP sends off on a heading is issued one in the heading's place.
 */
type ExpectedRoute = {
  tokens: string[];
  tec: TecRoute | undefined;
  built?: BuiltRoute;
  exitElement?: string;
  scope?: BuildScope;
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

/**
 * A route box with the departure airport's navaid after a radar-vector SID, where one belongs.
 *
 * A radar-vector SID publishes no route of its own, so the computerized flight plan needs the
 * airport's own navaid to leave the field on: the box reads `OAK6 OAK RBL`, `SFO5 SFO RBL`. The
 * navaid is filed, not spoken — `routeFromExitFix` skips it and the clearance still reads radar
 * vectors to the first fix — so this only shapes the box the engine writes.
 *
 * @param tokens The route box as the engine would otherwise propose it.
 * @param airport The airport data, whose SIDs say which are flown on vectors.
 * @returns The same tokens, with the navaid after the procedure where the head is a vector SID that
 *   is not already followed by it.
 */
export function withVectorNavaid(tokens: readonly string[], airport: AirportData): string[] {
  const head = tokens[0];
  if (head === undefined) return [...tokens];
  const sid = airport.sids.find((entry) => entry.id === head);
  if (sid?.routePhrasing !== 'radar_vectors_fix') return [...tokens];
  const faa = airport.airport.faa;
  return tokens[1] === faa ? [...tokens] : [head, faa, ...tokens.slice(1)];
}

/** Whether an LOA row is written for this destination, by its ARTCC or by name. */
function appliesTo(row: LoaRule, icao: string, destination: Destination | undefined): boolean {
  if (row.destinations?.includes(icao) === true) return true;
  return destination !== undefined && row.artcc === destination.artcc;
}

/**
 * The route library's row for a destination, absent when the library does not hold it.
 *
 * @param airport The airport data, whose route library holds the destinations.
 * @param icao The destination the flight filed to.
 * @returns The destination row, or `undefined` when the library does not carry the field.
 */
export function destinationRow(airport: AirportData, icao: string): Destination | undefined {
  return airport.routeLibrary.destinations.find((row) => row.icao === icao);
}

/**
 * The route box built on a SID the SOP would assign, where the filed route can be reached from it.
 *
 * A plan filed on a procedure the SOP would have assigned, but which publishes no transition to the
 * fix the route leaves the terminal at, takes the vector SID further down the assignment table only
 * when nothing connects it back: a transition of the filed SID, or the fix that SID ends on, that
 * connects onward to a fix the flight already filed is fewer changes than replacing the procedure.
 * A row that forces a
 * transition is built whatever the plan files, because that is the SOP's routing for the hour. The
 * scope says which candidates may be connected to, and is the caller's rule rather than this one's.
 */
function builtExpectation(
  scenario: Scenario,
  ctx: Classification,
  airport: AirportData,
  scope: BuildScope,
): ExpectedRoute | undefined {
  const parsed = parseFiledRoute(scenario.filedRoute, airport);
  if (isUnresolved(parsed)) return undefined;
  const direction = flightDirection(parsed, airport);
  const candidates = unservedSids(ctx, parsed.exitElement, direction, scenario, airport);
  const built = buildRoute(parsed.tokens, candidates, scope, airport);
  if (built === undefined) return undefined;
  return {
    tokens: withVectorNavaid(builtTokens(built, parsed.tokens), airport),
    tec: undefined,
    built,
    exitElement: parsed.exitElement,
    scope,
  };
}

/** What a flight the SOP is giving a procedure may be built on: the family the pilot filed. */
function filedScope(filed: FiledRoute): BuildScope {
  return {
    kind: 'filed',
    family: filed.procedure === undefined ? undefined : familyOf(filed.procedure),
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
      builtExpectation(scenario, ctx, airport, filedScope(filed)) ?? {
        tokens: withVectorNavaid([assigned, ...filed.tail], airport),
        tec: undefined,
      }
    );
  }
  const tokens = tecTokens(tec, airport);
  return isUnresolved(tokens) ? tokens : { tokens: withVectorNavaid(tokens, airport), tec };
}

/** The reason a TEC destination's route box reads the published route rather than what was filed. */
function tecReason(ctx: Classification, expected: ExpectedRoute, destination: string): string {
  return `${destination} is inside NorCal TRACON; the TEC route for a ${CLASS_WORDS[ctx.aircraftClass]} in ${ctx.plan} is ${expected.tokens.join(' ')}`;
}

/**
 * How a reason names the flight the assignment table answered, e.g. "an RNAV jet".
 *
 * @param ctx The classified flight.
 * @returns The words for its equipment and its performance class.
 */
export function flightWords(ctx: Classification): string {
  return `${ctx.rnavCapable ? 'an RNAV' : 'a non-RNAV'} ${CLASS_WORDS[ctx.aircraftClass]}`;
}

/** The phraseology row that says a clearance without a procedure is spoken as a heading. */
const HEADING_PHRASEOLOGY_ROW = 'R-HEADING';

/**
 * The assignment row that sent the flight off without a procedure, named for the reason.
 *
 * The clearance cites the row that answered the assignment table first and the phraseology row
 * that says how it is spoken after it, so the first citation that is not the phraseology row is the
 * row to name; a clearance citing nothing else falls back to the SOP as a whole.
 */
function headingRowId(clearance: ResolvedClearance): string {
  const row = clearance.procedure.citations.find(
    (citation) => citation.id !== HEADING_PHRASEOLOGY_ROW,
  );
  return row?.id ?? 'the SOP';
}

/**
 * How a reason names the heading the flight is sent off on.
 *
 * Only a clearance flown on a heading reaches a reason at all, so a procedure names the runway
 * heading, the heading every airport with such a row has.
 */
function headingWords(procedure: Procedure): string {
  if (procedure.kind !== 'heading' || procedure.heading === 'runway heading') {
    return 'the runway heading';
  }
  return `heading ${procedure.heading}`;
}

/** The reason the box names no procedure at all: the row that clears this flight assigns none. */
function headingReason(
  scenario: Scenario,
  ctx: Classification,
  clearance: ResolvedClearance,
): string {
  return (
    `${headingRowId(clearance)} sends ${flightWords(ctx)} off ${scenario.departureRunway} on ` +
    `${headingWords(clearance.procedure.value)} with no departure procedure`
  );
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
 * How a built reason closes, which is what the build spared the flight.
 *
 * On the procedure path the flight filed the family it is built on, so the build keeps that SID
 * where the vector SID would otherwise have replaced it; on the heading path the SOP assigns no
 * procedure at all, so the build issues one where the flight would otherwise have been vectored.
 */
function builtClosing(scope: BuildScope | undefined): string {
  return scope?.kind === 'any'
    ? 'so the SID is issued in place of the heading'
    : 'so the SID is kept';
}

/** How a built reason names where the route left the SID: a transition, or the SID's own end fix. */
function startWords(built: BuiltRoute): string {
  const { fix, kind } = built.start;
  return kind === 'base_fix' ? `${fix} is its own end fix` : `${fix} is`;
}

/**
 * The reason a route was built rather than the procedure replaced or a heading issued.
 *
 * A forced transition is the assignment row speaking for itself, so the row's own text carries the
 * reason; a connection build has to say where the route left the SID — a published transition, or
 * the fix the SID itself ends on — and which rows of the cheat sheet carry the route from there
 * back to what the pilot filed.
 */
function builtReason(
  built: BuiltRoute,
  expected: ExpectedRoute,
  scenario: Scenario,
  ctx: Classification,
): string {
  if (built.connections.length === 0) {
    return `${built.row.text}: ${built.sid.id} with the ${built.start.fix} transition, then the filed route`;
  }
  const links = built.connections
    .map((row) => `${row.from} ${row.connects} connects to ${row.to}`)
    .join(', ');
  return (
    `${built.sid.id} is the procedure the SOP assigns ${flightWords(ctx)} from ${scenario.departureRunway} ` +
    `in ${ctx.config.id}, and ${expected.exitElement ?? ''} is not one of its transitions, but ${startWords(built)} ` +
    `and ${links} (route building), ${builtClosing(expected.scope)}`
  );
}

/**
 * The amendment a built route makes, which reads the same whether the flight was to be given a
 * procedure or sent off on a heading: the built box, why it was built, and the rows that built it.
 */
function builtAmendment(
  expected: ExpectedRoute,
  built: BuiltRoute,
  scenario: Scenario,
  ctx: Classification,
  airport: AirportData,
): ResolvedAmendment {
  return {
    box: 'route',
    proposed: expected.tokens.join(' '),
    reason: builtReason(built, expected, scenario, ctx),
    citations: builtCitations(built, airport),
  };
}

/**
 * The amendment that writes the airport navaid into a box that files a vector SID without it.
 *
 * The box is not wrong: the route it names is the route the flight will fly, and the clearance reads
 * the same either way. It is only the fuller way to file the plan, so the amendment is a warning the
 * student is not scored on.
 *
 * @param tokens The route box as it should read, with the navaid in it.
 * @param airport The airport data, for the navaid and the row that says the box carries it.
 * @returns The route amendment, marked as a warning.
 */
function vectorNavaidAmendment(tokens: readonly string[], airport: AirportData): ResolvedAmendment {
  return {
    box: 'route',
    proposed: tokens.join(' '),
    reason:
      `the route names ${tokens[0]} without ${airport.airport.faa} after it; a radar-vector SID is ` +
      `filed as the SID, the airport navaid, then the route (R-RV-NAVAID)`,
    warning: true,
    citations: citePhraseology(airport, 'R-RV-NAVAID'),
  };
}

/** Which of the three cases a route box with no built route is wrong for, written for the player. */
function routeReason(
  filed: FiledRoute,
  expected: ExpectedRoute,
  scenario: Scenario,
  ctx: Classification,
  assigned: string,
): string {
  if (expected.tec !== undefined) return tecReason(ctx, expected, scenario.destination);
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
 * The box is reported unresolved rather than guessed at. A row written for named classes is held
 * only against a flight of one of them, because an attachment cell routes props differently from
 * jets; a row written for the RNAV column alone is held only against an RNAV-capable flight, the
 * conventional column of such a cell reading via filed route.
 *
 * @param tail The route the flight would fly after its procedure, as the box should read it.
 * @param ctx The classified flight, whose class and RNAV capability decide which rows apply.
 * @param icao The destination the flight filed to.
 * @param airport The airport data, whose `loaRules` hold the routing rows.
 * @param destination The destination row, absent when the route library does not hold it.
 * @returns The gap, or `undefined` when every routing row written for the destination is met.
 */
export function loaRouteGap(
  tail: readonly string[],
  ctx: Classification,
  icao: string,
  airport: AirportData,
  destination: Destination | undefined,
): Unresolved | undefined {
  const routing = unmetRouteRow(tail, ctx, icao, airport, destination);
  return routing === undefined ? undefined : loaRouteGapOf(routing);
}

/** One routing row of a letter of agreement, with the fixes it demands the route name one of. */
export type LoaRouting = { row: LoaRule; tokens: string[] };

/**
 * The first routing row written for this flight that the route names none of the fixes of.
 *
 * @param tail The route the flight would fly after its procedure, as the box should read it.
 * @param ctx The classified flight, whose class and RNAV capability decide which rows apply.
 * @param icao The destination the flight filed to.
 * @param airport The airport data, whose `loaRules` hold the routing rows.
 * @param destination The destination row, absent when the route library does not hold it.
 * @returns The unmet row and its fixes, or `undefined` when every applicable row is met.
 */
export function unmetRouteRow(
  tail: readonly string[],
  ctx: Classification,
  icao: string,
  airport: AirportData,
  destination: Destination | undefined,
): LoaRouting | undefined {
  return loaRouteRows(ctx, icao, airport, destination).find(
    ({ tokens }) => !tokens.some((token) => tail.includes(token)),
  );
}

/**
 * The unresolved box an unmet routing row leaves: the row, its own text, and the fixes it names.
 *
 * @param routing The routing row the route meets none of the fixes of.
 * @returns The unresolved route box.
 */
export function loaRouteGapOf(routing: LoaRouting): Unresolved {
  const { row, tokens } = routing;
  return unresolved(
    'BOX.route',
    `${row.id}: ${row.text}; the route names none of ${tokens.join(', ')}`,
  );
}

/**
 * The routing rows of the letters of agreement written for this destination and this flight.
 *
 * A row written for named classes is read only for a flight of one of them, because an attachment
 * cell routes props differently from jets; a row written for the RNAV column alone is read only for
 * an RNAV-capable flight, the conventional column of such a cell reading via filed route.
 *
 * @param ctx The classified flight, whose class and RNAV capability decide which rows apply.
 * @param icao The destination the flight filed to.
 * @param airport The airport data, whose `loaRules` hold the routing rows.
 * @param destination The destination row, absent when the route library does not hold it.
 * @returns The applicable rows in table order, each with the fixes it names.
 */
export function loaRouteRows(
  ctx: Classification,
  icao: string,
  airport: AirportData,
  destination: Destination | undefined,
): LoaRouting[] {
  return airport.loaRules.flatMap((row) => {
    const { rule } = row;
    if (rule.kind !== 'route' || !appliesTo(row, icao, destination)) return [];
    if (rule.classes !== undefined && !rule.classes.includes(ctx.aircraftClass)) return [];
    if (rule.rnavOnly === true && !ctx.rnavCapable) return [];
    return [{ row, tokens: rule.tokens }];
  });
}

/**
 * Checks the route box of a flight the SOP clears on the runway heading, which names no procedure.
 *
 * A heading is issued only because no SID the table reaches serves the fix the route leaves the
 * terminal at, and route building may still connect an assignable SID's transition, or the fix that
 * SID ends on, to a fix further
 * down the filed route, which is fewer changes than a heading; so where a route builds, the box is
 * that built route and the flight is given the SID after all. Whatever the plan filed may be built
 * on here, there being no procedure the SOP wanted this flight to keep.
 *
 * Failing a build, the box is the tail the pilot filed, so a plan that files a departure procedure
 * is amended down to that tail and a plan that files none is left alone. A TEC route wins over both,
 * but a row whose route begins on a departure family never applies to such a flight: `tecRouteFor`
 * puts the row's own route to the clearance engine, which answers this flight with a heading rather
 * than with the family the row begins on. A row that begins on an initial heading token is reached
 * where the flight is issued that same heading, and its route, the token dropped, is the box.
 *
 * A box for a destination outside the TRACON then goes through the arrival step, which may put the
 * flight on another arrival of its destination and, where a SID the table passed over reaches an
 * entry fix of one, issue that SID in the heading's place. The LOA routing rows are read there
 * rather than here: a box that misses one is routed onto an arrival the letter names where the
 * connections reach it, and only a box no arrival is reachable from is reported as the gap it
 * leaves.
 *
 * @param filed The route box as filed, split on a leading procedure token.
 * @param check The filed plan, its classification, the clearance it was given, and the data.
 * @returns The amendment for the route box, `undefined` when the box reads right, or `Unresolved`
 *   when an LOA row demands a routing no data can propose.
 */
function checkHeadingRoute(
  filed: FiledRoute,
  check: RouteCheck,
): ResolvedAmendment | undefined | Unresolved {
  const { scenario, ctx, airport } = check;
  const destination = destinationRow(airport, scenario.destination);
  const tec = tecRouteFor(ctx, scenario, airport, destination);
  const build =
    tec === undefined ? builtExpectation(scenario, ctx, airport, { kind: 'any' }) : undefined;
  const resolved = tec === undefined ? (build?.tokens ?? filed.tail) : tecTokens(tec, airport);
  if (isUnresolved(resolved)) return resolved;
  const expected: ExpectedRoute = { ...build, tokens: withVectorNavaid(resolved, airport), tec };
  const outcome = headingOutcome(filed, expected, check);
  if (tec !== undefined) return outcome;
  if (outcome !== undefined && isUnresolved(outcome)) return outcome;
  return changeArrival(expected.tokens, outcome, scenario, ctx, airport);
}

/**
 * The amendment a flight on a heading needs before the arrival step, if any.
 *
 * @param filed The route box as filed, split on a leading procedure token.
 * @param expected The box as it should read, with the TEC row or built route that decided it.
 * @param check The filed plan, its classification, the clearance it was given, and the data.
 * @returns The amendment, `undefined` when the box reads right, or `Unresolved` where a TEC box
 *   misses the routing an LOA row demands.
 */
function headingOutcome(
  filed: FiledRoute,
  expected: ExpectedRoute,
  check: RouteCheck,
): ResolvedAmendment | undefined | Unresolved {
  const { scenario, ctx, clearance, airport } = check;
  const { tec, tokens } = expected;
  if (tokens.join(' ') === filed.tokens.join(' ')) {
    if (tec === undefined) return undefined;
    const destination = destinationRow(airport, scenario.destination);
    return loaRouteGap(tokens, ctx, scenario.destination, airport, destination);
  }
  const built = expected.built;
  if (built !== undefined) return builtAmendment(expected, built, scenario, ctx, airport);
  return {
    box: 'route',
    proposed: tokens.join(' '),
    reason:
      tec === undefined
        ? headingReason(scenario, ctx, clearance)
        : tecReason(ctx, expected, scenario.destination),
    citations: [...clearance.procedure.citations, ...(tec === undefined ? [] : [citeTec(tec)])],
  };
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
 * transition, or by the fix the procedure ends on, that connects onward to the filed route; a
 * transition is preferred where both reach it equally soon. A row that forces a transition builds the box
 * on that row's own SID whatever was filed. A flight the SOP clears on the runway heading is
 * built the same way, on any SID the table passed over rather than only on the filed family, because
 * it has no procedure to keep; failing a build its box is the filed tail alone. A clearance the
 * engine has already built a route for is one of those flights: the heading is what it would have
 * been issued, and the box is the route that was built in its place. Every box the check proposes
 * carries the airport's own navaid after a radar-vector SID, which is how such a plan is filed; a
 * box that files the vector SID without it is amended as a warning, the plan being filed acceptably
 * either way.
 *
 * Whatever that leaves, a box whose destination is outside the TRACON goes through the arrival step
 * last: a flight bound for a field the common-arrivals sheet covers is put on an arrival its
 * equipment can fly, and a box that meets none of the fixes a letter of agreement demands is routed
 * onto one the letter names, in both cases at an entry fix the connections reach. A destination
 * inside the TRACON is left to the TEC table, which owns its routing, and a box that misses an LOA
 * routing no arrival is reachable for is reported as the gap it leaves.
 *
 * @param scenario The filed flight plan.
 * @param ctx The classified flight, which keys the TEC route rows.
 * @param clearance The clearance the engine resolved for the plan, which carries the procedure the
 *   SOP assigns it, or the runway heading where it assigns none.
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
  const check: RouteCheck = { scenario, ctx, clearance, airport };
  const filed = splitFiled(scenario.filedRoute);
  const procedure = clearance.procedure.value;
  if (procedure.kind === 'heading' || clearance.route.value.builtRoute !== undefined) {
    return checkHeadingRoute(filed, check);
  }
  const expected = expectedRoute(filed, scenario, ctx, procedure.id, airport);
  if (isUnresolved(expected)) return expected;
  const outcome = procedureOutcome(filed, expected, procedure.id, check);
  if (expected.tec !== undefined) return outcome;
  if (outcome !== undefined && isUnresolved(outcome)) return outcome;
  return changeArrival(expected.tokens, outcome, scenario, ctx, airport);
}

/**
 * The amendment a flight given a procedure needs before the arrival step, if any.
 *
 * @param filed The route box as filed, split on a leading procedure token.
 * @param expected The box as it should read, with the TEC row or built route that decided it.
 * @param assigned The identifier of the procedure the SOP assigns the flight.
 * @param check The filed plan, its classification, the clearance it was given, and the data.
 * @returns The amendment, `undefined` when the box reads right, or `Unresolved` where a TEC box
 *   misses the routing an LOA row demands.
 */
function procedureOutcome(
  filed: FiledRoute,
  expected: ExpectedRoute,
  assigned: string,
  check: RouteCheck,
): ResolvedAmendment | undefined | Unresolved {
  const { scenario, ctx, clearance, airport } = check;
  if (expected.tokens.join(' ') === filed.tokens.join(' ')) {
    if (expected.tec === undefined) return undefined;
    const destination = destinationRow(airport, scenario.destination);
    return loaRouteGap(expected.tokens.slice(1), ctx, scenario.destination, airport, destination);
  }
  if (withVectorNavaid(filed.tokens, airport).join(' ') === expected.tokens.join(' ')) {
    return vectorNavaidAmendment(expected.tokens, airport);
  }
  const built = expected.built;
  if (built !== undefined) return builtAmendment(expected, built, scenario, ctx, airport);
  return {
    box: 'route',
    proposed: expected.tokens.join(' '),
    reason: routeReason(filed, expected, scenario, ctx, assigned),
    citations: [
      ...clearance.procedure.citations,
      ...(expected.tec === undefined ? [] : [citeTec(expected.tec)]),
    ],
  };
}
