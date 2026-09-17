import type { EquipmentSuffix, TecRoute } from '@/data/schema.ts';
import { formatFeet } from '@/rules/grade.ts';
import type { RuleCitation } from '@/rules/types.ts';

/** The document the equipment suffix table is published in, quoted when a type box is amended. */
const SUFFIX_TABLE_SOURCE = 'FAA JO 7110.65 TBL 5-4-1';

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
  if (initial === undefined || initial === final) return ` at ${formatFeet(final)}`;
  return ` ${formatFeet(initial)} initial, ${formatFeet(final)} final`;
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

/**
 * Cites a row of the equipment suffix table, which carries its text but no id or source.
 *
 * @param row The suffix row the check proposed or rejected.
 * @returns The citation, keyed by the suffix itself.
 */
export function citeSuffix(row: EquipmentSuffix): RuleCitation {
  return { id: `EQUIP${row.suffix}`, source: SUFFIX_TABLE_SOURCE, text: row.text };
}
