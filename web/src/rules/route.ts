import type { AirportData, Direction, Gates, Scenario, Sid } from '@/data/schema.ts';
import type { Classification } from '@/rules/classify.ts';
import type { Unresolved } from '@/rules/types.ts';
import { unresolved } from '@/rules/unresolved.ts';

/** A departure procedure token: three to five letters and a version digit, e.g. `TRUKN2`. */
const SID_TOKEN = /^[A-Z]{3,5}\d$/;

/**
 * An airway token: one letter and up to three digits, e.g. `V6`, `J501`, `Q158` or the oceanic
 * `R463` and `A220`. A procedure token carries three letters or more, so the two never overlap.
 */
const AIRWAY_TOKEN = /^[A-Z]\d{1,3}$/;

/** An identifier as a flight plan writes one: upper-case letters and digits, and nothing else. */
const IDENT_TOKEN = /^[A-Z0-9]+$/;

/** The runway heading a route departs on, as a TEC route writes it at its head. */
const RUNWAY_HEADING_TOKEN = 'RH';

/** An initial heading a route departs on, as a TEC route writes it at its head, e.g. `H270`. */
const HEADING_TOKEN = /^H\d{3}$/;

/** The radar vectors a route ends in where it names no fix after its departure. */
const RADAR_VECTORS_TOKEN = 'RV';

/** What flying one element of a route takes: RNAV capability, or the GPS a T or Y route needs. */
export type RnavNeed = 'rnav' | 'gnss';

/** One element of a filed route only a suitably equipped aircraft may file, and what it takes. */
export type RnavElement = { token: string; needs: RnavNeed; kind: 'airway' | 'waypoint' };

/** The published RNAV airways by their letter, with what flying one takes (AIM 5-3-4 c 1). */
const RNAV_AIRWAYS: Record<string, RnavNeed> = { Q: 'rnav', T: 'gnss', Y: 'gnss' };

/** The directions a gate fix can belong to, in the order `gates` lists them. */
const DIRECTIONS: readonly Direction[] = ['north', 'south', 'oceanic'];

/**
 * The filed route split into the procedure the pilot filed and the route that follows it.
 *
 * `exitElement` is what the flight leaves the terminal on and what the route phrase names: the
 * first fix after the procedure, or the airway when the route joins one straight off the SID.
 * `exitFix` is the first fix of the route either way, which is what the gate lookup reads.
 * `structureSids` names every SID whose own structure the dropped fixes lie on and which publishes
 * the transition they are read to. Two departures out of the same airport often fly over the same
 * fix to the same transition, so more than one SID can justify the same drop, and an amendment
 * naming the fixes picks the procedure it is itself proposing where that one is among them.
 * `vectorsDirect` is set on a route that names no fix after its departure and is vectored straight
 * to the destination; its exit element, exit fix and only token are then the destination's
 * identifier, which is the gate the departure frequency is read from.
 */
export type ParsedRoute = {
  filedSidToken?: string;
  droppedStructureTokens?: string[];
  structureSids?: string[];
  exitElement: string;
  exitFix: string;
  tokens: string[];
  vectorsDirect?: boolean;
};

/**
 * Whether a route token names a departure procedure rather than a fix or an airway.
 *
 * @param token One token of a filed route.
 * @returns True for `TRUKN2`, false for `TRUKN`, `J501`, and `V244`.
 */
export function isSidToken(token: string): boolean {
  return SID_TOKEN.test(token);
}

/**
 * Whether a route token is a heading the route departs on rather than a fix or a procedure.
 *
 * @param token One token of a filed route.
 * @returns True for `RH`, the runway heading, and for `H270`; false for `HWD`, `H27` and `TRUKN2`.
 */
export function isHeadingToken(token: string): boolean {
  return token === RUNWAY_HEADING_TOKEN || HEADING_TOKEN.test(token);
}

