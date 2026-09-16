import type { AirportData, Destination, Scenario, TecRoute } from '@/data/schema.ts';
import type { Classification } from '@/rules/classify.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { FAMILY_PLACEHOLDER, keyedFor, tecHead } from '@/rules/tecRoutes.ts';
import type { Unresolved } from '@/rules/types.ts';
import { isUnresolved, unresolved } from '@/rules/unresolved.ts';

/**
 * Reads a TEC row's route, putting the current version of each family in place of its placeholder.
 *
 * A row issued on an initial heading begins on that heading, which is the procedure the clearance
 * names rather than a token of the route box, so it is dropped and the route follows it.
 *
 * @param row The TEC route row the flight is routed on.
 * @param airport The airport data, whose `sids` carry the versions in force this cycle.
 * @returns The route as tokens, or `Unresolved` when the row names a family the airport no longer
 *   publishes, which leaves the row with no route to propose.
 */
export function tecTokens(row: TecRoute, airport: AirportData): string[] | Unresolved {
  const tokens: string[] = [];
  const written = row.route.trim().split(/\s+/);
  for (const token of tecHead(row).kind === 'heading' ? written.slice(1) : written) {
    const family = FAMILY_PLACEHOLDER.exec(token)?.[1];
    if (family === undefined) {
      tokens.push(token);
      continue;
    }
    const sid = airport.sids.find((entry) => entry.family === family);
    if (sid === undefined) {
      return unresolved(
        'BOX.route',
        `${row.id} routes the flight on the ${family} departure, which ${airport.airport.icao} no longer publishes`,
      );
    }
    tokens.push(sid.id);
  }
  return tokens;
}

/**
 * Whether the departure a row begins on is one the SOP would issue this flight.
 *
 * The clearance engine answers it: the row's own route, at the versions in force, is put to the
 * engine as though the flight had filed it, and the row is issuable when the engine clears the
 * flight on what the row begins on — the family it names, or the initial heading it is issued on,
 * which SOP 2-1 c reaches only where no departure procedure can be used. A row that begins on a fix
 * or an airway carries no such condition.
 *
 * @param row The TEC route row under test.
 * @param scenario The filed flight plan, whose runway, configuration, type and suffix decide what
 *   the SOP assigns; only the route box is replaced.
 * @param airport The airport data.
 * @returns True when the SOP would issue the row's departure to this flight.
 */
function issuable(row: TecRoute, scenario: Scenario, airport: AirportData): boolean {
  const head = tecHead(row);
  if (head.kind === 'none') return true;
  const tokens = tecTokens(row, airport);
  if (isUnresolved(tokens)) return false;
  const result = resolveClearance({ ...scenario, filedRoute: tokens.join(' ') }, airport);
  if (!result.ok) return false;
  const procedure = result.clearance.procedure.value;
  if (head.kind === 'family') {
    return procedure.kind === 'sid' && procedure.family === head.family;
  }
  return procedure.kind === 'heading' && procedure.heading === head.heading;
}

/**
 * The TEC route row that routes this flight, for a destination inside the TRACON.
 *
 * A row is keyed by destination, plan, runway family and class, and the first row that matches all
 * four is the flight's — with one further test: a row whose route begins on a departure family, or
 * on the initial heading it is issued on, is the flight's only where the SOP would issue that
 * departure to this flight, from this runway, in the configuration in use. SOP 2-1 b, quoted in the `tec.yaml` header, says the route is issued
 * only where the pilot can accept it — "if a pilot cannot accept one, vectors direct" — and that
 * one test covers a non-RNAV flight, for which an RNAV departure is never assigned; a runway family
 * the departure is not issued from; and a configuration that issues another departure, as 28R in
 * 28/01 is assigned SNTNA2 or GAPP7 and never TRUKN2. The route box then reads the assigned
 * departure followed by the filed tail, and no TEC cap applies, because the flight is not on a TEC
 * route. A row whose route begins on a fix or an airway applies as written.
 *
 * @param ctx The classified flight, which carries the plan, runway family and class the rows key on.
 * @param scenario The filed flight plan, which the issuable test puts the row's own route to.
 * @param airport The airport data, whose `tecRoutes` hold the transcribed rows.
 * @param destination The destination row, absent when the route library does not hold it.
 * @returns The row that routes the flight, or `undefined` for a destination outside the TRACON, one
 *   the library does not hold, or one whose rows are all written for another flight.
 */
export function tecRouteFor(
  ctx: Classification,
  scenario: Scenario,
  airport: AirportData,
  destination: Destination | undefined,
): TecRoute | undefined {
  if (destination?.nct !== true) return undefined;
  return airport.tecRoutes.find(
    (row) => keyedFor(row, ctx, destination) && issuable(row, scenario, airport),
  );
}
