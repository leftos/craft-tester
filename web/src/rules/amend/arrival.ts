import type {
  AirportData,
  Arrival,
  CommonArrival,
  Destination,
  LoaRule,
  RouteConnection,
  Scenario,
  Sid,
} from '@/data/schema.ts';
import type { LoaRouting } from '@/rules/amend/route.ts';
import {
  destinationRow,
  flightWords,
  loaRouteGapOf,
  loaRouteRows,
  unmetRouteRow,
  withVectorNavaid,
} from '@/rules/amend/route.ts';
import type { ResolvedAmendment } from '@/rules/amend/types.ts';
import { citePhraseology, toCitation } from '@/rules/cite.ts';
import type { Classification } from '@/rules/classify.ts';
import { flightDirection, isAirwayToken, parseFiledRoute } from '@/rules/route.ts';
import type { ArrivalRoute, ArrivalSource, ArrivalTarget } from '@/rules/routeBuild.ts';
import { buildToArrival, startsOf } from '@/rules/routeBuild.ts';
import { airlineOf } from '@/rules/runway.ts';
import type { UnservedSid } from '@/rules/sidSelection.ts';
import { unservedSids } from '@/rules/sidSelection.ts';
import type { RuleCitation, Unresolved } from '@/rules/types.ts';
import { isUnresolved, unresolved } from '@/rules/unresolved.ts';

/** An arrival token: the family, and the revision digit the AIRAC cycle bumps. */
const ARRIVAL_TOKEN = /^([A-Z]{3,5})(\d)$/;

/** The phraseology row that says a flight is routed onto an arrival its equipment can fly. */
const ARRIVAL_PHRASEOLOGY_ROW = 'R-ARRIVAL';

/** The phraseology row a box no longer cites once a procedure is issued in the heading's place. */
const HEADING_PHRASEOLOGY_ROW = 'R-HEADING';

/** How an unresolved box says nothing the flight can fly was within reach of what it filed. */
const NO_CLASS_REACH =
  "no arrival of the flight's class is reachable from the SID or the filed fixes";

/** The flight the arrival rules are read for, with the destination row they are read against. */
type ArrivalContext = {
  scenario: Scenario;
  ctx: Classification;
  airport: AirportData;
  destination: Destination | undefined;
};

/** The arrival a box files: the token, the arrival of that family, and where the token sits. */
type FiledArrival = { token: string; arrival: Arrival; index: number };

/** Why the box has to be put on another arrival: the wrong half of them, or a missed routing. */
type ArrivalTrigger = { kind: 'class'; filed: FiledArrival } | { kind: 'loa'; routing: LoaRouting };

/**
 * What a search made of the box: what it reached, how it got there, and what it is given.
 *
 * `direct` marks the fallback a flight on a radar-vector SID takes when nothing it filed connects
 * onward: it keeps the fixes it filed and carries on from the last of them to the entry fix.
 */
type ArrivalPlan = {
  tokens: string[];
  target: ArrivalTarget;
  connections: RouteConnection[];
  candidate?: UnservedSid;
  direct?: true;
};

/** The box the arrival step reads: its tokens, where its tail begins, and the last fix to leave at. */
type ArrivalBox = { tokens: readonly string[]; from: number; lastSource: number };

/** The SID the box begins on, where it begins on one the airport publishes. */
function headSid(tokens: readonly string[], airport: AirportData): Sid | undefined {
  const head = tokens[0];
  return head === undefined ? undefined : airport.sids.find((entry) => entry.id === head);
}

/** Whether a SID is flown on vectors, which is what puts the airport navaid in the box. */
function isVectorSid(sid: Sid): boolean {
  return sid.routePhrasing === 'radar_vectors_fix';
}

/** Where the tail of a box begins: after a procedure token, and after a vector SID's own navaid. */
function tailStart(tokens: readonly string[], airport: AirportData): number {
  const sid = headSid(tokens, airport);
  if (sid === undefined) return 0;
  return isVectorSid(sid) && tokens[1] === airport.airport.faa ? 2 : 1;
}

/**
 * The arrival the box files: the last procedure token naming a family the destination publishes.
 *
 * A tail that ends on a plain fix files no arrival at all, and neither does one whose last
 * procedure token belongs to some other field; the published arrival travels with the token
 * because the token may name a revision the cycle has since bumped.
 */