/** Whether a route token is what the route departs on: a procedure or a heading. */
function isDepartureToken(token: string): boolean {
  return isSidToken(token) || isHeadingToken(token);
}

/**
 * Whether a route token names an airway.
 *
 * @param token One token of a filed route.
 * @returns True for `V6`, `J501`, `Q158`, `T257`, `Y291` and `R463`, false for a fix or a procedure.
 */
export function isAirwayToken(token: string): boolean {
  return AIRWAY_TOKEN.test(token);
}

/**
 * Whether a route token is an identifier too long to be one, and so names nothing at all.
 *
 * Nothing the NAS publishes carries more than five characters in its identifier — a fix and a navaid
 * are two to five, an airway a letter and up to three digits — except a departure or arrival
 * procedure, which is three to five letters and a version digit. A token of letters and digits alone
 * that is neither of those and runs past five characters is therefore an identifier that cannot be
 * one: two run together, or a typo. `BVLQ124`, seven characters, is the navaid BVL and the airway
 * Q124 filed as one element.
 *
 * The test is for an identifier too long to be one rather than for a long token, because a route box
 * also carries what the worksheet wrote around the route it transcribes: the `(continued)` of a route
 * the sheet cut off, and the `ANN…` it cut it off at. The parentheses, the lower case and the
 * ellipsis say those are not identifiers being attempted, so they are left where they were written.
 *
 * @param token One token of a filed route.
 * @returns True for `BVLQ124`, false for `BVL`, `Q124`, `MOGEE`, `R464`, `WAATS5` and `(continued)`.
 */
