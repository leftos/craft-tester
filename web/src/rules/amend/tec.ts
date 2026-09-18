import type { AirportData, TecRoute } from '@/data/schema.ts';
import { FAMILY_PLACEHOLDER, tecHead } from '@/rules/tecRoutes.ts';
import type { Unresolved } from '@/rules/types.ts';
import { unresolved } from '@/rules/unresolved.ts';

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