function filedArrival(
  tokens: readonly string[],
  from: number,
  destination: Destination | undefined,
): FiledArrival | undefined {
  if (destination === undefined) return undefined;
  for (let index = tokens.length - 1; index >= from; index -= 1) {
    const token = tokens[index] ?? '';
    const family = ARRIVAL_TOKEN.exec(token)?.[1];
    const arrival =
      family === undefined ? undefined : destination.arrivals.find((row) => row.family === family);
    if (arrival !== undefined) return { token, arrival, index };
  }
  return undefined;
}

/**
 * Why the box needs changing: the wrong half of the arrivals, or a routing no fix of which is filed.
 *
 * The equipment comes first, an arrival the flight cannot fly being the one fault no letter of
 * agreement outranks, but it is only a fault where the common-arrivals sheet lists the destination:
 * that sheet is the standing agreement over which arrivals this airport feeds a field by, and
 * nowhere else does the data know enough to say the pilot picked the wrong one. The routing rows
 * come next, because a box that meets none of them has to be moved whatever it files; a token that
 * names last cycle's revision is no fault at all, the arrival being the same procedure either way.
 */
function arrivalTrigger(
  tokens: readonly string[],
  filed: FiledArrival | undefined,
  context: ArrivalContext,
): ArrivalTrigger | undefined {
  const { scenario, ctx, airport, destination } = context;
  const listed = destinationRows(context).length > 0;
  if (filed !== undefined && filed.arrival.rnav !== ctx.rnavCapable && listed) {
    return { kind: 'class', filed };
  }
  const tail = tokens.slice(tailStart(tokens, airport));
  const routing = unmetRouteRow(tail, ctx, scenario.destination, airport, destination);
  return routing === undefined ? undefined : { kind: 'loa', routing };
}

/** Whether the callsign is one of the all-cargo airlines the sheet's cargo cells are written for. */
function isCargoFlight(scenario: Scenario, airport: AirportData): boolean {
  const airline = airlineOf(scenario.callsign);
  return airline !== undefined && airport.routeLibrary.cargoAirlines.includes(airline);
}

/** Whether a cell of the common-arrivals sheet is written for this flight. */
function rowCovers(row: CommonArrival, ctx: Classification, cargo: boolean): boolean {
  if (row.classes !== undefined && !row.classes.includes(ctx.aircraftClass)) return false;
  return row.cargo !== true || cargo;
}

/** Every cell of the sheet written for the destination, whether or not it covers this flight. */
function destinationRows(context: ArrivalContext): CommonArrival[] {
  return context.airport.commonArrivals.filter((row) =>
    row.destinations.includes(context.scenario.destination),
  );
}

/** The cells of the sheet written for the destination that cover this flight, in sheet order. */
function commonRows(context: ArrivalContext): CommonArrival[] {
  const cargo = isCargoFlight(context.scenario, context.airport);
  return destinationRows(context).filter((row) => rowCovers(row, context.ctx, cargo));
}

/**
 * The arrivals of the destination this flight may be put on.
 *
 * The equipment decides the half: an RNAV-capable flight is put on an RNAV arrival and a
 * conventional one on a conventional arrival. An arrival the sheet writes for other classes, or
 * reserves for cargo, is out for a flight that is neither, even where the field publishes it; one
 * the sheet does not list at all stays, the sheet naming the common cases rather than every
 * arrival a field has.
 */
function flightArrivals(context: ArrivalContext): Arrival[] {
  const { ctx, scenario, airport, destination } = context;
  if (destination === undefined) return [];
  const cargo = isCargoFlight(scenario, airport);
  const rows = destinationRows(context);
  return destination.arrivals.filter((arrival) => {
    if (arrival.rnav !== ctx.rnavCapable) return false;
    const listed = rows.filter((row) => row.family === arrival.family);
    return listed.length === 0 || listed.some((row) => rowCovers(row, ctx, cargo));
  });
}

/**
 * The entry fixes the common-arrivals sheet offers, either the ones it names or the rest.
 *
 * @param rows The sheet cells written for the destination and this flight, in sheet order.
 * @param arrivals The arrivals the flight may be put on.
 * @param named Whether to take the fixes the cell itself names, or the arrival's other fixes.
 * @returns One target per cell and fix, in the sheet's order and then the chart's.
 */
function sheetTargets(
  rows: readonly CommonArrival[],
  arrivals: readonly Arrival[],
  named: boolean,
): ArrivalTarget[] {
  return rows.flatMap((row) => {
    const arrival = arrivals.find((entry) => entry.family === row.family);
    if (arrival === undefined) return [];
    const fixes = named
      ? row.transitions.filter((fix) => arrival.transitions.includes(fix))
      : arrival.transitions;
    return fixes.map((transition) => ({ transition, arrival, common: row }));
  });
}

