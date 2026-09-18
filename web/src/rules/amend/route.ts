import type {
  AircraftClass,
  AirportData,
  Destination,
  LoaRule,
  RouteConnection,
  Scenario,
  Sid,
  TecRoute,
} from '@/data/schema.ts';
import { changeArrival } from '@/rules/amend/arrival.ts';
import type { ResolvedAmendment } from '@/rules/amend/types.ts';
import { citePhraseology, citeTec } from '@/rules/cite.ts';
import type { Classification } from '@/rules/classify.ts';
import type { RnavElement, RnavNeed } from '@/rules/route.ts';
import {
  flightDirection,
  isMalformedToken,
  isSidToken,
  lackingRnavElements,
  parseFiledRoute,
} from '@/rules/route.ts';
import type { BuildScope, BuiltRoute, FixChain } from '@/rules/routeBuild.ts';
import {
  buildRoute,
  builtCitations,
  builtTokens,
  connectFixes,
  connectionCitations,
} from '@/rules/routeBuild.ts';
import { unservedSids } from '@/rules/sidSelection.ts';
import { tecHead, tecTokens, usableTecRoute } from '@/rules/tecRoutes.ts';
import type { Procedure, ResolvedClearance, RuleCitation, Unresolved } from '@/rules/types.ts';
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
 * `dropped` travels with a box the SOP's own procedure and the filed tail decided, and with a built
 * one, naming the fixes the departure already flies over that the route is no longer read from; a
 * built box reads past them the same way, its build starting from the element they are read to.
 * `structureSids` travels beside it, naming every SID whose structure those fixes lie on, from which
 * a reason names the procedure the box itself proposes where that one is among them and the first
 * otherwise: on a built box the route is read past another departure's structure, which the box does
 * have to name. `repair` travels with a box the filed route named something unflyable in, naming
 * what was taken out and how the gap was closed. `joinedTec` travels with a box joined onto a
 * noise-abatement SID, naming the TEC row whose route the box's tail is: the box is not the row's route
 * as written, so it is read as a built or filed box, but the amendment still cites the row.
 */
type ExpectedRoute = {
  tokens: string[];
  tec: TecRoute | undefined;
  joinedTec?: TecRoute;
  built?: BuiltRoute;
  exitElement?: string;
  scope?: BuildScope;
  dropped?: string[];
  structureSids?: string[];
  repair?: RouteRepair;
};

/** A filed route with the elements that name nothing taken out, and how the gaps were closed. */
type RouteRepair = {
  tokens: string[];
  dropped: string[];
  runs: string[];
  connections: RouteConnection[];
};

/**
 * The filed route with every element that names nothing taken out and the gaps it leaves closed.
 *
 * The fixes either side of a dropped element are connected over the route-building rows, so the box
 * reads a route the flight can be cleared on: `MOGEE BVLQ124 BVL` becomes `MOGEE Q124 BVL`. Where no
 * chain connects them, or the element was filed with no fix on one side of it, the element is simply
 * dropped and what is left joins direct. `runs` carries each stretch that was closed up as it now
 * reads, for the reason to name, and `connections` the rows it was closed up by, for the citations.
 *
 * @param tokens The route the box would otherwise carry.
 * @param airport The airport data, whose `routeConnections` hold the cheat sheet.
 * @returns The repair, or `undefined` where every element of the route names something.
 */
function repairMalformed(tokens: readonly string[], airport: AirportData): RouteRepair | undefined {
  const dropped = tokens.filter((token) => isMalformedToken(token));
  if (dropped.length === 0) return undefined;
  const repaired: string[] = [];
  const runs: string[] = [];
  const connections: RouteConnection[] = [];
  let gap = false;
  for (const token of tokens) {
    if (isMalformedToken(token)) {
      gap = true;
      continue;
    }
    const link = gap ? connectAcross(repaired.at(-1), token, airport) : undefined;
    if (link !== undefined) runs.push(link.run);
    repaired.push(...(link?.chain ?? []), token);
    connections.push(...(link?.connections ?? []));
    gap = false;
  }
  return { tokens: repaired, dropped, runs, connections };
}

/** One gap closed up: the fixes written in, the rows they were found by, and how the run reads. */
type RepairedGap = FixChain & { run: string };

