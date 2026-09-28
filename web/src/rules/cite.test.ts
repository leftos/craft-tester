import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData } from '@/data/schema.ts';
import { citePhraseology, toCitation } from '@/rules/cite.ts';

const ksfo = ksfoJson as unknown as AirportData;

describe('toCitation', () => {
  it('keeps only the three fields the results view quotes', () => {
    const row = ksfo.assignmentRules[0];
    if (row === undefined) throw new Error('the data has no assignment rules');
    expect(toCitation(row)).toEqual({ id: row.id, source: row.source, text: row.text });
  });
});

describe('citePhraseology', () => {
  it('cites the rows the ids name, in the order they were asked for', () => {
    expect(citePhraseology(ksfo, 'A-CLIMB-VIA', 'A-EXPECT').map((row) => row.id)).toEqual([
      'A-CLIMB-VIA',
      'A-EXPECT',
    ]);
  });

  it('skips an id the data does not carry rather than citing a hole', () => {
    expect(citePhraseology(ksfo, 'A-NOT-A-RULE', 'C-DEST').map((row) => row.id)).toEqual([
      'C-DEST',
    ]);
  });

  it('cites nothing when asked for nothing', () => {
    expect(citePhraseology(ksfo)).toEqual([]);
  });
});