/** The entry fixes a letter of agreement names for the destination, with the row that names them. */
function loaTargets(arrivals: readonly Arrival[], context: ArrivalContext): ArrivalTarget[] {
  const { ctx, scenario, airport, destination } = context;
  const rows = loaRouteRows(ctx, scenario.destination, airport, destination);
  return arrivals.flatMap((arrival) =>
    arrival.transitions.flatMap((transition) => {
      const routing = rows.find((entry) => entry.tokens.includes(transition));
      return routing === undefined ? [] : [{ transition, arrival, loa: routing.row }];
    }),
  );
}

/** Every entry fix the charts publish for the arrivals the flight may be put on. */
function chartTargets(arrivals: readonly Arrival[]): ArrivalTarget[] {
  return arrivals.flatMap((arrival) =>
    arrival.transitions.map((transition) => ({ transition, arrival })),
  );
}

/** The targets with each arrival and entry fix kept once, the first mention of it winning. */
function dedupeTargets(targets: readonly ArrivalTarget[]): ArrivalTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.arrival.id} ${target.transition}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Every place the flight may be put onto an arrival, in the order the rules prefer them.
 *
 * The common-arrivals sheet speaks first, at the entry fixes it names and then at the arrival's
 * other published fixes, because the sheet is the standing agreement between the two centres for
 * exactly this flight. The letters of agreement come next, naming fixes for a destination the
 * sheet does not cover; last come the fixes the charts publish and nothing else speaks for.
 *
 * @param context The flight and the destination the arrivals are read for.
 * @returns The targets in preference order, each arrival and fix appearing once.
 */
function arrivalTargets(context: ArrivalContext): ArrivalTarget[] {
  const arrivals = flightArrivals(context);
  const rows = commonRows(context);
  return dedupeTargets([
    ...sheetTargets(rows, arrivals, true),
    ...sheetTargets(rows, arrivals, false),
    ...loaTargets(arrivals, context),
    ...chartTargets(arrivals),
  ]);
}

/** The fixes of a box a search may leave from: the filed fixes, latest first, airways skipped. */
function boxSources(tokens: readonly string[], from: number, to: number): ArrivalSource[] {
  const sources: ArrivalSource[] = [];
  for (let index = to; index >= from; index -= 1) {
    const fix = tokens[index];
    if (fix !== undefined && !isAirwayToken(fix)) sources.push({ kind: 'box', index, fix });
  }
  return sources;
}

/** The transitions and end fix of a SID as search sources, in the order the chart lists them. */
function sidSources(sid: Sid): ArrivalSource[] {
  return startsOf(sid).map((start) => ({ kind: 'sid', start }));
}

/** The last fix of the box a search may leave from: the one before the arrival it files. */
function lastSourceIndex(tokens: readonly string[], filed: FiledArrival | undefined): number {
  return (filed?.index ?? tokens.length) - 1;
}

/** A box with a fix written once where the route reaches the entry fix it already stands on. */
function collapse(tokens: readonly string[]): string[] {
  return tokens.filter((token, index) => token !== tokens[index - 1]);
}

/** What the box reads up to and including the fix the route left it at. */
function sourcePrefix(
  tokens: readonly string[],
  source: ArrivalSource,
  sid: Sid | undefined,
): string[] {
  if (source.kind === 'box') return tokens.slice(0, source.index + 1);
  return sid === undefined ? [source.start.fix] : [sid.id, source.start.fix];
}

/** The plan a found route makes: the rebuilt box, the arrival it enters, and the rows it crossed. */
function routePlan(box: ArrivalBox, route: ArrivalRoute, context: ArrivalContext): ArrivalPlan {
  const sid = headSid(box.tokens, context.airport);
  return {
    tokens: withVectorNavaid(
      collapse([
        ...sourcePrefix(box.tokens, route.source, sid),
        ...route.chain,
        route.target.transition,
        route.target.arrival.id,
      ]),
      context.airport,
    ),
    target: route.target,
    connections: route.connections,
  };
}

/**
 * The box a flight on a pilot-nav SID is put on the arrival by.
 *
 * The fixes it already filed come first, latest first, so the route changes as late as it can; the
 * SID's own transitions and end fix follow, which is the flight leaving the procedure somewhere
 * else instead and dropping the rest of what it filed.
 */