/**
 * Closes the gap a dropped element left, between the fix before it and the fix after it.
 *
 * @param before The last fix the box still carries before the gap, absent where the dropped element
 *   was filed first and there is no fix on that side of it.
 * @param after The first fix the box carries after the gap.
 * @param airport The airport data, whose `routeConnections` hold the cheat sheet.
 * @returns The fixes and rows that carry the route across, with the run as it now reads, or
 *   `undefined` where there is no fix before the gap to connect from.
 */
function connectAcross(
  before: string | undefined,
  after: string,
  airport: AirportData,
): RepairedGap | undefined {
  if (before === undefined) return undefined;
  const link = connectFixes(before, after, airport) ?? { chain: [], connections: [] };
  return { ...link, run: [before, ...link.chain, after].join(' ') };
}

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
  const repair = repairMalformed(parsed.tokens, airport);
  const tokens = repair?.tokens ?? parsed.tokens;
  const direction = flightDirection(parsed, airport);
  const candidates = unservedSids(ctx, parsed.exitElement, direction, scenario, airport);
  const built = buildRoute(tokens, candidates, scope, airport);
  if (built === undefined) return undefined;
  return {
    tokens: withVectorNavaid(builtTokens(built, tokens), airport),
    tec: undefined,
    built,
    exitElement: parsed.exitElement,
    scope,
    dropped: parsed.droppedStructureTokens ?? [],
    ...(parsed.structureSids === undefined ? {} : { structureSids: parsed.structureSids }),
    ...(repair === undefined ? {} : { repair }),
  };
}

/** What the filed route names before the departure's own structure is read past. */
type StructureDrop = { dropped: string[]; exitElement: string; structureSids?: string[] };

/**
 * The fixes of the filed route the departure itself already flies over, and what it is read from.
 *
 * @param scenario The filed flight plan.
 * @param airport The airport data, whose SIDs carry the structure and the transitions.
 * @returns The dropped fixes, empty where the route names none, the SIDs whose structure they lie
 *   on, and the element after them.
 */
function structureDrop(scenario: Scenario, airport: AirportData): StructureDrop {
  const parsed = parseFiledRoute(scenario.filedRoute, airport);
  if (isUnresolved(parsed)) return { dropped: [], exitElement: '' };
  return {
    dropped: parsed.droppedStructureTokens ?? [],
    exitElement: parsed.exitElement,
    ...(parsed.structureSids === undefined ? {} : { structureSids: parsed.structureSids }),
  };
}

/**
 * The filed tail with the fixes the departure already flies over taken out of it.
 *
 * The tail is the route box as filed, so it may still carry the airport's own navaid the exit-fix
 * reading skips; the dropped fixes are taken out where they sit rather than off the front.
 *
 * @param tail The route the pilot filed after any procedure token.
 * @param dropped The fixes the structure walk dropped, in the order the route files them.
 * @returns The tail without them, unchanged when the tail does not carry them in that order.
 */
function withoutStructure(tail: readonly string[], dropped: readonly string[]): string[] {
  if (dropped.length === 0) return [...tail];
  const start = tail.findIndex((token) => token === dropped[0]);
  if (start < 0) return [...tail];
  const run = tail.slice(start, start + dropped.length);
  if (run.join(' ') !== dropped.join(' ')) return [...tail];
  return [...tail.slice(0, start), ...tail.slice(start + dropped.length)];
}

/**
 * The box a flight keeps the procedure the SOP assigns and the tail it filed on.
 *
 * The tail is read past the fixes the departure itself flies over, and any element of it that names
 * nothing is taken out with the gap closed up, so the box reads a route the flight can be cleared on.
 *
 * @param filed The route box as filed, split on a leading procedure token.
 * @param scenario The filed flight plan.
 * @param assigned The identifier of the procedure the SOP assigns the flight.
 * @param airport The airport data.
 * @returns The box as it should read, with what was dropped from it and why.
 */
