import type {
  AirportData,
  Arrival,
  AssignmentRule,
  CommonArrival,
  LoaRule,
  RouteConnection,
  Sid,
} from '@/data/schema.ts';
import { citePhraseology, toCitation } from '@/rules/cite.ts';
import type { UnservedSid } from '@/rules/sidSelection.ts';
import type { RuleCitation } from '@/rules/types.ts';

/**
 * Where a built route leaves the SID: one of its published transitions, or the SID's own end fix.
 *
 * A pilot-nav SID hands the flight over at the fix it ends on whether or not the chart publishes
 * that fix as a transition, so the end fix is a place the flight can be routed from as much as a
 * transition is. The two are spoken differently — a transition is named as one, an end fix is read
 * bare under the chart's R-AS-FILED reading — so the start carries which of them it is.
 */
export type RouteStart = { fix: string; kind: 'transition' | 'base_fix' };

/**
 * The route that keeps the SID the SOP assigns, reached by a transition or by the SID's end fix.
 *
 * `chain` is the fixes strictly between the start fix and the filed token the route joins at, and
 * `joinIndex` is where that token sits in the filed route, so the rebuilt box reads the SID, the
 * start fix, the chain, and the filed route from the join onwards. `connections` is empty only for
 * a forced transition, which the assignment row itself names and no connection row decides.
 */
export type BuiltRoute = {
  sid: Sid;
  row: AssignmentRule;
  start: RouteStart;
  chain: string[];
  joinIndex: number;
  strength: 'always' | 'usually';
  connections: RouteConnection[];
};

/**
 * Which of the passed-over SIDs a build may keep the flight on.
 *
 * `filed` names the family the pilot filed, and only that family is built on: a flight the SOP is
 * giving a procedure to is not rerouted onto a chain of connecting fixes it never asked for (user
 * decision 2026-09-16), and a `family` of `undefined` is a plan that filed no procedure at all,
 * which nothing but a forced transition builds. `any` is the flight the SOP sends off on a heading,
 * where there is no procedure to keep and any assignable candidate may be connected to the filed
 * route instead.
 */
export type BuildScope = { kind: 'filed'; family: string | undefined } | { kind: 'any' };

/** One branch of a walk: where it started, and the fixes and rows it has crossed since. */
type Walk<S> = {
  start: S;
  fixes: string[];
  rows: RouteConnection[];
};

/** A branch that reached one of the targets, with the target it reached. */
type WalkHit<S> = { walk: Walk<S>; target: string };

/** A branch that reached the filed route, with the index of the token it reached. */
type Hit = {
  branch: Walk<RouteStart>;
  joinIndex: number;
};

/** The fix a branch has reached, which is the start fix itself until it crosses its first edge. */
function headOf<S extends { fix: string }>(branch: Walk<S>): string {
  return branch.fixes.at(-1) ?? branch.start.fix;
}

/**
 * Breadth-first search from every start at once to the nearest of the targets.
 *
 * The frontier holds the branches of equal length, so the first target reached is reached by the
 * fewest connections, and the frontier stays in the order the caller listed the starts, so a tie
 * goes to the start it named first. A fix already reached is not entered again: the first way to it
 * was at least as short. A branch has to cross at least one edge to count, so a start that is itself
 * a target is not a hit.
 *
 * @param starts Where the search may begin, in preference order; each carries the fix it stands at.
 * @param targets The fixes to reach.
 * @param edges The connection rows the search may cross.
 * @returns The shortest branch to a target, or undefined when none of the starts reaches one.
 */
