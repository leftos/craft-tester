import type {
  AircraftClass,
  AirportData,
  Direction,
  RunwayConfig,
  Scenario,
} from '@/data/schema.ts';
import { citePhraseology } from '@/rules/cite.ts';
import type { Cited, RuleCitation } from '@/rules/types.ts';

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
  runway: string,
  aircraftClass: AircraftClass,
  direction: Direction | undefined,
): string {
  if (config === undefined) return 'RWY-FIRST';
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
 * class the configuration defaults to a runway, the runway a flight is issued on request, the
 * direction-of-turn split of the family, and otherwise the single runway of the family.
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
      ...citePhraseology(airport, mechanismId(airport, config, runway, aircraftClass, direction)),
    ],
  };
}
