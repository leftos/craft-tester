import type { EquipmentSuffix, TecRoute } from '@/data/schema.ts';
import { formatFeet } from '@/rules/grade.ts';
import type { RuleCitation } from '@/rules/types.ts';

/** The document the equipment suffix table is published in, quoted when a type box is amended. */
const SUFFIX_TABLE_SOURCE = 'FAA JO 7110.65 TBL 5-4-1';

/**
 * Cites a TEC route row, which is the one citable row that carries no `text` of its own.
 *
 * @param row The TEC route row the check read.
 * @returns The citation, with the row's own key facts written out as its text.
 */
export function citeTec(row: TecRoute): RuleCitation {
  const runways = row.runwayFamilies.length === 0 ? '' : ` ${row.runwayFamilies.join('/')}`;
  const cap =
    row.altitudeCapFeet === undefined ? '' : ` at or below ${formatFeet(row.altitudeCapFeet)}`;
  const keys = `${row.destination} ${row.plan}${runways} ${row.classes.join('/')}`;
  return { id: row.id, source: row.source, text: `${keys}: ${row.route}${cap}` };
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