function procedurePlan(
  box: ArrivalBox,
  sid: Sid,
  targets: readonly ArrivalTarget[],
  context: ArrivalContext,
): ArrivalPlan | undefined {
  const sources = [...boxSources(box.tokens, box.from, box.lastSource), ...sidSources(sid)];
  const route = buildToArrival(sources, targets, context.airport);
  return route === undefined ? undefined : routePlan(box, route, context);
}

/**
 * The box a flight on a radar-vector SID is put on the arrival by.
 *
 * Such a SID publishes no route of its own, so the flight is taken off the fixes it filed where one
 * connects onward. Failing that it keeps every fix it filed and carries on from the last of them to
 * the entry fix, which is the fewest changes of all: the box the controller hands on still names the
 * gate the flight leaves the terminal by, and only the arrival end of it is rewritten.
 */
function vectorPlan(
  box: ArrivalBox,
  targets: readonly ArrivalTarget[],
  context: ArrivalContext,
): ArrivalPlan | undefined {
  const sources = boxSources(box.tokens, box.from, box.lastSource);
  const route = buildToArrival(sources, targets, context.airport);
  if (route !== undefined) return routePlan(box, route, context);
  const target = targets[0];
  if (target === undefined) return undefined;
  const filedFixes = box.tokens.slice(0, box.lastSource + 1);
  return {
    tokens: withVectorNavaid(
      collapse([...filedFixes, target.transition, target.arrival.id]),
      context.airport,
    ),
    target,
    connections: [],
    direct: true,
  };
}

/** The SIDs the assignment table passed over, which a flight on a heading may be issued instead. */
function candidateSids(context: ArrivalContext): UnservedSid[] {
  const { scenario, ctx, airport } = context;
  const parsed = parseFiledRoute(scenario.filedRoute, airport);
  if (isUnresolved(parsed)) return [];
  const direction = flightDirection(parsed, airport);
  return unservedSids(ctx, parsed.exitElement, direction, scenario, airport).filter(
    (candidate) => candidate.row.when?.forcedTransition === undefined,
  );
}

/**
 * The box a flight the SOP sends off on a heading is put on the arrival by.
 *
 * A SID the assignment table passed over is worth issuing where one of its starts reaches an entry
 * fix: the flight leaves on a procedure rather than a heading and is on its arrival from the start,
 * and the rows are read in table order so the SOP's own first answer wins. Failing every candidate
 * the flight keeps its heading and is routed from the fixes it filed.
 */
function headingPlan(
  box: ArrivalBox,
  targets: readonly ArrivalTarget[],
  context: ArrivalContext,
): ArrivalPlan | undefined {
  for (const candidate of candidateSids(context)) {
    const route = buildToArrival(sidSources(candidate.sid), targets, context.airport);
    if (route === undefined) continue;
    const prefix = sourcePrefix(box.tokens, route.source, candidate.sid);
    return {
      tokens: collapse([
        ...prefix,
        ...route.chain,
        route.target.transition,
        route.target.arrival.id,
      ]),
      target: route.target,
      connections: route.connections,
      candidate,
    };
  }
  const route = buildToArrival(boxSources(box.tokens, 0, box.lastSource), targets, context.airport);
  return route === undefined ? undefined : routePlan(box, route, context);
}

/** Which of the three searches the box calls for: a procedure, a vector SID, or a heading. */
function arrivalPlan(
  box: ArrivalBox,
  targets: readonly ArrivalTarget[],
  context: ArrivalContext,
): ArrivalPlan | undefined {
  const sid = headSid(box.tokens, context.airport);
  if (sid === undefined) return headingPlan(box, targets, context);
  if (isVectorSid(sid)) return vectorPlan(box, targets, context);
  return procedurePlan(box, sid, targets, context);
}

/** The fixes a routing row names, read as a list: `BURGL, TILLT, REBRG … EHF or LHS`. */
function fixList(tokens: readonly string[]): string {
  const last = tokens.at(-1) ?? '';
  return tokens.length < 2 ? last : `${tokens.slice(0, -1).join(', ')} or ${last}`;
}

/** How a reason names a field: the way a controller says it, which is the code without the K. */
function fieldWords(icao: string): string {
  return icao.length === 4 && icao.startsWith('K') ? icao.slice(1) : icao;
}

/**
 * How the sentence names a routing the box misses: the row, the field, and the fixes it names.
 *
 * The row's own text is left to the citation, which quotes it in full; the sentence names the row
 * and what it asks for, a letter's text running to a paragraph that would swamp the reason.
 */
