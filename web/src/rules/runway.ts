import type {
  AircraftClass,
  AirportData,
  Direction,
  RunwayConfig,
  Scenario,
} from '@/data/schema.ts';
import { citePhraseology } from '@/rules/cite.ts';
import { inAnyGroup } from '@/rules/classify.ts';
import { usableTecRouteOn } from '@/rules/tecRoutes.ts';
import type { Cited, RuleCitation } from '@/rules/types.ts';

/** An airline flight number: the three-letter ICAO code, the number, and an optional suffix. */
const AIRLINE_CALLSIGN = /^([A-Z]{3})(\d+)([A-Z]*)$/;

/**
 * The ICAO airline code a callsign carries, which is the prefix `routeLibrary.telephony` keys.
 *
 * @param callsign The flight's callsign.
 * @returns The three-letter code, or undefined when the callsign is a registration such as N483KA.
 */
export function airlineOf(callsign: string): string | undefined {
  return AIRLINE_CALLSIGN.exec(callsign)?.[1];
}

/** Whether the configuration departs this flight's airline from this runway before any draw. */
function isAirlineDefault(
  config: RunwayConfig,
  callsign: string,
  aircraftClass: AircraftClass,
  runway: string,
): boolean {
  const airline = airlineOf(callsign);
  if (airline === undefined) return false;
  return config.departureRunways.some(
    (row) =>
      row.runway === runway &&
      row.classes.includes(aircraftClass) &&
      row.defaultForAirlines.includes(airline),
  );
}

/** Whether the configuration departs this flight's aircraft group from this runway before any draw. */
function isGroupDefault(
  airport: AirportData,
  config: RunwayConfig,
  scenario: Scenario,
  aircraftClass: AircraftClass,
): boolean {
  return config.departureRunways.some(
    (row) =>
      row.runway === scenario.departureRunway &&
      row.classes.includes(aircraftClass) &&
      inAnyGroup(row.defaultForGroups, aircraftClass, scenario.aircraftType, airport),
  );
}

/** Whether the configuration departs this class from this runway before any draw. */
function isClassDefault(
  config: RunwayConfig,
  aircraftClass: AircraftClass,
  runway: string,
): boolean {
  return config.departureRunways.some(
    (row) => row.defaultForClasses.includes(aircraftClass) && row.runway === runway,
  );
}

/** Whether this runway is the one the class is issued only on request, e.g. the 28s of 28/01. */
function isOnRequest(config: RunwayConfig, aircraftClass: AircraftClass, runway: string): boolean {
  return config.departureRunways.some(
    (row) =>
      row.runway === runway && row.classes.includes(aircraftClass) && row.onRequestFor.length > 0,
  );
}

/** Whether the direction-of-turn table splits this runway's family onto this runway. */
function isDirectionPreference(
  airport: AirportData,
  config: RunwayConfig,
  runway: string,
  direction: Direction | undefined,
): boolean {
  if (direction === undefined) return false;
  const family = runway.slice(0, 2);
  return airport.directionRunwayPreference[config.plan]?.[direction]?.[family] === runway;
}

/**
 * The runway the configuration departs this flight from before any draw, in the precedence the
 * generator draws it: its airline's default, then its aircraft group's, then its class's.
 */
function defaultRunway(
  airport: AirportData,
  config: RunwayConfig,
  scenario: Scenario,
  aircraftClass: AircraftClass,
): string | undefined {
  const rows = config.departureRunways.filter((row) => row.classes.includes(aircraftClass));
  const airline = airlineOf(scenario.callsign);
  const byAirline =
    airline === undefined
      ? undefined
      : rows.find((row) => row.defaultForAirlines.includes(airline));
  const byGroup = rows.find((row) =>
    inAnyGroup(row.defaultForGroups, aircraftClass, scenario.aircraftType, airport),
  );
  const byClass = config.departureRunways.find((row) =>
    row.defaultForClasses.includes(aircraftClass),
  );
  return (byAirline ?? byGroup ?? byClass)?.runway;
}

/** Whether a TEC row is usable for the flight were it to depart this runway. */
function hasTecRoute(runway: string, scenario: Scenario, airport: AirportData): boolean {
  return usableTecRouteOn(runway, scenario, airport) !== undefined;
}

/**
 * Whether the draw moved the flight off the runway its airline, group or class defaults it to: the
 * default names another runway, which no TEC row is usable off, and a row is usable off this one.
 */
