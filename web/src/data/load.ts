import type { z } from 'zod';
import { AirportDataSchema, AirportsIndexSchema } from '@/data/schema.ts';
import type { AirportData, AirportsIndex } from '@/data/schema.ts';

/** Where the generated data files sit, relative to the app's base URL. */
const DATA_DIRECTORY = 'data/';

/** The index that maps an ICAO identifier to its generated file. */
const INDEX_FILE = 'airports.json';

/** Renders zod issues as one indented line each, so a schema failure names every bad field. */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/** Fetches one JSON document, failing with the status when the file is not served. */
async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`could not load ${url}: ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

/**
 * Parses a generated airport file against the schema.
 *
 * @param json The parsed JSON of `data/<icao>.json`.
 * @returns The validated airport data.
 * @throws Error When the document does not match the schema, listing every zod issue.
 */
export function parseAirport(json: unknown): AirportData {
  const result = AirportDataSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`airport data does not match the schema:\n${formatIssues(result.error)}`);
  }
  return result.data;
}

/**
 * Parses the airports index against the schema.
 *
 * @param json The parsed JSON of `data/airports.json`.
 * @returns The validated index.
 * @throws Error When the document does not match the schema, listing every zod issue.
 */
export function parseAirportsIndex(json: unknown): AirportsIndex {
  const result = AirportsIndexSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`airports index does not match the schema:\n${formatIssues(result.error)}`);
  }
  return result.data;
}

/**
 * Loads one airport's generated data over HTTP: the index first, then the file it names.
 *
 * @param icao The airport's ICAO identifier, e.g. `KSFO`.
 * @returns The validated airport data.
 * @throws Error When a file is missing, does not parse, or the index has no such airport.
 */
export async function loadAirport(icao: string): Promise<AirportData> {
  const base = `${import.meta.env.BASE_URL}${DATA_DIRECTORY}`;
  const index = parseAirportsIndex(await fetchJson(`${base}${INDEX_FILE}`));
  const entry = index.find((candidate) => candidate.icao === icao);
  if (entry === undefined) {
    const known = index.map((candidate) => candidate.icao).join(', ');
    throw new Error(`airport ${icao} is not in ${INDEX_FILE}; it lists ${known}`);
  }
  return parseAirport(await fetchJson(`${base}${entry.file}`));
}