function walkTo<S extends { fix: string }>(
  starts: readonly S[],
  targets: ReadonlySet<string>,
  edges: readonly RouteConnection[],
): WalkHit<S> | undefined {
  const reached = new Set(starts.map((start) => start.fix));
  let frontier: Walk<S>[] = starts.map((start) => ({ start, fixes: [], rows: [] }));
  while (frontier.length > 0) {
    const next: Walk<S>[] = [];
    for (const branch of frontier) {
      const head = headOf(branch);
      for (const edge of edges) {
        if (edge.from !== head || reached.has(edge.to)) continue;
        const grown = {
          start: branch.start,
          fixes: [...branch.fixes, edge.to],
          rows: [...branch.rows, edge],
        };
        if (targets.has(edge.to)) return { walk: grown, target: edge.to };
        reached.add(edge.to);
        next.push(grown);
      }
    }
    frontier = next;
  }
  return undefined;
}

/** The fixes and the rows that carry a route from one fix to another over the connection rows. */
export type FixChain = { chain: string[]; connections: RouteConnection[] };

/**
 * The route from one fix of a filed box to another over the cheat sheet's rows.
 *
 * The chains that always connect are searched first, so a route that never needs a controller's
 * judgement is preferred over one that usually works, and within either search the fewest
 * connections win — the same ordering a route built off a SID is searched by.
 *
 * @param from The fix the route leaves.
 * @param to The fix the route has to reach.
 * @param airport The airport data, whose `routeConnections` hold the cheat sheet.
 * @returns The fixes strictly between the two and the rows crossed, or undefined where no chain
 *   connects them.
 */
export function connectFixes(from: string, to: string, airport: AirportData): FixChain | undefined {
  const starts = [{ fix: from }];
  const targets = new Set([to]);
  const always = airport.routeConnections.filter((row) => row.connects === 'always');
  const hit = walkTo(starts, targets, always) ?? walkTo(starts, targets, airport.routeConnections);
  if (hit === undefined) return undefined;
  return { chain: hit.walk.fixes.slice(0, -1), connections: hit.walk.rows };
}

/**
 * The fixes a search may leave the SID at: the published transitions, then the SID's own end fix.
 *
 * The end fix comes last so that a transition reaching the filed route in as few connections wins
 * the tie, and it is left out when the chart publishes it as a transition too, where it is already
 * a starting point and is spoken as the transition it is.
 */
export function startsOf(sid: Sid): RouteStart[] {
  const starts: RouteStart[] = sid.transitions.map((transition) => ({
    fix: transition.fix,
    kind: 'transition',
  }));
  const base = sid.baseFix;
  if (base === undefined || starts.some((start) => start.fix === base)) return starts;
  return [...starts, { fix: base, kind: 'base_fix' }];
}

/**
 * The walk from every place the flight can leave the SID to the nearest filed token.
 *
 * The starts are in chart order with the SID's own end fix behind them, so a tie between two
 * branches of the same length goes to the transition the chart lists first and only then to the end
 * fix. A start that is itself further down the filed route is not a hit, the walk having to cross at
 * least one edge — that route flies the SID as filed and needs no building.
 *
 * @param sid The SID the SOP assigns, whose transitions and end fix are the starting points.
 * @param tokens The filed route from its exit element onwards.
 * @param edges The connection rows the search may cross.
 * @returns The shortest chain to the filed route, or undefined when none of them reaches it.
 */
function search(
  sid: Sid,
  tokens: readonly string[],
  edges: readonly RouteConnection[],
): Hit | undefined {
  const hit = walkTo(startsOf(sid), new Set(tokens), edges);
  if (hit === undefined) return undefined;
  return { branch: hit.walk, joinIndex: tokens.indexOf(hit.target) };
}

/** The route a row that names a forced transition builds, which needs no connection at all. */
function forcedRoute(candidate: UnservedSid, transition: string): BuiltRoute {
  return {
    sid: candidate.sid,
    row: candidate.row,
    start: { fix: transition, kind: 'transition' },
    chain: [],
    joinIndex: 0,
    strength: 'always',
    connections: [],
  };
}

