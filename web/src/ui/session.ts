import airportsIndexJson from '@data/airports.json';
import type { AirportData, AirportsIndex, Scenario } from '@/data/schema.ts';
import { parseAirport, parseAirportsIndex } from '@/data/load.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { speakClearance } from '@/rules/speak.ts';
import type { SpokenClearance } from '@/rules/speak.ts';
import type { ResolvedClearance } from '@/rules/types.ts';
import type { ScenarioFilter } from '@/scenario/filter.ts';
import { generateScenario } from '@/scenario/generate.ts';
import { createRng } from '@/scenario/rng.ts';

/**
 * Every generated airport file, keyed by the path Vite resolved it from.
 *
 * The app is served as static files with no `data/` directory beside them, so the airport files are
 * bundled rather than fetched: the index is imported outright and each airport file is a chunk that
 * loads when the player picks that airport.
 */
const airportFiles = import.meta.glob<{ default: unknown }>([
  '@data/*.json',
  '!@data/airports.json',
]);

/** What one seed produced: a clearance to grade, or the reasons the engine could not issue one. */
export type ScenarioView =
  | { kind: 'clearance'; generated: Scenario; clearance: ResolvedClearance }
  | { kind: 'unresolved'; reasons: string[] };

/**
 * The airports the app can load, from the checked-in index.
 *
 * @returns The index of `data/airports.json`, validated against the schema.
 */
export function listAirports(): AirportsIndex {
  return parseAirportsIndex(airportsIndexJson);
}

/**
 * Loads one airport's generated data out of the bundle.
 *
 * @param icao The airport's ICAO identifier, e.g. `KSFO`.
 * @returns The validated airport data.
 * @throws Error When the index has no such airport, or its file was not bundled with the app.
 */
export async function loadAirportData(icao: string): Promise<AirportData> {
  const index = listAirports();
  const entry = index.find((candidate) => candidate.icao === icao);
  if (entry === undefined) {
    const known = index.map((candidate) => candidate.icao).join(', ');
    throw new Error(`airport ${icao} is not in airports.json; it lists ${known}`);
  }
  const path = Object.keys(airportFiles).find((key) => key.endsWith(`/${entry.file}`));
  const loader = path === undefined ? undefined : airportFiles[path];
  if (loader === undefined) {
    throw new Error(`data file ${entry.file} was not bundled with the app`);
  }
  return parseAirport((await loader()).default);
}

/** Renders a thrown value as the line the unresolved panel shows. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Draws the scenario one seed stands for and resolves the clearance the SOP issues for it.
 *
 * @param airport The airport data the scenario is drawn from.
 * @param seed The scenario seed, which the URL hash carries.
 * @param filter The time of day and runway configurations the draw is narrowed to.
 * @returns The scenario with its clearance, or the reasons no clearance could be issued.
 */
export function buildScenario(
  airport: AirportData,
  seed: number,
  filter: ScenarioFilter,
): ScenarioView {
  let generated: Scenario;
  try {
    generated = generateScenario(createRng(seed), airport, filter);
  } catch (error) {
    return { kind: 'unresolved', reasons: [reasonOf(error)] };
  }
  const result = resolveClearance(generated, airport);
  if (!result.ok) {
    return {
      kind: 'unresolved',
      reasons: result.unresolved.map((item) => `${item.element}: ${item.reason}`),
    };
  }
  return { kind: 'clearance', generated, clearance: result.clearance };
}

/** The spoken name of a destination, falling back to its identifier. */
function destinationSpoken(icao: string, airport: AirportData): string {
  return airport.routeLibrary.destinations.find((row) => row.icao === icao)?.spoken ?? icao;
}

/**
 * Reads a resolved clearance the way the reveal speaks it, abbreviated and with the full route.
 *
 * @param scenario The filed flight plan the clearance answers.
 * @param clearance The clearance the engine resolved for it.
 * @param airport The airport data, for the telephony, the spoken fixes, and the SID's transitions.
 * @returns Both spoken forms of the clearance.
 */
export function spokenFor(
  scenario: Scenario,
  clearance: ResolvedClearance,
  airport: AirportData,
): SpokenClearance {
  return speakClearance({
    callsign: scenario.callsign,
    clearance,
    destinationSpoken: destinationSpoken(scenario.destination, airport),
    filedRoute: scenario.filedRoute,
    airportFaa: airport.airport.faa,
    squawk: scenario.squawk,
    telephony: airport.routeLibrary.telephony,
    fixSpoken: airport.fixSpoken,
    sidTransitions:
      airport.sids.find((sid) => sid.id === clearance.sid.value.id)?.transitions ?? [],
  });
}