function loaWords(routing: LoaRouting, icao: string): string {
  return (
    `${routing.row.id} routes ${fieldWords(icao)} via ${fixList(routing.tokens)} ` +
    `and the route names none of them`
  );
}

/** How the sentence names the fault: the wrong half of the arrivals, or a routing the box misses. */
function triggerWords(trigger: ArrivalTrigger, context: ArrivalContext): string {
  if (trigger.kind === 'loa') return loaWords(trigger.routing, context.scenario.destination);
  const { token, arrival } = trigger.filed;
  const kind = arrival.rnav ? 'an RNAV' : 'a conventional';
  const equipment = context.ctx.rnavCapable ? 'RNAV-capable' : 'non-RNAV';
  return `${token} is ${kind} arrival and the flight is ${equipment}`;
}

/** The row the sentence quotes for an entry fix: the sheet cell, or the letter of agreement. */
function targetRow(target: ArrivalTarget): CommonArrival | LoaRule | undefined {
  return target.common ?? target.loa;
}

/** How the sentence names the entry fix: the arrival it enters, and the row that names it. */
function entryWords(target: ArrivalTarget): string {
  const row = targetRow(target);
  const cite = row === undefined ? '' : ` (${row.id})`;
  return `${target.transition} is an entry fix of ${target.arrival.id}${cite}`;
}

/** How the sentence closes: what the flight is given, and the entry fix it is given it at. */
function closingWords(plan: ArrivalPlan): string {
  const { transition, arrival } = plan.target;
  if (plan.direct === true) return `so the flight continues to ${transition} for ${arrival.id}`;
  if (plan.candidate !== undefined)
    return `so the SID is issued onto ${arrival.id} via ${transition}`;
  return `so the route is built onto ${arrival.id} via ${transition}`;
}

/** The half of the sentence that says how the route reaches the arrival. */
function planWords(plan: ArrivalPlan, context: ArrivalContext): string {
  const { ctx, scenario } = context;
  const candidate = plan.candidate;
  const lead =
    candidate === undefined
      ? ''
      : `${candidate.sid.id} is the procedure ${candidate.row.id} assigns ${flightWords(ctx)} from ` +
        `${scenario.departureRunway} in ${ctx.config.id}, and `;
  const links = plan.connections
    .map((row) => `${row.from} ${row.connects} connects to ${row.to}`)
    .join(', ');
  const entry = entryWords(plan.target);
  const path = links === '' ? entry : `${links} (route building), and ${entry}`;
  return `${lead}${path}, ${closingWords(plan)}`;
}

/** The reason the box changed: the reason it already carried, where it had one, then the arrival's. */
function arrivalReason(
  plan: ArrivalPlan,
  trigger: ArrivalTrigger,
  outcome: ResolvedAmendment | undefined,
  context: ArrivalContext,
): string {
  const sentence = `${triggerWords(trigger, context)}; ${planWords(plan, context)}`;
  const before = outcome?.reason;
  return before === undefined ? sentence : `${before}; ${sentence}`;
}

/** The rows the arrival change itself is cited to: what named the entry fix, the chain, the rule. */
function arrivalCitations(plan: ArrivalPlan, airport: AirportData): RuleCitation[] {
  const row = targetRow(plan.target);
  return [
    ...(row === undefined ? [] : [toCitation(row)]),
    ...plan.connections.map(toCitation),
    ...citePhraseology(airport, ARRIVAL_PHRASEOLOGY_ROW),
  ];
}

/** The citations with each row kept once, the first mention of it winning. */
function dedupeCitations(citations: readonly RuleCitation[]): RuleCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    if (seen.has(citation.id)) return false;
    seen.add(citation.id);
    return true;
  });
}

/**
 * The rows the changed box is cited to.
 *
 * A SID issued in the heading's place is the row the box now reads first, and the rule that says a
 * clearance without a procedure is spoken as a heading no longer applies to it; on every other path
 * the rows that decided the box stand, and the arrival's rows follow them.
 */
function changedCitations(
  plan: ArrivalPlan,
  outcome: ResolvedAmendment | undefined,
  airport: AirportData,
): RuleCitation[] {
  const before = outcome?.citations ?? [];
  const candidate = plan.candidate;
  const head =
    candidate === undefined
      ? before
      : [
          toCitation(candidate.row),
          ...before.filter((citation) => citation.id !== HEADING_PHRASEOLOGY_ROW),
        ];
  return dedupeCitations([...head, ...arrivalCitations(plan, airport)]);
}

