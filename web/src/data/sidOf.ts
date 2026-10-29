import type { AirportData, Sid } from '@/data/schema.ts';

/**
 * The SID an airport publishes for a family, whatever version the current cycle carries.
 *
 * Tests name a procedure by family (`OAK`) and read its id and spoken name from data, so an AIRAC
 * cycle that reissues the procedure does not break them.
 *
 * @param airport The airport's data.
 * @param family The versionless procedure name, e.g. `OAK`.
 * @returns The airport's SID of that family.
 * @throws Error When the airport publishes no SID of that family.
 */
export function sidOf(airport: AirportData, family: string): Sid {
  const sid = airport.sids.find((candidate) => candidate.family === family);
  if (sid === undefined) {
    throw new Error(`${family}: no SID of that family in this airport's data`);
  }
  return sid;
}
