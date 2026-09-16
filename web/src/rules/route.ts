import type { AirportData, Direction, Gates } from '@/data/schema.ts';
import type { Unresolved } from '@/rules/types.ts';
import { unresolved } from '@/rules/unresolved.ts';

/** A departure procedure token: three to five letters and a version digit, e.g. `TRUKN2`. */
const SID_TOKEN = /^[A-Z]{3,5}\d$/;

/** An airway token, e.g. `J501` or `Q158`, which is never a departure procedure. */
const AIRWAY_TOKEN = /^[JVQT]\d+$/;

/** The directions a gate fix can belong to, in the order `gates` lists them. */
const DIRECTIONS: readonly Direction[] = ['north', 'south', 'oceanic'];

/**
 * The filed route split into the procedure the pilot filed and the route that follows it.
 *
 * `exitElement` is what the flight leaves the terminal on and what the route phrase names: the
 * first fix after the procedure, or the airway when the route joins one straight off the SID.
 * `exitFix` is the first fix of the route either way, which is what the gate lookup reads.
 */
export type ParsedRoute = {
  filedSidToken?: string;
  exitElement: string;
  exitFix: string;
  tokens: string[];
};

/**
 * Whether a route token names a departure procedure rather than a fix or an airway.
 *
 * @param token One token of a filed route.
 * @returns True for `TRUKN2`, false for `TRUKN`, `J501`, and `V244`.
 */
export function isSidToken(token: string): boolean {
  return SID_TOKEN.test(token) && !AIRWAY_TOKEN.test(token);
}

/**
 * Whether a route token names an airway.
 *
 * @param token One token of a filed route.
 * @returns True for `V6`, `J501`, `Q158`, and `T257`, false for a fix or a procedure.
 */
export function isAirwayToken(token: string): boolean {
  return AIRWAY_TOKEN.test(token);
}

/** Splits a route string on whitespace, dropping the empty strings a blank route produces. */
function splitRoute(filedRoute: string): string[] {
  return filedRoute
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * Takes the filed route from its exit fix onwards.
 *
 * A leading procedure token is stripped whether or not it is the procedure the flight will get, so
 * a stale or wrong SID does not change the exit fix. The airport's own navaid is skipped where it
 * is filed next, e.g. `SFO` in `WESLA5 SFO SUSEY`. The first token of the result is the element the
 * flight leaves the terminal on: a fix, or an airway when the route joins one straight off the SID.
 *
 * @param filedRoute The route string as filed.
 * @param airportFaa The departure airport's own navaid identifier, e.g. `SFO`.
 * @returns The tokens from the exit element onwards; empty when the route has nothing after the
 *   procedure.
 */
export function routeFromExitFix(filedRoute: string, airportFaa: string): string[] {
  const filed = splitRoute(filedRoute);
  const first = filed[0];
  const afterSid = first !== undefined && isSidToken(first) ? filed.slice(1) : filed;
  return afterSid[0] === airportFaa ? afterSid.slice(1) : afterSid;
}

/**
 * Splits a filed route into its procedure token, the element the flight leaves the terminal on, and
 * the first fix of the route.
 *
 * A route that joins an airway straight off the SID leaves on that airway, and the fix the airway
 * leads to is what places the flight in a departure gate. A route with no fix at all after the
 * procedure blocks the route element: there is nothing to pick a gate, and so a SID, from.
 *
 * @param filedRoute The route string as filed.
 * @param airport The airport data, for the airport's own navaid identifier.
 * @returns The parsed route, or `Unresolved` when nothing usable follows the procedure token.
 */
export function parseFiledRoute(
  filedRoute: string,
  airport: AirportData,
): ParsedRoute | Unresolved {
  const first = splitRoute(filedRoute)[0];
  const filedSidToken = first !== undefined && isSidToken(first) ? first : undefined;
  const tokens = routeFromExitFix(filedRoute, airport.airport.faa);
  const exitElement = tokens[0];
  if (exitElement === undefined) {
    return unresolved('R.route', `filed route "${filedRoute}" has no fix after the procedure`);
  }
  const exitFix = tokens.find((token) => !isAirwayToken(token));
  if (exitFix === undefined) {
    return unresolved(
      'R.route',
      `filed route "${filedRoute}" joins airway ${exitElement} with no fix to leave the terminal on`,
    );
  }
  const parsed = { exitElement, exitFix, tokens };
  return filedSidToken === undefined ? parsed : { filedSidToken, ...parsed };
}

/**
 * Looks up the departure direction a gate fix belongs to.
 *
 * @param fix The exit fix.
 * @param gates The airport's gate fixes grouped by direction.
 * @returns The direction, or undefined when the fix is not a gate.
 */
export function directionOf(fix: string, gates: Gates): Direction | undefined {
  return DIRECTIONS.find((direction) => gates[direction].includes(fix));
}

/** Whether a procedure token is the current or a stale version of that SID family. */
function isFamily(token: string | undefined, family: string | null): boolean {
  if (token === undefined || family === null) return false;
  return isSidToken(token) && token.slice(0, -1) === family;
}

/**
 * The direction the flight is departing in, which is the gate its route leaves the terminal by.
 *
 * A forced transition is the exception: a row that sends a flight over a fix for noise abatement
 * routes it away from where it is going, so the gate that fix belongs to is not the direction of
 * flight. KSFO's 0100L-0500L southbound row sends departures over GOBBS, a north gate, and a route
 * already reading `NIITE4 GOBBS YYUNG …` would otherwise be read as a northbound flight and cleared
 * by the northbound night row. The direction is then the first gate fix further along the route,
 * which is where the flight is actually going; a route with none keeps the gate of its exit fix.
 *
 * @param parsed The filed route, whose procedure token says which family the detour belongs to.
 * @param airport The airport data, for the gates and the rows that force a transition.
 * @returns The direction, or undefined when no fix on the route is a gate.
 */
export function flightDirection(parsed: ParsedRoute, airport: AirportData): Direction | undefined {
  const detour = airport.assignmentRules.some(
    (row) =>
      row.when?.forcedTransition === parsed.exitFix &&
      isFamily(parsed.filedSidToken, row.sidFamily),
  );
  const onward = detour
    ? parsed.tokens.slice(1).find((token) => directionOf(token, airport.gates) !== undefined)
    : undefined;
  return directionOf(onward ?? parsed.exitFix, airport.gates);
}
