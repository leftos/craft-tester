import type {
  AircraftClass,
  AirportData,
  Direction,
  RunwayConfig,
  Scenario,
} from '@/data/schema.ts';
import { citePhraseology } from '@/rules/cite.ts';
import { inAnyGroup } from '@/rules/classify.ts';
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
  if (isAirlineDefault(config, scenario.callsign, aircraftClass, runway)) {
    return 'RWY-AIRLINE-DEFAULT';
  }
  if (isGroupDefault(airport, config, scenario, aircraftClass)) return 'RWY-GROUP-DEFAULT';
  if (isClassDefault(config, aircraftClass, runway)) return 'RWY-CLASS-DEFAULT';
  if (isOnRequest(config, aircraftClass, runway)) return 'RWY-ON-REQUEST';
  if (isDirectionPreference(airport, config, runway, direction)) return 'RWY-DIRECTION';
  return 'RWY-FIRST';
}

/**
 * Explains the runway the scenario departs from, citing the rows that produced it.
 *
 * The runway itself is the scenario's; what the engine adds is the configuration the field is on and
 * the mechanism that settled the runway within it, in the precedence the generator draws them: the
 * airline the configuration defaults to a runway, the aircraft group it defaults to a runway, the
 * class it defaults to a runway, the runway a flight is issued on request, the direction-of-turn
 * split of the family, and otherwise the single runway of the family.
 *
 * @param scenario The filed flight plan and the conditions it is cleared under.
 * @param airport The airport data, whose phraseology rows carry the mechanisms.
 * @param aircraftClass The class the flight was classified into.
 * @param direction The gate direction of the exit fix, or undefined when the fix is not a gate.
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
