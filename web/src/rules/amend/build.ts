import type { AirportData, AssignmentRule, RouteConnection, Sid } from '@/data/schema.ts';
import type { UnservedSid } from '@/rules/sidSelection.ts';

/**
 * The route that keeps the SID the SOP assigns, reached by one of its published transitions.
 *
 * `chain` is the fixes strictly between the transition and the filed token the route joins at, and
 * `joinIndex` is where that token sits in the filed route, so the rebuilt box reads the SID, the
 * transition, the chain, and the filed route from the join onwards. `connections` is empty only for
 * a forced transition, which the assignment row itself names and no connection row decides.
 */
export type BuiltRoute = {
  sid: Sid;
  row: AssignmentRule;
  transition: string;
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

/** One branch of the search: where it left the SID, and the fixes and rows it has crossed since. */
type Branch = {
  transition: string;
  fixes: string[];
  rows: RouteConnection[];
};

/** A branch that reached the filed route, with the index of the token it reached. */
type Hit = {
  branch: Branch;
  joinIndex: number;
};

/** The fix a branch has reached, which is the transition itself until it crosses its first edge. */
function headOf(branch: Branch): string {
  return branch.fixes.at(-1) ?? branch.transition;
}

/**
 * Breadth-first search from every transition of the SID to the nearest token of the filed route.
 *
 * The frontier holds the branches of equal length, so the first token reached is reached by the
 * fewest connections, and within a length the branches are in chart order, so a tie goes to the
 * transition the chart lists first. A fix already reached is not entered again: the first way to it
 * was at least as short. A branch has to cross at least one edge to count, so a transition that is
 * itself further down the filed route is not a hit — that route flies the SID as filed and needs no
 * building.
 *
 * @param sid The SID the SOP assigns, whose transitions are the starting points.
 * @param tokens The filed route from its exit element onwards.
 * @param edges The connection rows the search may cross.
 * @returns The shortest chain to the filed route, or undefined when none of them reaches it.
 */
function search(
  sid: Sid,
  tokens: readonly string[],
  edges: readonly RouteConnection[],
): Hit | undefined {
  const targets = new Set(tokens);
  const reached = new Set(sid.transitions.map((transition) => transition.fix));
  let frontier: Branch[] = sid.transitions.map((transition) => ({
    transition: transition.fix,
    fixes: [],
    rows: [],
  }));
  while (frontier.length > 0) {
    const next: Branch[] = [];
    for (const branch of frontier) {
      const head = headOf(branch);
      for (const edge of edges) {
        if (edge.from !== head || reached.has(edge.to)) continue;
        const grown = {
          transition: branch.transition,
          fixes: [...branch.fixes, edge.to],
          rows: [...branch.rows, edge],
        };
        if (targets.has(edge.to)) return { branch: grown, joinIndex: tokens.indexOf(edge.to) };
        reached.add(edge.to);
        next.push(grown);
      }
    }
    frontier = next;
  }
  return undefined;
}

/** The route a row that names a forced transition builds, which needs no connection at all. */
function forcedRoute(candidate: UnservedSid, transition: string): BuiltRoute {
  return {
    sid: candidate.sid,
    row: candidate.row,
    transition,
    chain: [],
    joinIndex: 0,
    strength: 'always',
    connections: [],
  };
}

/** The route one candidate's transitions can be connected to the filed route by, if any. */
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
    transition: hit.branch.transition,
    chain: hit.branch.fixes.slice(0, -1),
    joinIndex: hit.joinIndex,
    strength: hit.branch.rows.every((row) => row.connects === 'always') ? 'always' : 'usually',
    connections: hit.branch.rows,
  };
}

/** Whether a candidate is one the scope allows a connection search to be run from. */
function inScope(candidate: UnservedSid, scope: BuildScope): boolean {
  return scope.kind === 'any' || candidate.sid.family === scope.family;
}

/**
 * Builds the route that keeps a SID the SOP would assign, rather than falling back to the vector
 * SID or to a heading.
 *
 * The candidates are the rows `selectSid` passed over, in table order. A row that names a forced
 * transition is built on that transition alone — the SOP sends the flight over it whatever the
 * route files, so nothing about the filed procedure matters, and no scope narrows it. The
 * connection search is narrowed by `scope`: for a flight the SOP gives a procedure it only keeps
 * the family the pilot filed, so a plan filed without one, or filed on the procedure the flight is
 * being given anyway, is not rerouted onto a chain of connecting fixes it never asked for (user
 * decision 2026-09-16); for a flight the SOP sends off on a heading there is no procedure to keep,
 * so every candidate is searched and the first in table order that connects wins. Either way a
 * candidate is built by connecting one of its published transitions to the filed route over the
 * cheat sheet's rows: the chains of fixes that always connect are searched first, so a route that
 * never needs a controller's judgement is preferred over one that usually works, and within either
 * search the fewest connections win.
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
  for (const candidate of candidates) {
    const forced = candidate.row.when?.forcedTransition;
    if (forced !== undefined) return forcedRoute(candidate, forced);
    if (!inScope(candidate, scope)) continue;
    const built = connectedRoute(candidate, tokens, airport);
    if (built !== undefined) return built;
  }
  return undefined;
}

/**
 * The route box a built route reads: the SID, the transition, the chain, then the filed route.
 *
 * @param built The route the builder found.
 * @param tokens The filed route from its exit element onwards.
 * @returns The tokens of the rebuilt box.
 */
export function builtTokens(built: BuiltRoute, tokens: readonly string[]): string[] {
  return [built.sid.id, built.transition, ...built.chain, ...tokens.slice(built.joinIndex)];
}