/** The route one candidate's transitions or end fix can be connected to the filed route by, if any. */
function connectedRoute(
  candidate: UnservedSid,
  tokens: readonly string[],
  airport: AirportData,
): BuiltRoute | undefined {
  const always = airport.routeConnections.filter((row) => row.connects === 'always');
  const hit =
    search(candidate.sid, tokens, always) ??
    search(candidate.sid, tokens, airport.routeConnections);
  if (hit === undefined) return undefined;
  return {
    sid: candidate.sid,
    row: candidate.row,
    start: hit.branch.start,
    chain: hit.branch.fixes.slice(0, -1),
    joinIndex: hit.joinIndex,
    strength: hit.branch.rows.every((row) => row.connects === 'always') ? 'always' : 'usually',
    connections: hit.branch.rows,
  };
}

/**
 * How far down the candidate list the scope allows a connection search to be run.
 *
 * The candidates are in the SOP's table order, so a row above the filed family is what the table
 * gives the flight ahead of what it filed; a row below it is one the table only reaches because the
 * filed procedure was passed over. The filed family is therefore the floor: everything at or above
 * it may be built on, everything below it may not. A family the candidates do not hold at all puts
 * the floor nowhere, and nothing is built.
 *
 * @param candidates The SIDs of the applicable rows that do not reach the exit element, in order.
 * @param scope Which candidates may be built on.
 * @returns The last index a search may run at, `-1` where no candidate is in scope.
 */
function scopeLimit(candidates: readonly UnservedSid[], scope: BuildScope): number {
  if (scope.kind === 'any') return candidates.length - 1;
  return candidates.findIndex((candidate) => candidate.sid.family === scope.family);
}

/**
 * Builds the route that keeps a SID the SOP would assign, rather than falling back to the vector
 * SID or to a heading.
 *
 * The candidates are the rows `selectSid` passed over, in table order. A row that names a forced
 * transition is built on that transition alone — the SOP sends the flight over it whatever the
 * route files, so nothing about the filed procedure matters, and no scope narrows it. The
 * connection search is narrowed by `scope`: for a flight the SOP gives a procedure it runs down to
 * the family the pilot filed and no further, so a row the table puts above that family is built —
 * it is what the SOP gives the flight, and the filed procedure is not — while a row below it is
 * left alone, so a plan filed on the SOP's own preferred procedure is never rerouted onto a chain
 * of connecting fixes it never asked for (user decision 2026-09-16, extended 2026-09-17); for a
 * flight the SOP sends off on a heading there is no procedure to keep, so every candidate is
 * searched and the first in table order that connects wins. Either way a
 * candidate is built by connecting one of its published transitions, or the fix the SID itself ends
 * on, to the filed route over the cheat sheet's rows: the chains of fixes that always connect are
 * searched first, so a route that never needs a controller's judgement is preferred over one that
 * usually works, within either search the fewest connections win, and a tie between a transition
 * and the end fix goes to the transition.
 *
 * @param tokens The filed route from its exit element onwards.
 * @param candidates The SIDs of the applicable rows that do not reach the exit element, in order.
 * @param scope Which candidates may be built on: the filed family, or any of them on the heading path.
 * @param airport The airport data, whose `routeConnections` hold the cheat sheet.
 * @returns The route to give the flight, or undefined when no candidate reaches the filed route.
 */
export function buildRoute(
  tokens: readonly string[],
  candidates: readonly UnservedSid[],
  scope: BuildScope,
  airport: AirportData,
): BuiltRoute | undefined {
  const limit = scopeLimit(candidates, scope);
  for (const [index, candidate] of candidates.entries()) {
    const forced = candidate.row.when?.forcedTransition;
    if (forced !== undefined) return forcedRoute(candidate, forced);
    if (index > limit) continue;
    const built = connectedRoute(candidate, tokens, airport);
    if (built !== undefined) return built;
  }
  return undefined;
}

/**
 * The route box a built route reads: the SID, the start fix, the chain, then the filed route.
 *
 * The start fix is written into the box whether it is a transition or the SID's own end fix, both
 * being where the flight leaves the procedure.
 *
 * @param built The route the builder found.
 * @param tokens The filed route from its exit element onwards.
 * @returns The tokens of the rebuilt box.
 */
