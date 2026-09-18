import type { AirportData, TecRoute } from '@/data/schema.ts';
import { formatAltitude } from '@/rules/grade.ts';
import type { RuleCitation } from '@/rules/types.ts';

/** Any data row that carries the three fields a citation shows. */
type CitableRow = {
  id: string;
  source: string;
  text: string;
};

/**
 * Turns a data row into the citation the results view quotes.
 *
 * @param row An assignment rule, altitude rule, notice, or phraseology rule.
 * @returns The citation for that row.
 */
export function toCitation(row: CitableRow): RuleCitation {
  return { id: row.id, source: row.source, text: row.text };
}

/**
 * Cites phraseology rows by id, skipping ids the airport data does not carry.
 *
 * @param airport The airport data whose `phraseologyRules` hold the quotable rows.
 * @param ids The rule ids the engine decided with, e.g. `R-TRANSITION`.
 * @returns One citation per id that exists, in the order the ids were given.
 */
export function citePhraseology(airport: AirportData, ...ids: string[]): RuleCitation[] {
  return ids
    .map((id) => airport.phraseologyRules.find((rule) => rule.id === id))
    .filter((rule) => rule !== undefined)
    .map(toCitation);
}

/**
 * The altitudes a TEC row publishes, written the way the tool prints them.
 *
 * A row whose initial altitude is its final one, and a row that publishes no initial at all, read
 * as the single altitude; a row that climbs from one to the other names both.
 *
 * @param row The TEC route row being cited.
 * @returns The trailing altitude text, empty on a row that publishes no altitude.
 */
function altitudes(row: TecRoute): string {
  const { initialAltitudeFeet: initial, finalAltitudeFeet: final } = row;
  if (final === undefined) return '';
  if (initial === undefined || initial === final) return ` at ${formatAltitude(final)}`;
  return ` ${formatAltitude(initial)} initial, ${formatAltitude(final)} final`;
}

/**
 * Cites a TEC route row, which is the one citable row that carries no `text` of its own.
 *
 * @param row The TEC route row the check read.
 * @returns The citation, with the row's own key facts written out as its text.
 */
export function citeTec(row: TecRoute): RuleCitation {
  const runways = row.runwayFamilies.length === 0 ? '' : ` ${row.runwayFamilies.join('/')}`;
  const keys = `${row.destination} ${row.plan}${runways} ${row.classes.join('/')}`;
  return { id: row.id, source: row.source, text: `${keys}: ${row.route}${altitudes(row)}` };
}