/** The amendment the arrival change makes, with the box as it would have read without it. */
function arrivalAmendment(
  before: readonly string[],
  plan: ArrivalPlan,
  trigger: ArrivalTrigger,
  outcome: ResolvedAmendment | undefined,
  context: ArrivalContext,
): ResolvedAmendment {
  return {
    box: 'route',
    proposed: plan.tokens.join(' '),
    reason: arrivalReason(plan, trigger, outcome, context),
    arrivalSwap: before.join(' '),
    citations: changedCitations(plan, outcome, context.airport),
  };
}

/**
 * Why no box can be proposed for a routing the letter of agreement demands and nothing reaches.
 *
 * The message the routing check writes is kept whole, which names the row, quotes its text and lists
 * the fixes it asks for, and says in addition that no arrival was reachable; a destination that
 * publishes no arrivals at all leaves that message exactly as the routing check wrote it.
 */
function unresolvedArrival(routing: LoaRouting, context: ArrivalContext): Unresolved {
  const gap = loaRouteGapOf(routing);
  const publishes = (context.destination?.arrivals.length ?? 0) > 0;
  return publishes ? unresolved('BOX.route', `${gap.reason}; ${NO_CLASS_REACH}`) : gap;
}

/**
 * Puts the route box on an arrival of the destination the flight's equipment can fly.
 *
 * Two faults reach the step. An arrival the flight cannot fly is one, but only for a field the
 * common-arrivals sheet lists: there the two centres have agreed which arrivals this airport feeds
 * the field by, so an RNAV-capable flight is put on an RNAV arrival and a conventional one on a
 * conventional arrival. Everywhere else the filed arrival stands, an arrival being the enroute
 * controller's to change and the data holding no agreement to read against. The other fault is a
 * box that names none of the fixes a letter of agreement routes the field by, which is moved onto
 * an arrival the letter names wherever the destination is. A revision the cycle has bumped is no
 * fault at all; where a swap does happen the box is written with the arrival in force this cycle.
 * A destination inside NorCal TRACON never reaches the step: the TEC table owns those routes whole,
 * and an arrival swapped into one would take the flight off the published route.
 *
 * The entry fix is the one the route-building connections reach, fewest changes first. The box is
 * read three ways: a flight on a pilot-nav SID leaves the route at one of the fixes it filed or at a
 * start of its procedure, a flight on a radar-vector SID is taken off a filed fix or keeps them all
 * and carries on from the last to the entry fix, and a flight the SOP sends off on a heading is
 * issued a SID the table passed over where one of its starts reaches an entry fix.
 *
 * The change is a nice-to-have, the enroute controller being free to change an arrival on the fly,
 * so the amendment carries `arrivalSwap`: the box as it would have read without it, which grading
 * gives half credit for. That is why the class fault reaching no arrival leaves the box as the other
 * checks wrote it rather than reporting it unresolved: only the routing a letter demands is worth
 * stopping the strip for.
 *
 * @param tokens The route box as the checks would otherwise propose it, or as it reads when right.
 * @param outcome The amendment those checks made, or `undefined` where the box reads right.
 * @param scenario The filed flight plan.
 * @param ctx The classified flight, whose equipment decides which arrivals it may be given.
 * @param airport The airport data.
 * @returns The amendment that puts the flight on the arrival, the outcome that stands where nothing
 *   changes, or `Unresolved` where a letter of agreement demands a routing nothing reaches.
 */
export function changeArrival(
  tokens: readonly string[],
  outcome: ResolvedAmendment | undefined,
  scenario: Scenario,
  ctx: Classification,
  airport: AirportData,
): ResolvedAmendment | undefined | Unresolved {
  const destination = destinationRow(airport, scenario.destination);
  if (destination?.nct === true) return outcome;
  const context: ArrivalContext = { scenario, ctx, airport, destination };
  const from = tailStart(tokens, airport);
  const filed = filedArrival(tokens, from, destination);
  const trigger = arrivalTrigger(tokens, filed, context);
  if (trigger === undefined) return outcome;
  const box: ArrivalBox = { tokens, from, lastSource: lastSourceIndex(tokens, filed) };
  const plan = arrivalPlan(box, arrivalTargets(context), context);
  if (plan === undefined) {
    return trigger.kind === 'loa' ? unresolvedArrival(trigger.routing, context) : outcome;
  }
  if (plan.tokens.join(' ') === tokens.join(' ')) return outcome;
  return arrivalAmendment(tokens, plan, trigger, outcome, context);
}
