import { describe, expect, it } from 'vitest';
import { ExpectedClearanceSchema } from '@/data/schema.ts';
import { toExpectedClearance } from '@/rules/types.ts';
import type { ResolvedClearance, RuleCitation } from '@/rules/types.ts';

const citation: RuleCitation = {
  id: 'SFOW-N-TRUKN-01',
  source: 'SFO ATCT SOP 2-2 a',
  text: 'Northbound, runway 01, T/J -> TRUKN#',
};

const resolved: ResolvedClearance = {
  clearedTo: { value: 'KSEA', citations: [citation] },
  runway: { value: '01R', citations: [citation] },
  sid: {
    value: { id: 'TRUKN2', family: 'TRUKN', spoken: 'Trukn Two' },
    citations: [citation],
  },
  route: { value: { template: 'transition', fix: 'DEDHD' }, citations: [citation] },
  altitude: { value: { phrase: 'climb_via_except', feet: 10000 }, citations: [citation] },
  expect: { value: { feet: 35000, minutes: 10, amended: false }, citations: [citation] },
  redundantExpect: { value: null, citations: [] },
  frequency: { value: { value: '120.9', sectorId: 'richmond' }, citations: [citation] },
};

describe('toExpectedClearance', () => {
  it('flattens a resolved clearance into the fixture shape', () => {
    expect(toExpectedClearance(resolved)).toEqual({
      clearedTo: 'KSEA',
      sidFamily: 'TRUKN',
      route: { template: 'transition', fix: 'DEDHD' },
      altitude: { phrase: 'climb_via_except', feet: 10000 },
      expect: { feet: 35000, minutes: 10 },
      frequency: '120.9',
    });
  });

  it('omits the optional fix and feet and keeps a null expect', () => {
    const plain: ResolvedClearance = {
      ...resolved,
      route: { value: { template: 'as_filed' }, citations: [] },
      altitude: { value: { phrase: 'climb_via' }, citations: [] },
      expect: { value: null, citations: [] },
    };
    const flattened = toExpectedClearance(plain);
    expect(Object.keys(flattened.route)).toEqual(['template']);
    expect(Object.keys(flattened.altitude)).toEqual(['phrase']);
    expect(flattened.expect).toBeNull();
  });

  it('produces a value the fixture schema accepts', () => {
    expect(ExpectedClearanceSchema.parse(toExpectedClearance(resolved))).toEqual(
      toExpectedClearance(resolved),
    );
  });
});
