import type { AirportData, AssignmentRule, Direction, Scenario } from '@/data/schema.ts';
import { resolveAltitude } from '@/rules/altitude.ts';
import { citePhraseology, citeTec, toCitation } from '@/rules/cite.ts';
import type { Classification } from '@/rules/classify.ts';
import { classify } from '@/rules/classify.ts';
import { resolveFrequency } from '@/rules/frequency.ts';
import type { ParsedRoute } from '@/rules/route.ts';
import { flightDirection, parseFiledRoute } from '@/rules/route.ts';
import type { BuiltRoute } from '@/rules/routeBuild.ts';
import { buildRoute, builtCitations, builtTokens } from '@/rules/routeBuild.ts';
import { phraseRoute, phraseVectorsDirect } from '@/rules/routePhrasing.ts';
import { explainRunway } from '@/rules/runway.ts';
import type { SidSelection } from '@/rules/sidSelection.ts';
import { selectSid, unservedSids } from '@/rules/sidSelection.ts';
import { tecHead, tecTokens, usableTecRoute } from '@/rules/tecRoutes.ts';
import type {
  EngineResult,
  ResolvedRoute,
  RuleCitation,
  SelectedProcedure,
  Unresolved,
} from '@/rules/types.ts';
import { procedureOf } from '@/rules/types.ts';
import { isUnresolved, unresolved } from '@/rules/unresolved.ts';

/** Wraps one blocked element as the engine's failure result. */
function blocked(reason: Unresolved): EngineResult {
  return { ok: false, unresolved: [reason] };
}

/** The element a route leaves the terminal on and the gate direction that places it. */
type TableRoute = { exitElement: string; direction: Direction | undefined };

/**
 * The exit element and gate direction the assignment table and the noise-abatement rows are read
 * against.
 *
 * A flight whose TEC route begins on a departure family or an initial heading flies that route, not
 * the one it filed, so the SOP reads the route's own exit and direction, read the way a filed route is
 * read. That keeps a plan and the same plan corrected onto its TEC route on one row. Any other flight
 * is read on the route it filed. A TEC route with nothing after its departure to leave the terminal
 * on blocks the route element, as a filed route with none does.
 *
 * @param ctx The classified flight.
 * @param filed The filed route, parsed.
 * @param scenario The filed flight plan.
 * @param airport The airport data.
 * @returns The exit element and direction to read the table against, or `Unresolved` where the TEC
 *   route names a family the airport no longer publishes or names no fix to leave on.
 */
function tableRoute(
  ctx: Classification,
  filed: ParsedRoute,
  scenario: Scenario,
  airport: AirportData,
): TableRoute | Unresolved {
  const tec = usableTecRoute(ctx, scenario, airport);
  if (tec === undefined || tecHead(tec).kind === 'none') {
    return { exitElement: filed.exitElement, direction: flightDirection(filed, airport) };
  }
  const tokens = tecTokens(tec, airport);
  if (isUnresolved(tokens)) return tokens;
  const parsed = parseFiledRoute(tokens.join(' '), airport, scenario.destination);
  if (isUnresolved(parsed)) {
    return unresolved(
      parsed.element,
      `the SOP reads the TEC route ${tec.id}, but ${parsed.reason}`,
    );
  }
  return { exitElement: parsed.exitElement, direction: flightDirection(parsed, airport) };
}

/**
 * The route built on a SID the assignment table passed over, for a flight it would otherwise send
 * off on a heading.
 *
 * A heading is issued only because no SID the table reaches serves the element the filed route
 * leaves the terminal on; a transition of one of the passed-over SIDs, or the fix one of them ends
 * on, may still connect onward to a fix the flight already filed, and issuing that SID is the SOP's
 * own answer rather than no procedure at all. There is no procedure to keep here, so every
 * passed-over candidate is searched.
 *
 * A flight a TEC row routes is left on its heading: the route it is issued is the published one the
 * row carries, not a chain off the connection cheat sheet.
 *
 * @param ctx The classified flight.
 * @param route The filed route, whose exit element no assignable SID serves.
 * @param direction The gate direction of the flight, undefined when its exit fix is not a gate.
 * @param scenario The filed flight plan.
 * @param airport The airport data.
 * @returns The route to issue, or `undefined` where no candidate reaches the filed route.
 */
function builtFor(
  ctx: Classification,
  route: ParsedRoute,
  direction: Direction | undefined,
  scenario: Scenario,
  airport: AirportData,
): BuiltRoute | undefined {
  if (usableTecRoute(ctx, scenario, airport) !== undefined) return undefined;
  const candidates = unservedSids(ctx, route.exitElement, direction, scenario, airport);
  return buildRoute(route.tokens, candidates, { kind: 'any' }, airport);
}

/**
 * What the clearance issues: the procedure, the element its route phrase names, the row the
 * departure frequency is read off, and the rows that decided all three.
 *
 * `builtRoute` is the route box a built clearance is read for, which is not the one the pilot filed:
 * it is the SID, the fix the flight leaves it at, the connecting fixes and the filed route from the
 * point the two run together. It is absent wherever the flight flies the route it filed.
 * `vectorsDirect` is set where the route names no fix after the departure, so the route phrase is
 * "radar vectors direct" rather than one that names the exit element.
 */