function filedExpectation(
  filed: FiledRoute,
  scenario: Scenario,
  assigned: string,
  airport: AirportData,
): ExpectedRoute {
  const { dropped, exitElement, structureSids } = structureDrop(scenario, airport);
  const tail = withoutStructure(filed.tail, dropped);
  const read = tail.length === filed.tail.length ? [] : dropped;
  const repair = repairMalformed(tail, airport);
  return {
    tokens: withVectorNavaid([assigned, ...(repair?.tokens ?? tail)], airport),
    tec: undefined,
    dropped: read,
    ...(read.length === 0 || structureSids === undefined ? {} : { structureSids }),
    exitElement,
    ...(repair === undefined ? {} : { repair }),
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
 * The TEC route as the box reads it behind a heading, its departure family dropped.
 *
 * A noise-abatement heading or a notice's heading replaces the family a row begins on, and the route
 * follows the heading the way a row issued on an initial heading reads.
 *
 * @param tec The TEC row that routes the flight.
 * @param airport The airport data, whose `sids` carry the versions in force this cycle.
 * @returns The route as tokens without a departure, or `Unresolved` where the row names a family the
 *   airport no longer publishes.
 */
function tecTail(tec: TecRoute, airport: AirportData): string[] | Unresolved {
  const tokens = tecTokens(tec, airport);
  if (isUnresolved(tokens) || tecHead(tec).kind !== 'family') return tokens;
  return tokens.slice(1);
}

/**
 * The box of a flight a noise-abatement row issues another SID than its TEC route begins on.
 *
 * The box is built as though the flight had filed that SID and the TEC route after its departure,
 * scoped to the SID's own family, so the route builder joins the two as it joins any SID to a
 * filed route; failing a build, the box is the SID followed by that tail.
 *
 * @param tail The TEC route without its departure.
 * @param scenario The filed flight plan.
 * @param ctx The classified flight.
 * @param assigned The SID the noise-abatement row issues.
 * @param airport The airport data.
 * @returns The box as it should read.
 */
function joinedExpectation(
  tail: readonly string[],
  scenario: Scenario,
  ctx: Classification,
  assigned: Sid,
  airport: AirportData,
): ExpectedRoute {
  const plan: Scenario = { ...scenario, filedRoute: [assigned.id, ...tail].join(' ') };
  return (
    builtExpectation(plan, ctx, airport, { kind: 'filed', family: assigned.family }) ??
    filedExpectation(splitFiled(plan.filedRoute), plan, assigned.id, airport)
  );
}

/**
 * The route box as it should read: the TEC route for a TRACON destination, else the route built on
 * the assigned procedure, else that procedure followed by the tail the pilot filed.
 *
 * The TEC route is the one that routes the flight. Where it begins on the departure the flight is
 * issued, or on none, the box is the route as written; where a noise-abatement row issues a SID in
 * place of the family or the initial heading the route begins on, the box is that SID joined onto
 * the route after its departure.
 */
function expectedRoute(
  filed: FiledRoute,
  scenario: Scenario,
  ctx: Classification,
  assigned: string,
  airport: AirportData,
): ExpectedRoute | Unresolved {
  const tec = usableTecRoute(ctx, scenario, airport);
  if (tec === undefined) {
    return (
      builtExpectation(scenario, ctx, airport, filedScope(filed)) ??
      filedExpectation(filed, scenario, assigned, airport)
    );
  }
  const tokens = tecTokens(tec, airport);
  if (isUnresolved(tokens)) return tokens;
  const head = tecHead(tec);
  const sid = airport.sids.find((entry) => entry.id === assigned);
  if (sid !== undefined && head.kind === 'heading') {
    return { ...joinedExpectation(tokens, scenario, ctx, sid, airport), joinedTec: tec };
  }
  if (sid !== undefined && head.kind === 'family' && sid.family !== head.family) {
    return { ...joinedExpectation(tokens.slice(1), scenario, ctx, sid, airport), joinedTec: tec };
  }
  return { tokens: withVectorNavaid(tokens, airport), tec };
}

/**
 * The TEC row's citation for a route amendment, unless the amendment already cites it.
 *
 * A flight issued its TEC route's departure carries the row among the procedure's citations, which
 * the amendment cites first; the row is then cited once.
 *
 * @param tec The TEC row the box was read from, where one was.
 * @param cited The citations the amendment already carries.
 * @returns The citation, or none where there is no row or the amendment already cites it.
 */
function tecCitations(tec: TecRoute | undefined, cited: readonly RuleCitation[]): RuleCitation[] {
  if (tec === undefined) return [];
  if (cited.some((citation) => citation.id === tec.id)) return [];
  return [citeTec(tec)];
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
 * How a built reason closes, which is what the build did with the procedure the pilot filed.
 *
 * On the heading path the SOP assigns no procedure at all, so the build issues one where the flight
 * would otherwise have been vectored. On the procedure path the build keeps the filed SID where the
 * filed family is the one built on; where the SOP's table puts another row above that family, the
 * build takes that row's SID instead, and the closing says so rather than claim a SID was kept.
 */
function builtClosing(built: BuiltRoute, scope: BuildScope | undefined): string {
  if (scope?.kind === 'any') return 'so the SID is issued in place of the heading';
  if (scope?.kind === 'filed' && scope.family !== undefined && scope.family !== built.sid.family) {
    return `so it replaces the filed ${scope.family} departure`;
  }
  return 'so the SID is kept';
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
function builtCore(
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
    `and ${links} (route building), ${builtClosing(built, expected.scope)}`
  );
}

/**
 * The reason a built box reads as it does: why it was built, and what it was read past to build it.
 *
 * A build that starts from a fix further along the filed route is reading past structure, so the
 * reason closes by naming the fixes it read past and the SID they lie on; the box proposes the SID
 * the build settled on, which is the procedure that clause names where it carries that structure.
 *
 * @param built The route the cheat sheet built, with the SID and the rows it was built from.
 * @param expected The box as it should read, carrying what the structure walk dropped.
 * @param scenario The filed flight plan.
 * @param ctx The classified flight.
 * @returns The reason, written for the player.
 */
function builtReason(
  built: BuiltRoute,
  expected: ExpectedRoute,
  scenario: Scenario,
  ctx: Classification,
): string {
  const core = builtCore(built, expected, scenario, ctx);
  const structure = structureClause(expected, built.sid.id);
  return structure === undefined ? core : `${core}, and ${structure}`;
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
  const malformed = malformedClause(expected);
  const reason = builtReason(built, expected, scenario, ctx);
  const citations = [
    ...builtCitations(built, airport),
    ...structureCitations(expected, airport),
    ...repairCitations(expected, airport),
  ];
  return {
    box: 'route',
    proposed: expected.tokens.join(' '),
    reason: malformed === undefined ? reason : `${reason}, and ${malformed}`,
    citations: [...citations, ...tecCitations(expected.joinedTec, citations)],
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

/**
 * The clause that names the filed fixes the departure itself flies over, and what it is read from.
 *
 * Several departures out of the same airport can fly over the same fix to the same transition, so
 * the clause names the procedure the box is proposing wherever that one carries the structure, that
 * being the one the student is flying. Where it does not — a built box reads past the structure of a
 * departure the flight is not being given — the SID that does carry it is named instead, because
 * naming the proposed one would have the clause contradict the reason it closes, which says the
 * transition the route is read from is none of that procedure's.
 *
 * @param expected The box as it should read, carrying what the structure walk dropped and the SIDs
 *   it was dropped on.
 * @param proposed The identifier of the procedure the box proposes.
 * @returns The clause, or `undefined` where the route files no such fix.
 */
function structureClause(expected: ExpectedRoute, proposed: string): string | undefined {
  const dropped = expected.dropped ?? [];
  const sids = expected.structureSids ?? [];
  const sid = sids.includes(proposed) ? proposed : sids[0];
  if (dropped.length === 0 || sid === undefined) return undefined;
  return (
    `${listWords(dropped)} ${dropped.length === 1 ? 'lies' : 'lie'} on the ${sid} structure; ` +
    `the route is read from its published transition ${expected.exitElement ?? ''}`
  );
}

/**
 * The row a box read past the departure's own structure is cited to.
 *
 * @param expected The box as it should read, carrying what the structure walk dropped.
 * @param airport The airport data, whose `phraseologyRules` hold the quotable rows.
 * @returns The citation, empty where the filed route named no fix the departure already flies over.
 */
function structureCitations(expected: ExpectedRoute, airport: AirportData): RuleCitation[] {
  if ((expected.dropped ?? []).length === 0) return [];
  return citePhraseology(airport, 'R-SID-STRUCTURE');
}

/**
 * The rows a repaired box is cited to: the connections that closed each gap, then the rule itself.
 *
 * The connection rows are cited the way a built route cites them, they being the same cheat-sheet
 * rows read for the same reason; a gap nothing connected across cites the rule alone.
 *
 * @param expected The box as it should read, carrying the repair where one was made.
 * @param airport The airport data, whose `phraseologyRules` hold the quotable rows.
 * @returns The citations, empty where the filed route named nothing that had to be taken out.
 */
function repairCitations(expected: ExpectedRoute, airport: AirportData): RuleCitation[] {
  const repair = expected.repair;
  if (repair === undefined) return [];
  return [...connectionCitations(repair.connections), ...citePhraseology(airport, 'R-ROUTE-TOKEN')];
}

/**
 * The clause that names the filed elements that name nothing, and how the route was closed up.
 *
 * @param expected The box as it should read, carrying the repair where one was made.
 * @returns The clause, or `undefined` where every element of the filed route names something.
 */
function malformedClause(expected: ExpectedRoute): string | undefined {
  const repair = expected.repair;
  if (repair === undefined) return undefined;
  const { dropped, runs } = repair;
  const names = `${listWords(dropped)} name${dropped.length === 1 ? 's' : ''} no fix, navaid, airway or procedure`;
  if (runs.length === 0) {
    return `${names}; ${dropped.length === 1 ? 'it is' : 'they are'} taken out of the route`;
  }
  return `${names}; the route is connected ${runs.join(', ')}`;
}

/**
 * Which of the cases a route box with no built route is wrong for, written for the player.
 *
 * A box that files the assigned procedure and nothing else wrong but the fixes that procedure
 * already flies over, or an element that names nothing at all, is amended for those alone; where the
 * procedure is wrong or missing too, the clause that says so comes first and the others close the
 * reason.
 */
function routeReason(
  filed: FiledRoute,
  expected: ExpectedRoute,
  scenario: Scenario,
  ctx: Classification,
  assigned: string,
): string {
  if (expected.tec !== undefined) return tecReason(ctx, expected, scenario.destination);
  const clauses = [structureClause(expected, assigned), malformedClause(expected)].filter(
    (clause) => clause !== undefined,
  );
  if (clauses.length > 0 && filed.procedure === assigned) return clauses.join(', and ');
  const procedure =
    filed.procedure === undefined
      ? `the route files no departure procedure; the SOP assigns ${assigned} from ${scenario.departureRunway} in ${ctx.config.id}`
      : procedureReason(filed.procedure, assigned, scenario, ctx);
  return [procedure, ...clauses].join(', and ');
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
 * is amended down to that tail and a plan that files none is left alone; an element of that tail
 * that names nothing is taken out of it and the fixes either side connected, a flight on a heading
 * being vectored to a route it can fly like any other. A TEC route wins over both. A flight whose
 * TEC route begins on a departure family is on a heading only where a noise-abatement row or a
 * notice issued one in the family's place, and the box is the route with the family dropped; a row
 * that begins on an initial heading token is issued that heading, and its route, the token dropped,
 * is the box.
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
  const tec = usableTecRoute(ctx, scenario, airport);
  const build =
    tec === undefined ? builtExpectation(scenario, ctx, airport, { kind: 'any' }) : undefined;
  const repair = build === undefined ? repairMalformed(filed.tail, airport) : undefined;
  const resolved =
    tec === undefined ? (build?.tokens ?? repair?.tokens ?? filed.tail) : tecTail(tec, airport);
  if (isUnresolved(resolved)) return resolved;
  const expected: ExpectedRoute = {
    ...build,
    tokens: withVectorNavaid(resolved, airport),
    tec,
    ...(tec === undefined && repair !== undefined ? { repair } : {}),
  };
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
  const reason =
    tec === undefined
      ? headingReason(scenario, ctx, clearance)
      : tecReason(ctx, expected, scenario.destination);
  const malformed = malformedClause(expected);
  return {
    box: 'route',
    proposed: tokens.join(' '),
    reason: malformed === undefined ? reason : `${reason}, and ${malformed}`,
    citations: [
      ...clearance.procedure.citations,
      ...repairCitations(expected, airport),
      ...tecCitations(tec, clearance.procedure.citations),
    ],
  };
}

/**
 * Checks the route box of the strip against the procedure the SOP assigns and the routings the
 * letters of agreement demand.
 *
 * The box must read the assigned procedure, at the version in force this cycle, followed by the
 * tail the pilot filed; for a destination inside the TRACON it must read the published TEC route
 * instead, the first keyed row whose departure the flight can fly off its runway with its equipment.
 * Where a noise-abatement row or a notice clears such a flight on a heading, the box is the route
 * after its departure; where a noise-abatement row issues another SID, the box is that SID joined
 * onto the route after its departure. That one rule covers a plan filed with no
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
 * either way. An element of the filed route that names nothing at all — neither a fix, a navaid, an
 * airway nor a procedure — is taken out of the box and the fixes either side of it connected over the
 * route-building rows, so the box reads a route the flight can be cleared on.
 *
 * Whatever that leaves, a box whose destination is outside the TRACON goes through the arrival step
 * last: a flight bound for a field the common-arrivals sheet covers is put on an arrival its
 * equipment can fly, and a box that meets none of the fixes a letter of agreement demands is routed
 * onto one the letter names, in both cases at an entry fix the connections reach. A destination
 * inside the TRACON is left to the TEC table, which owns its routing, and a box that misses an LOA
 * routing no arrival is reachable for is reported as the gap it leaves.
 *
 * A route the flight's own equipment cannot fly is the one box no proposal answers: a Q route, or a
 * fix published as an RNAV waypoint, is filed by an RNAV-capable aircraft and a T or Y route by a
 * GPS-equipped one, and the conventional airway structure that would replace them is not in the
 * data. Where the box a TEC row or the arrival step proposes carries none of those elements it
 * stands as any other proposal does; otherwise the box is reported unresolved, marked
 * `rnav_elements`: it is the one gap the amendment engine answers rather than fails on, by raising
 * the type box to a suffix that can fly what the route files.
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
  const lacking = lackingRnavElements(scenario, ctx, airport);
  const outcome = routeOutcome(scenario, ctx, clearance, airport);
  if (lacking.length === 0) return outcome;
  if (outcome !== undefined && !isUnresolved(outcome) && outcome.box === 'route') {
    const proposal = { ...scenario, filedRoute: outcome.proposed };
    if (lackingRnavElements(proposal, ctx, airport).length === 0) return outcome;
  }
  return { ...unresolved('BOX.route', rnavGapReason(lacking, scenario)), kind: 'rnav_elements' };
}

/** A list of things written the way a reason reads them out: `A`, `A and B`, `A, B and C`. */
function listWords(items: readonly string[]): string {
  const head = items.slice(0, -1).join(', ');
  const last = items[items.length - 1] ?? '';
  return head === '' ? last : `${head} and ${last}`;
}

/** What a reason calls the navigation an element takes, which is the GPS a T or Y route needs. */
function needWords(need: RnavNeed): string {
  return need === 'gnss' ? 'GPS' : 'RNAV';
}

/**
 * The reason the route box is unresolved: what the route needs, and that no route can be proposed.
 *
 * @param lacking The elements of the filed route the flight's suffix cannot fly.
 * @param scenario The plan as the type box's suffix check leaves it.
 * @returns The reason, written for the player and for a data-gap report.
 */
function rnavGapReason(lacking: readonly RnavElement[], scenario: Scenario): string {
  const { equipmentSuffix } = scenario;
  const flight =
    equipmentSuffix === null ? 'a flight with no suffix filed' : `a ${equipmentSuffix} flight`;
  const needs: RnavNeed[] = ['rnav', 'gnss'];
  const clauses = needs.flatMap((need) => {
    const tokens = lacking.filter((element) => element.needs === need).map((el) => el.token);
    if (tokens.length === 0) return [];
    const verb = tokens.length === 1 ? 'needs' : 'need';
    return [`${listWords(tokens)} ${verb} ${needWords(need)} ${flight} does not carry`];
  });
  return `${clauses.join(', and ')}, and the data holds no conventional route to propose`;
}

/**
 * The route box the SOP, the TEC table and the arrival sheet ask for, before the flight's own
 * equipment is held against it.
 *
 * @param scenario The filed flight plan.
 * @param ctx The classified flight, which keys the TEC route rows.
 * @param clearance The clearance the engine resolved for the plan.
 * @param airport The airport data.
 * @returns The amendment for the route box, `undefined` when the box reads right, or `Unresolved`
 *   when the data cannot say what the box should read.
 */
function routeOutcome(
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
      ...structureCitations(expected, airport),
      ...repairCitations(expected, airport),
      ...tecCitations(expected.tec ?? expected.joinedTec, clearance.procedure.citations),
    ],
  };
}
