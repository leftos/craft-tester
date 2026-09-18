import type {
  AirportData,
  AssignmentRule,
  Destination,
  Notice,
  Scenario,
  Sid,
  TecRoute,
} from '@/data/schema.ts';
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
 * Whether the flight can fly the SID at all: off its runway, with the equipment it carries.
 *
 * @param sid The SID under test.
 * @param scenario The filed flight plan, which names the departure runway.
 * @param ctx The classified flight, which carries its RNAV capability.
 * @returns True when the SID is published off the runway and the flight can navigate it.
 */
export function isFlyable(sid: Sid, scenario: Scenario, ctx: Classification): boolean {
  return sid.runways.includes(scenario.departureRunway) && (!sid.rnavRequired || ctx.rnavCapable);
}

/**
 * The active notice, if any, that takes a SID family out of use for this flight's plan.
 *
 * @param sidFamily The family a row names, or `null` for a row that names none.
 * @param ctx The classified flight, which carries the plan and the active notices.
 * @param airport The airport data, whose `notices` hold the transcribed notices.
 * @returns The notice, or `undefined` where the family is in use or no family is named.
 */
export function sidOffNotice(
  sidFamily: string | null,
  ctx: Classification,
  airport: AirportData,
): Notice | undefined {
  if (sidFamily === null) return undefined;
  return airport.notices.find(
    (notice) =>
      ctx.activeNotices.includes(notice.id) &&
      (notice.plan === undefined || notice.plan === ctx.plan) &&
      notice.effect.kind === 'sid_off' &&
      notice.effect.sidFamily === sidFamily,
  );
}

/**
 * The assignment rows that put a departure family in use from the flight's runway family in the
 * configuration in use.
 *
 * Such a row is of the flight's plan, assigns the family, lists the runway family, and admits the
 * configuration by its `configs` and `notConfigs`. The row's direction, exits, audience, RNAV
 * condition and noise window are not read: equipment is `isFlyable`'s test, and a noise window is the
 * table walk's. TRUKN is in use off 01R in 28/01, and off 28L only in 28 RT.
 *
 * @param family The departure family a TEC row begins on.
 * @param ctx The classified flight, which carries the plan, runway family and configuration.
 * @param airport The airport data, whose `assignmentRules` put families in use.
 * @returns The rows in table order, empty where the SOP puts the family in use from none.
 */
export function inUseRows(
  family: string,
  ctx: Classification,
  airport: AirportData,
): AssignmentRule[] {
  return airport.assignmentRules.filter(
    (row) =>
      row.sidFamily === family &&
      row.plan === ctx.plan &&
      row.runwayFamilies.includes(ctx.runwayFamily) &&
      (row.when?.configs === undefined || row.when.configs.includes(ctx.config.id)) &&
      (row.when?.notConfigs === undefined || !row.when.notConfigs.includes(ctx.config.id)),
  );
}

/**
 * Whether the flight can be issued what a row begins on.
 *
 * A departure family is usable where the airport still publishes it, the flight can fly its SID off
 * the runway it is on with the equipment it carries, the SOP puts the family in use from that runway
 * family in this configuration, and no active notice takes the family out of use without a heading in
 * its place; a notice that names a heading leaves the row usable, the heading standing in for the
 * SID. A row that begins on an initial heading, a fix or an airway is always usable.
 */
function usable(
  row: TecRoute,
  ctx: Classification,
  scenario: Scenario,
  airport: AirportData,
): boolean {
  const head = tecHead(row);
  if (head.kind !== 'family') return true;
  const sid = airport.sids.find((entry) => entry.family === head.family);
  if (sid === undefined || !isFlyable(sid, scenario, ctx)) return false;
  if (inUseRows(head.family, ctx, airport).length === 0) return false;
  const notice = sidOffNotice(head.family, ctx, airport);
  return notice === undefined || notice.effect.heading !== undefined;
}

/**
 * The TEC row that routes this flight: the first row, in table order, keyed for it and usable by it.
 *
 * A row is keyed by destination, plan, runway family and class, and only a destination inside the
 * TRACON has one. SOP 2-1 b issues the route only where the pilot can accept it — "if a pilot cannot
 * accept one, vectors direct" — so a row whose departure the flight cannot fly, off this runway with
 * this equipment, whose family the SOP does not put in use from this runway family in this
 * configuration, or whose family a notice has taken out of use, is passed over for the next keyed
 * row. The row is chosen from the data alone, without asking the assignment table what it would issue.
 *
 * @param ctx The classified flight, which carries the plan, runway family, class, equipment and the
 *   active notices.
 * @param scenario The filed flight plan, which names the destination and the departure runway.
 * @param airport The airport data, whose `tecRoutes` hold the transcribed rows.
 * @returns The row, or `undefined` for a destination outside the TRACON, one the route library does
 *   not hold, or one whose keyed rows the flight can use none of.
 */
export function usableTecRoute(
  ctx: Classification,
  scenario: Scenario,
  airport: AirportData,
): TecRoute | undefined {
  const destination = airport.routeLibrary.destinations.find(
    (row) => row.icao === scenario.destination,
  );
  if (destination?.nct !== true) return undefined;
  return airport.tecRoutes.find(
    (row) => keyedFor(row, ctx, destination) && usable(row, ctx, scenario, airport),
  );
}