type Issued = {
  procedure: SelectedProcedure;
  exitElement: string;
  vectorsDirect: boolean;
  row: AssignmentRule;
  citations: RuleCitation[];
  builtRoute?: string;
};

/**
 * What the assignment table and the route builder together issue the flight.
 *
 * A built route replaces every part of the selection the heading would have decided: the procedure
 * is the candidate's SID, the route phrase names the fix the flight leaves it at rather than the one
 * the plan filed, and the departure frequency is read off the candidate's own row. The notices that
 * took a SID out of use are cited either way, because they are why the table reached this row at all.
 * A flight issued its TEC route's departure cites the TEC row beside the assignment row, which still
 * gives the departure frequency.
 *
 * @param selection What the assignment table answered.
 * @param route The filed route.
 * @param built The route the builder found, or `undefined` where it found none.
 * @param airport The airport data.
 * @returns The procedure to issue with the rows that decided it.
 */
function issued(
  selection: SidSelection,
  route: ParsedRoute,
  built: BuiltRoute | undefined,
  airport: AirportData,
): Issued {
  const notices = selection.notices.map(toCitation);
  if (built !== undefined) {
    return {
      procedure: { kind: 'sid', sid: built.sid },
      exitElement: built.start.fix,
      vectorsDirect: false,
      row: built.row,
      citations: [...builtCitations(built, airport), ...notices],
      builtRoute: builtTokens(built, route.tokens).join(' '),
    };
  }
  const { procedure } = selection;
  return {
    procedure,
    exitElement: route.exitElement,
    vectorsDirect: route.vectorsDirect === true,
    row: selection.row,
    citations: [
      toCitation(selection.row),
      ...(selection.tec === undefined ? [] : [citeTec(selection.tec)]),
      ...notices,
      ...(procedure.kind === 'heading' ? citePhraseology(airport, 'R-HEADING') : []),
    ],
  };
}

/**
 * The route element of the clearance, which a built clearance carries the rebuilt box on, and a
 * route that names no fix after its departure speaks as radar vectors direct.
 */
function routeElement(element: Issued, airport: AirportData): ResolvedRoute {
  if (element.vectorsDirect) return phraseVectorsDirect(airport);
  const phrased = phraseRoute(element.procedure, element.exitElement, airport);
  const { builtRoute } = element;
  if (builtRoute === undefined) return phrased;
  return { value: { ...phrased.value, builtRoute }, citations: phrased.citations };
}

/**
 * Resolves the clearance for a scenario: classify, parse the route, select the procedure, phrase the
 * route, resolve the altitude, read the departure frequency off the assignment row, and explain the
 * runway the flight departs from.
 *
 * Every element carries the data rows that decided it, including the operational notice that took
 * a SID out of use where one changed the outcome. A row that assigns no procedure clears the flight
 * on the runway heading and cites the phraseology row for that reading beside it — but only where no
 * route can be built first: a SID the table passed over, connected onward to the filed route, is
 * issued in the heading's place, and the clearance then carries the route it is read for. A flight
 * whose TEC route begins on a departure is placed in the table by that route's exit and direction,
 * while the route phrase still names what the plan files.
 *
 * @param scenario The filed flight plan and the conditions it is cleared under.
 * @param airport The airport data.
 * @returns The resolved clearance, or the element that blocked it with the reason.
 */
export function resolveClearance(scenario: Scenario, airport: AirportData): EngineResult {
  const ctx = classify(scenario, airport);
  if (isUnresolved(ctx)) return blocked(ctx);
  const route = parseFiledRoute(scenario.filedRoute, airport, scenario.destination);
  if (isUnresolved(route)) return blocked(route);
  const direction = flightDirection(route, airport);
  const read = tableRoute(ctx, route, scenario, airport);
  if (isUnresolved(read)) return blocked(read);
  const selection = selectSid(ctx, read.exitElement, read.direction, scenario, airport);
  if (isUnresolved(selection)) return blocked(selection);
  const built =
    selection.procedure.kind === 'heading'
      ? builtFor(ctx, route, direction, scenario, airport)
      : undefined;
  const element = issued(selection, route, built, airport);
  const altitude = resolveAltitude(ctx, element.procedure, scenario, airport);
  if (isUnresolved(altitude)) return blocked(altitude);
  const frequency = resolveFrequency(element.row, airport);
  if (isUnresolved(frequency)) return blocked(frequency);
  return {
    ok: true,
    clearance: {
      clearedTo: {
        value: scenario.destination,
        citations: citePhraseology(airport, 'C-DEST'),
      },
      runway: explainRunway(scenario, airport, ctx.aircraftClass, read.direction),
      procedure: {
        value: procedureOf(element.procedure),
        citations: element.citations,
      },
      route: routeElement(element, airport),
      altitude: altitude.altitude,
      expect: altitude.expect,
      redundantExpect: altitude.redundantExpect,
      frequency,
    },
  };
}