export function builtTokens(built: BuiltRoute, tokens: readonly string[]): string[] {
  return [built.sid.id, built.start.fix, ...built.chain, ...tokens.slice(built.joinIndex)];
}

/**
 * The rows a built route is cited to, in place of the ones the fallback clearance was decided by.
 *
 * The assignment row is the SOP's answer the build kept, and what follows it is how the route got
 * back to the filed one: the connection rows of the chain and the rule that says to build it, or,
 * for a forced transition, the rule that a transition is spoken with the procedure.
 *
 * @param built The route the builder found.
 * @param airport The airport data, whose `phraseologyRules` hold the quotable rows.
 * @returns The citations, the assignment row first.
 */
export function builtCitations(built: BuiltRoute, airport: AirportData): RuleCitation[] {
  if (built.connections.length === 0) {
    return [toCitation(built.row), ...citePhraseology(airport, 'R-TRANSITION')];
  }
  return [
    toCitation(built.row),
    ...connectionCitations(built.connections),
    ...citePhraseology(airport, 'R-ROUTE-BUILD'),
  ];
}

/**
 * The cheat-sheet rows a chain of connections was carried by, as citations.
 *
 * @param connections The rows the search crossed, in the order the route reads them.
 * @returns One citation per row.
 */
export function connectionCitations(connections: readonly RouteConnection[]): RuleCitation[] {
  return connections.map(toCitation);
}

/**
 * One place a flight may be put onto an arrival: an entry fix of a published arrival.
 *
 * `common` is the row of the common-arrivals table that names the arrival for this destination, and
 * `loa` the letter-of-agreement row that names the fix, where either does; a target the data names
 * neither way is an entry fix the chart publishes and nothing else speaks for.
 */
export type ArrivalTarget = {
  transition: string;
  arrival: Arrival;
  common?: CommonArrival;
  loa?: LoaRule;
};

/**
 * Somewhere a search for an arrival may start: a fix already in the route box, or a start of a SID.
 *
 * `index` is where the fix sits in the box, which is what the rebuilt box is cut at; a `sid` source
 * carries the transition or end fix the flight would leave the procedure at instead.
 */
export type ArrivalSource =
  | { kind: 'box'; index: number; fix: string }
  | { kind: 'sid'; start: RouteStart };

/** The route found onto an arrival: where it left, the fixes between, and what it reached. */
export type ArrivalRoute = {
  source: ArrivalSource;
  chain: string[];
  target: ArrivalTarget;
  strength: 'always' | 'usually';
  connections: RouteConnection[];
};

/** One branch of an arrival search: the source it left from and the fixes and rows it has crossed. */
type ArrivalBranch = {
  source: ArrivalSource;
  sourceIndex: number;
  fixes: string[];
  rows: RouteConnection[];
};

/** A branch that reached an arrival entry fix, with the index of the target it reached. */
type ArrivalHit = { branch: ArrivalBranch; targetIndex: number };

/** The fix a source stands at, whichever kind of source it is. */
function sourceFix(source: ArrivalSource): string {
  return source.kind === 'box' ? source.fix : source.start.fix;
}

/** The first target each entry fix answers, so a fix two arrivals share is read as the first one. */
function targetIndexes(targets: readonly ArrivalTarget[]): Map<string, number> {
  const indexes = new Map<string, number>();
  targets.forEach((target, index) => {
    if (!indexes.has(target.transition)) indexes.set(target.transition, index);
  });
  return indexes;
}

/** The hit to take of the ones found at one level: the earliest target, then the earliest source. */
function bestHit(hits: readonly ArrivalHit[]): ArrivalHit | undefined {
  return hits.reduce<ArrivalHit | undefined>((best, hit) => {
    if (best === undefined || hit.targetIndex < best.targetIndex) return hit;
    if (hit.targetIndex > best.targetIndex) return best;
    return hit.branch.sourceIndex < best.branch.sourceIndex ? hit : best;
  }, undefined);
}

