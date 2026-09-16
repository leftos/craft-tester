import type { AirportData, Destination, Scenario, TecRoute } from '@/data/schema.ts';
import type { Classification } from '@/rules/classify.ts';

/** A TEC route's placeholder for the current version of a family, e.g. `TRUKN#`. */
export const FAMILY_PLACEHOLDER = /^([A-Z]+)#$/;

/** The initial heading a TEC route is issued on, as the route tool writes it, e.g. `H270`. */
const HEADING_TOKEN = /^H(\d{3})$/;

/** The highest magnetic heading a row may name; `H000` and anything above this is a data error. */
const MAX_HEADING = 360;

/** What a TEC row's route begins on: a departure family, an initial heading, or neither. */
export type TecHead =
  | { kind: 'family'; family: string }
  | { kind: 'heading'; heading: number }
  | { kind: 'none' };

/**
 * Reads what a TEC row's route begins on.
 *
 * A row begins on a departure family where its first token is a placeholder, on an initial heading
 * where it is `H` and three digits, and on neither where it is a fix or an airway. The heading rows
 * are the ones SOP 2-1 c issues a heading for: the route carries no departure procedure at all.
 *
 * @param row The TEC route row.
 * @returns The family, the heading in degrees, or `none`.
 * @throws Error When the row begins on a heading token outside 1 to 360 degrees, which no aircraft
 *   can be turned onto and so is a transcription error in the row.
 */
export function tecHead(row: TecRoute): TecHead {
  const head = row.route.trim().split(/\s+/)[0];
  if (head === undefined) return { kind: 'none' };
  const family = FAMILY_PLACEHOLDER.exec(head)?.[1];
  if (family !== undefined) return { kind: 'family', family };
  const digits = HEADING_TOKEN.exec(head)?.[1];
  if (digits === undefined) return { kind: 'none' };
  const heading = Number(digits);
  if (heading < 1 || heading > MAX_HEADING) {
    throw new Error(
      `${row.id} begins on ${head}, which is no magnetic heading; write H001 through H360`,
    );
  }
  return { kind: 'heading', heading };
}

/**
 * Whether a row is written for this flight's destination, plan, runway family and class.
 *
 * @param row The TEC route row.
 * @param ctx The classified flight.
 * @param destination The destination row the flight is filed to.
 * @returns True when the row is keyed for the flight.
 */
export function keyedFor(row: TecRoute, ctx: Classification, destination: Destination): boolean {
  if (row.kind !== 'tec' || row.destination !== destination.icao || row.plan !== ctx.plan) {
    return false;
  }
  if (row.runwayFamilies.length > 0 && !row.runwayFamilies.includes(ctx.runwayFamily)) return false;
  return row.classes.includes(ctx.aircraftClass);
}

/**
 * The first TEC row written for this flight, whatever its route begins on.
 *
 * This is the row before any test of whether its departure can be issued, which is what an
 * assignment rule asks about when it is written for a flight whose TEC route carries no departure
 * procedure. A destination outside the TRACON, or one the route library does not hold, has none.
 *
 * @param ctx The classified flight, which carries the plan, runway family and class rows key on.
 * @param scenario The filed flight plan, which names the destination.
 * @param airport The airport data, whose `tecRoutes` hold the transcribed rows.
 * @returns The row, or `undefined` when no row is written for the flight.
 */
export function keyedTecRoute(
  ctx: Classification,
  scenario: Scenario,
  airport: AirportData,
): TecRoute | undefined {
  const destination = airport.routeLibrary.destinations.find(
    (row) => row.icao === scenario.destination,
  );
  if (destination?.nct !== true) return undefined;
  return airport.tecRoutes.find((row) => keyedFor(row, ctx, destination));
}