export function isMalformedToken(token: string): boolean {
  return IDENT_TOKEN.test(token) && !isSidToken(token) && !isAirwayToken(token) && token.length > 5;
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
 * a stale or wrong SID does not change the exit fix, and so is a leading heading token, `RH` or
 * `H270`, which a TEC route departs on in a procedure's place. The airport's own navaid is skipped
 * where it is filed next, e.g. `SFO` in `WESLA5 SFO SUSEY`. The first token of the result is the
 * element the flight leaves the terminal on: a fix, or an airway when the route joins one straight
 * off the SID.
 *
 * @param filedRoute The route string as filed.
 * @param airportFaa The departure airport's own navaid identifier, e.g. `SFO`.
 * @returns The tokens from the exit element onwards; empty when the route has nothing after the
 *   procedure.
 */
export function routeFromExitFix(filedRoute: string, airportFaa: string): string[] {
  const filed = splitRoute(filedRoute);
  const first = filed[0];
  const afterHead = first !== undefined && isDepartureToken(first) ? filed.slice(1) : filed;
  return afterHead[0] === airportFaa ? afterHead.slice(1) : afterHead;
}

/**
 * The identifier a destination airport is known by in the gates: its FAA code, the ICAO code
 * without the leading `K` (`KOAK` is `OAK`).
 */
function destinationIdent(icao: string): string {
  return icao.length === 4 && icao.startsWith('K') ? icao.slice(1) : icao;
}

/**
 * The token a filed route carries where it cannot stand, named for the reason.
 *
 * A heading token stands only at the head of the route, and `RV` only as the sole element after the
 * departure: `OSI RH` and `RH OSI RV` are malformed.
 *
 * @param headed Whether the route begins on a procedure or a heading.
 * @param afterHead The route after that head and the airport's own navaid.
 * @returns The token, or `undefined` where every token stands where it may.
 */
function misplacedToken(headed: boolean, afterHead: readonly string[]): string | undefined {
  const heading = afterHead.find((token) => isHeadingToken(token));
  if (heading !== undefined) return heading;
  const vectorsDirect = headed && afterHead.length === 1;
  return afterHead.includes(RADAR_VECTORS_TOKEN) && !vectorsDirect
    ? RADAR_VECTORS_TOKEN
    : undefined;
}

/**
 * Whether a route names no fix after its departure, and so is vectored straight to the destination.
 *
 * That is a route whose head is followed by `RV` alone (`RH RV`, `H090 RV`, `OAK6 OAK RV`), or one
 * that files a radar-vector SID with nothing after it but the airport's own navaid (`GAPP7 SFO`,
 * `GAPP7`). A radar-vector SID is one filed with the airport navaid after it (R-RV-NAVAID), read by
 * family so a stale version reads as the current one.
 */
function isVectorsDirect(
  head: string | undefined,
  afterHead: readonly string[],
  airport: AirportData,
): boolean {
  if (head === undefined || !isDepartureToken(head)) return false;
  if (afterHead.length === 1) return afterHead[0] === RADAR_VECTORS_TOKEN;
  if (afterHead.length > 0 || !isSidToken(head)) return false;
  const sid = airport.sids.find((entry) => entry.family === head.slice(0, -1));
  return sid?.routePhrasing === 'radar_vectors_fix';
}

/**
 * Whether a route is `RV` and nothing else: radar vectors direct with no procedure filed, the way a
 * route library tail reads before the SOP's procedure is put in front of it.
 */
function isBareVectors(tokens: readonly string[]): boolean {
  return tokens.length === 1 && tokens[0] === RADAR_VECTORS_TOKEN;
}

/**
 * The parsed route of a flight vectored straight to its destination.
 *
 * The destination's identifier stands in for the exit fix, so the gate it is in gives the direction
 * of flight and the departure frequency (user ruling 2026-09-18: Richmond for KSFO to KOAK).
 *
 * @param filedRoute The route string as filed, named in the reason where the identifier is no gate.
 * @param filedSidToken The procedure the route files, where it files one.
 * @param destination The destination's ICAO code.
 * @param airport The airport data, whose gates place the identifier.
 * @returns The parsed route, or `Unresolved` where the destination's identifier is in no gate.
 */
function vectorsDirectRoute(
  filedRoute: string,
  filedSidToken: string | undefined,
  destination: string,
  airport: AirportData,
): ParsedRoute | Unresolved {
  const ident = destinationIdent(destination);
  if (directionOf(ident, airport.gates) === undefined) {
    return unresolved(
      'R.route',
      `filed route "${filedRoute}" is radar vectors direct to ${destination}, but ${ident} is in no departure gate of ${airport.airport.icao}, so nothing gives the direction of flight`,
    );
  }
  return {
    ...(filedSidToken === undefined ? {} : { filedSidToken }),
    exitElement: ident,
    exitFix: ident,
    tokens: [ident],
    vectorsDirect: true,
  };
}

/**
 * The names one SID's own structure carries: the family the procedure is named for, the fix it is
 * built on, and every fix its published restrictions name.
 *
 * @param sid One published SID.
 * @returns The names, in no particular order.
 */
function structureNames(sid: Sid): string[] {
  return [
    sid.family,
    ...(sid.baseFix === undefined ? [] : [sid.baseFix]),
    ...sid.restrictions.map((row) => row.fix),
  ];
}

/**
 * The SIDs a token names the structure of, where the SID publishes a transition to the next token.
 *
 * @param token The token the route files.
 * @param next The next token of the route that survives the walk.
 * @param airport The airport data, whose `sids` carry the structure and the transitions.
 * @returns Every SID that answers both halves, in the order the airport publishes them; empty where
 *   none does.
 */
function structureSidsBefore(token: string, next: string, airport: AirportData): Sid[] {
  return airport.sids.filter(
    (sid) =>
      structureNames(sid).includes(token) &&
      sid.transitions.some((transition) => transition.fix === next),
  );
}

/** The leading tokens a route is read past, and the SIDs whose structure they were read past on. */
type StructurePrefix = { length: number; sids: string[] };

/**
 * How many leading tokens of a filed route name only structure the departure already flies over.
 *
 * A token is dropped when it names some SID's own structure and the next token to survive is one of
 * that same SID's published transitions: `CNDEL PORTE SUSEY EBAYE BURGL` is read from SUSEY, the
 * transition CNDEL5 publishes, CNDEL naming the procedure and PORTE the fix it is built on. Where
 * the route files no published transition of such a SID nothing is dropped and the first filed fix
 * stands, spoken bare: `TRUKN2 TRUKN CCR CCR2` is read from TRUKN, CCR being no transition of
 * TRUKN2. The longest such prefix wins, and at least one token always survives.
 *
 * @param tokens The filed route from its exit fix onwards.
 * @param airport The airport data, whose `sids` carry the structure and the transitions.
 * @returns The number of leading tokens to drop, zero when the route names none, and the SIDs whose
 *   structure the first of them lies on, empty when nothing is dropped.
 */
function structurePrefix(tokens: readonly string[], airport: AirportData): StructurePrefix {
  for (let length = tokens.length - 1; length >= 1; length -= 1) {
    const survivor = tokens[length] ?? '';
    const answering = tokens
      .slice(0, length)
      .map((token) => structureSidsBefore(token, survivor, airport));
    if (answering.every((sids) => sids.length > 0)) {
      return { length, sids: (answering[0] ?? []).map((sid) => sid.id) };
    }
  }
  return { length: 0, sids: [] };
}

/**
 * Splits a filed route into its procedure token, the element the flight leaves the terminal on, and
 * the first fix of the route.
 *
 * The route is read from the first element that is not the departure's own structure: a leading fix
 * the SID already flies over is dropped where the route files one of that SID's published
 * transitions further along, and `droppedStructureTokens` records what was dropped, with
 * `structureSids` the SIDs it was dropped on, so an amendment can name both. A route that joins an
 * airway straight off the SID leaves on that airway, and the fix the airway leads to is what places
 * the flight in a departure gate.
 *
 * A route that names no fix after its departure — `RV` alone after it, or a radar-vector SID with
 * nothing after the airport navaid — is radar vectors direct, read from the destination's
 * identifier. So is a route that is `RV` and nothing else: it files no procedure, as a tail filed
 * without its SID files none, and the SOP or the TEC route supplies one. Any other route with no fix
 * at all after the procedure blocks the route element: there is nothing to pick a gate, and so a
 * SID, from. So does a heading token anywhere but at the head, and an `RV` anywhere but alone after
 * the departure or alone in the route (`OSI RV` and `OAK RV` are malformed).
 *
 * @param filedRoute The route string as filed.
 * @param airport The airport data, for the airport's own navaid identifier, its SIDs and its gates.
 * @param destination The destination's ICAO code, whose identifier a vectors-direct route exits on.
 * @returns The parsed route, or `Unresolved` when nothing usable follows the procedure token, a token
 *   stands where it cannot, or a vectors-direct destination is in no gate.
 */
export function parseFiledRoute(
  filedRoute: string,
  airport: AirportData,
  destination: string,
): ParsedRoute | Unresolved {
  const whole = splitRoute(filedRoute);
  if (isBareVectors(whole)) {
    return vectorsDirectRoute(filedRoute, undefined, destination, airport);
  }
  const first = whole[0];
  const filedSidToken = first !== undefined && isSidToken(first) ? first : undefined;
  const filed = routeFromExitFix(filedRoute, airport.airport.faa);
  const misplaced = misplacedToken(first !== undefined && isDepartureToken(first), filed);
  if (misplaced !== undefined) {
    return unresolved(
      'R.route',
      `filed route "${filedRoute}" carries ${misplaced} where it cannot stand: a heading token stands only at the head of a route, and RV only alone after the departure`,
    );
  }
  if (isVectorsDirect(first, filed, airport)) {
    return vectorsDirectRoute(filedRoute, filedSidToken, destination, airport);
  }
  const prefix = structurePrefix(filed, airport);
  const dropped = filed.slice(0, prefix.length);
  const tokens = filed.slice(dropped.length);
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
  return {
    ...(filedSidToken === undefined ? {} : { filedSidToken }),
    ...(dropped.length === 0 ? {} : { droppedStructureTokens: dropped }),
    ...(prefix.sids.length === 0 ? {} : { structureSids: prefix.sids }),
    exitElement,
    exitFix,
    tokens,
  };
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

/**
 * The fixes the procedure at the head of a route already implies: where it ends, and where it
 * publishes a transition to.
 *
 * Those fixes are the procedure speaking, not the route: an RNAV SID is gated by `rnavRequired`
 * already, and most RNAV SIDs are published over RNAV waypoints, so counting them again would make
 * every RNAV departure a route the plan cannot fly.
 *
 * @param head The first token of the filed route, which may be a procedure.
 * @param airport The airport data, whose `sids` publish the transitions.
 * @returns The fixes, empty when the route files no procedure the data holds.
 */
function sidFixes(head: string | undefined, airport: AirportData): Set<string> {
  if (head === undefined || !isSidToken(head)) return new Set();
  const sid = airport.sids.find((entry) => entry.id === head);
  if (sid === undefined) return new Set();
  const transitions = sid.transitions.map((transition) => transition.fix);
  return new Set(sid.baseFix === undefined ? transitions : [sid.baseFix, ...transitions]);
}

/**
 * What one token of a filed route takes to fly, where it takes anything at all.
 *
 * @param token One token of the filed route.
 * @param implied The fixes the filed procedure already implies.
 * @param airport The airport data, for its own navaid and its RNAV waypoints.
 * @returns The element, or `undefined` for a token any aircraft may file.
 */
function elementOf(
  token: string,
  implied: ReadonlySet<string>,
  airport: AirportData,
): RnavElement | undefined {
  if (isSidToken(token) || token === airport.airport.faa) return undefined;
  if (isAirwayToken(token)) {
    const needs = RNAV_AIRWAYS[token.charAt(0)];
    return needs === undefined ? undefined : { token, needs, kind: 'airway' };
  }
  if (implied.has(token) || !airport.rnavWaypoints.includes(token)) return undefined;
  return { token, needs: 'rnav', kind: 'waypoint' };
}

/**
 * The elements of a filed route only a suitably equipped aircraft may file.
 *
 * A published RNAV route is one: a Q route is flown by an RNAV-capable aircraft, a T or Y route by
 * a GPS-equipped one. So is a fix the CIFP publishes as an RNAV waypoint. The procedure tokens
 * themselves are left out, and so are the departure airport's own navaid and every fix the filed
 * procedure implies, which the procedure's own RNAV flag already answers for.
 *
 * @param scenario The filed flight plan, whose route box is read token by token.
 * @param airport The airport data, whose `rnavWaypoints` say which fixes are RNAV-only.
 * @returns One element per token that needs something, in the order the route files them, with no
 *   token named twice.
 */
export function rnavElements(scenario: Scenario, airport: AirportData): RnavElement[] {
  const tokens = [...new Set(splitRoute(scenario.filedRoute))];
  const implied = sidFixes(tokens[0], airport);
  return tokens
    .map((token) => elementOf(token, implied, airport))
    .filter((element) => element !== undefined);
}

/**
 * The elements of a filed route the flight's own equipment suffix cannot fly.
 *
 * @param scenario The filed flight plan, as the type box's suffix check leaves it.
 * @param ctx That plan's classification, which carries what the suffix is capable of.
 * @param airport The airport data.
 * @returns The elements the plan needs and the suffix has not, in the order the route files them.
 */
export function lackingRnavElements(
  scenario: Scenario,
  ctx: Classification,
  airport: AirportData,
): RnavElement[] {
  return rnavElements(scenario, airport).filter((element) =>
    element.needs === 'gnss' ? !ctx.gnssCapable : !ctx.rnavCapable,
  );
}