function movedOffDefault(
  airport: AirportData,
  config: RunwayConfig,
  scenario: Scenario,
  aircraftClass: AircraftClass,
): boolean {
  const runway = scenario.departureRunway;
  const byDefault = defaultRunway(airport, config, scenario, aircraftClass);
  if (byDefault === undefined || byDefault === runway) return false;
  return hasTecRoute(runway, scenario, airport) && !hasTecRoute(byDefault, scenario, airport);
}

/**
 * Whether the flight's TEC route explains a runway no default, request or direction does: a row is
 * usable off it, and some runway of the configuration listed for the class has none.
 */
function explainedByTec(
  airport: AirportData,
  config: RunwayConfig,
  scenario: Scenario,
  aircraftClass: AircraftClass,
): boolean {
  if (!hasTecRoute(scenario.departureRunway, scenario, airport)) return false;
  const listed = config.departureRunways
    .filter((row) => row.classes.includes(aircraftClass))
    .map((row) => row.runway);
  return [...new Set(listed)].some((runway) => !hasTecRoute(runway, scenario, airport));
}

/** The default the configuration departs the flight off this runway by, if one does. */
function defaultMechanismId(
  airport: AirportData,
  config: RunwayConfig,
  scenario: Scenario,
  aircraftClass: AircraftClass,
): string | undefined {
  const runway = scenario.departureRunway;
  if (isAirlineDefault(config, scenario.callsign, aircraftClass, runway)) {
    return 'RWY-AIRLINE-DEFAULT';
  }
  if (isGroupDefault(airport, config, scenario, aircraftClass)) return 'RWY-GROUP-DEFAULT';
  if (isClassDefault(config, aircraftClass, runway)) return 'RWY-CLASS-DEFAULT';
  return undefined;
}

/** The phraseology row of the first mechanism that yields the runway the scenario departs from. */
function mechanismId(
  airport: AirportData,
  config: RunwayConfig | undefined,
  scenario: Scenario,
  aircraftClass: AircraftClass,
  direction: Direction | undefined,
): string {
  const runway = scenario.departureRunway;
  if (config === undefined) return 'RWY-FIRST';
  if (movedOffDefault(airport, config, scenario, aircraftClass)) return 'RWY-TEC';
  const byDefault = defaultMechanismId(airport, config, scenario, aircraftClass);
  if (byDefault !== undefined) return byDefault;
  if (isOnRequest(config, aircraftClass, runway)) return 'RWY-ON-REQUEST';
  if (isDirectionPreference(airport, config, runway, direction)) return 'RWY-DIRECTION';
  return explainedByTec(airport, config, scenario, aircraftClass) ? 'RWY-TEC' : 'RWY-FIRST';
}

/**
 * Explains the runway the scenario departs from, citing the rows that produced it.
 *
 * The runway itself is the scenario's; what the engine adds is the configuration the field is on and
 * the mechanism that settled the runway within it, in the precedence the generator draws them: the
 * airline the configuration defaults to a runway, the aircraft group it defaults to a runway, the
 * class it defaults to a runway, the runway a flight is issued on request, the direction-of-turn
 * split of the family, and otherwise the single runway of the family. A flight's TEC route outranks
 * the defaults: where the draw moved the flight off its default to a runway its TEC departure is in
 * use from, or where only its TEC route explains the runway, `RWY-TEC` is cited.
 *
 * @param scenario The filed flight plan and the conditions it is cleared under.
 * @param airport The airport data, whose phraseology rows carry the mechanisms.
 * @param aircraftClass The class the flight was classified into.
 * @param direction The gate direction the assignment table reads the flight on: its TEC route's for a
 *   flight a TEC route begins on a departure or heading for, else its filed route's; undefined when
 *   the exit fix is not a gate.
 * @returns The departure runway with the configuration row and the mechanism row that decided it.
 */
export function explainRunway(
  scenario: Scenario,
  airport: AirportData,
  aircraftClass: AircraftClass,
  direction: Direction | undefined,
): Cited<string> {
  const runway = scenario.departureRunway;
  const config = airport.runwayConfigs.find((entry) => entry.id === scenario.runwayConfigId);
  const configCitations: RuleCitation[] =
    config === undefined ? [] : [{ id: config.id, source: config.source, text: config.name }];
  return {
    value: runway,
    citations: [
      ...configCitations,
      ...citePhraseology(airport, mechanismId(airport, config, scenario, aircraftClass, direction)),
    ],
  };
}
