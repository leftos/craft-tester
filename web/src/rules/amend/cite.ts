import type { EquipmentSuffix } from '@/data/schema.ts';
import type { RuleCitation } from '@/rules/types.ts';

/** The document the equipment suffix table is published in, quoted when a type box is amended. */
const SUFFIX_TABLE_SOURCE = 'FAA JO 7110.65 TBL 2-3-10';

/**
 * Cites a row of the equipment suffix table, which carries its text but no id or source.
 *
 * @param row The suffix row the check proposed or rejected.
 * @returns The citation, keyed by the suffix itself.
 */
export function citeSuffix(row: EquipmentSuffix): RuleCitation {
  return { id: `EQUIP${row.suffix}`, source: SUFFIX_TABLE_SOURCE, text: row.text };
}
