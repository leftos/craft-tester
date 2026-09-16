import airportsJson from '@data/airports.json';
import { parseAirport, parseAirportsIndex } from '@/data/load.ts';
import type { AirportData } from '@/data/schema.ts';

/** One checked-in airport: the identifier `data/airports.json` lists, and its validated data. */
export type CheckedInAirport = {
  icao: string;
  data: AirportData;
};

/** Every generated `data/*.json` document, keyed by its module path. */
const documents = import.meta.glob<unknown>('@data/*.json', {
  eager: true,
  import: 'default',
});

/**
 * Every airport `data/airports.json` lists, with its data file parsed against the schema.
 *
 * This is how tests and scripts enumerate the checked-in airports, so nothing keys on KSFO: a new
 * airport is a data file plus a line in the index, and every caller picks it up.
 *
 * @returns One entry per index line, in index order.
 * @throws Error When the index names a file that `data/` does not hold, or a file does not match
 *   the schema.
 */
export function checkedInAirports(): CheckedInAirport[] {
  const index = parseAirportsIndex(airportsJson);
  return index.map((entry) => {
    const found = Object.entries(documents).find(([path]) => path.endsWith(`/${entry.file}`));
    if (found === undefined) {
      throw new Error(`data/airports.json lists ${entry.file}, which is not a file in data/`);
    }
    return { icao: entry.icao, data: parseAirport(found[1]) };
  });
}