/** The source that already stands on an entry fix, where one does: a route needing no connection. */
function directHit(
  sources: readonly ArrivalSource[],
  targets: readonly ArrivalTarget[],
): ArrivalHit | undefined {
  const indexes = targetIndexes(targets);
  const hits = sources.flatMap((source, sourceIndex) => {
    const targetIndex = indexes.get(sourceFix(source));
    if (targetIndex === undefined) return [];
    return [{ branch: { source, sourceIndex, fixes: [], rows: [] }, targetIndex }];
  });
  return bestHit(hits);
}

/**
 * Breadth-first search from every source at once to the nearest arrival entry fix.
 *
 * The frontier holds the branches of equal length, so a target reached here is reached by the fewest
 * connections; every hit of a level is collected rather than the first taken, because a level may
 * reach two entry fixes and the earlier target is the one the tables prefer. A fix already reached
 * is not entered again, and the frontier stays in source order, so the branch that first reaches a
 * fix is the one from the earliest source.
 *
 * @param sources Where the search may start, in preference order.
 * @param targets The entry fixes to reach, in preference order.
 * @param edges The connection rows the search may cross.
 * @returns The shortest branch to the best target of its level, or undefined when none reaches one.
 */
function arrivalSearch(
  sources: readonly ArrivalSource[],
  targets: readonly ArrivalTarget[],
  edges: readonly RouteConnection[],
): ArrivalHit | undefined {
  const indexes = targetIndexes(targets);
  const reached = new Set(sources.map(sourceFix));
  let frontier: ArrivalBranch[] = sources.map((source, sourceIndex) => ({
    source,
    sourceIndex,
    fixes: [],
    rows: [],
  }));
  while (frontier.length > 0) {
    const hits: ArrivalHit[] = [];
    const next: ArrivalBranch[] = [];
    for (const branch of frontier) {
      const head = branch.fixes.at(-1) ?? sourceFix(branch.source);
      for (const edge of edges) {
        if (edge.from !== head || reached.has(edge.to)) continue;
        reached.add(edge.to);
        const grown = {
          source: branch.source,
          sourceIndex: branch.sourceIndex,
          fixes: [...branch.fixes, edge.to],
          rows: [...branch.rows, edge],
        };
        const targetIndex = indexes.get(edge.to);
        if (targetIndex === undefined) next.push(grown);
        else hits.push({ branch: grown, targetIndex });
      }
    }
    const best = bestHit(hits);
    if (best !== undefined) return best;
    frontier = next;
  }
  return undefined;
}

/**
 * Builds the route from the places a flight can leave its filed box onto an arrival of its
 * destination.
 *
 * A source that already stands on an entry fix is the shortest route of all and is taken before any
 * connection is crossed. Failing that, the chains that always connect are searched first, so a route
 * that never needs a controller's judgement is preferred over one that usually works; within either
 * search the fewest connections win, a tie goes to the target the tables name first, and a tie on
 * that goes to the source the caller listed first.
 *
 * @param sources Where the search may start, in preference order.
 * @param targets The entry fixes to reach, in preference order.
 * @param airport The airport data, whose `routeConnections` hold the cheat sheet.
 * @returns The route onto the arrival, or undefined when no source reaches any target.
 */
export function buildToArrival(
  sources: readonly ArrivalSource[],
  targets: readonly ArrivalTarget[],
  airport: AirportData,
): ArrivalRoute | undefined {
  const always = airport.routeConnections.filter((row) => row.connects === 'always');
  const hit =
    directHit(sources, targets) ??
    arrivalSearch(sources, targets, always) ??
    arrivalSearch(sources, targets, airport.routeConnections);
  const target = hit === undefined ? undefined : targets[hit.targetIndex];
  if (hit === undefined || target === undefined) return undefined;
  return {
    source: hit.branch.source,
    chain: hit.branch.fixes.slice(0, -1),
    target,
    strength: hit.branch.rows.every((row) => row.connects === 'always') ? 'always' : 'usually',
    connections: hit.branch.rows,
  };
}
