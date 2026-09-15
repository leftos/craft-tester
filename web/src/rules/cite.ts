import type { AirportData } from '@/data/schema.ts';
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
