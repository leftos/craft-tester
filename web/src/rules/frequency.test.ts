import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, AssignmentRule } from '@/data/schema.ts';
import { resolveFrequency } from '@/rules/frequency.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

const ksfo = ksfoJson as unknown as AirportData;

const row: AssignmentRule = {
  id: 'SFOW-N-TRUKN-01',
  source: 'SFO ATCT SOP 2-2 a',
  text: 'Northbound, runway 01, T/J -> TRUKN#',
  plan: 'SFOW',
  direction: 'north',
  runwayFamilies: ['01'],
  classes: ['T', 'J'],
  sidFamily: 'TRUKN',
  sector: 'richmond',
};

describe('resolveFrequency', () => {
  it('reads the sector the assignment row hands off to', () => {
    const result = resolveFrequency(row, ksfo);
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.value).toEqual({ value: '120.9', sectorId: 'richmond' });
    expect(result.citations.map((citation) => citation.id)).toEqual([
      'SFOW-N-TRUKN-01',
      'richmond',
    ]);
    expect(result.citations[1]?.text).toBe('NorCal Richmond 120.9');
  });

  it('reads the other staffed sector', () => {
    const result = resolveFrequency({ ...row, sector: 'sutro' }, ksfo);
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.value).toEqual({ value: '135.1', sectorId: 'sutro' });
  });

  it('blocks the frequency element when the sector is not staffed in the data', () => {
    expect(resolveFrequency({ ...row, sector: 'grizzly' }, ksfo)).toEqual({
      element: 'F',
      reason: expect.stringContaining('grizzly'),
    });
  });
});
