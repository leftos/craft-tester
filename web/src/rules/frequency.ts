import type { AirportData, AssignmentRule } from '@/data/schema.ts';
import { toCitation } from '@/rules/cite.ts';
import type { Cited, Unresolved } from '@/rules/types.ts';
import { unresolved } from '@/rules/unresolved.ts';

/**
 * Resolves the departure frequency from the sector the assignment row hands off to.
 *
 * @param row The assignment row that selected the SID; it names the sector.
 * @param airport The airport data, whose `departureSectors` carry the frequencies.
 * @returns The frequency with its sector, cited from the row and the sector entry, or
 *   `Unresolved` when the row names a sector the data does not staff.
 */
export function resolveFrequency(
  row: AssignmentRule,
  airport: AirportData,
): Cited<{ value: string; sectorId: string }> | Unresolved {
  const sector = airport.departureSectors.find((entry) => entry.id === row.sector);
  if (sector === undefined) {
    return unresolved(
      'F',
      `assignment rule ${row.id} names sector ${row.sector}, which has no frequency in the data`,
    );
  }
  return {
    value: { value: sector.frequency, sectorId: sector.id },
    citations: [
      toCitation(row),
      { id: sector.id, source: 'departureSectors', text: `${sector.name} ${sector.frequency}` },
    ],
  };
}
