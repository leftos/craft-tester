import { describe, expect, it } from 'vitest';
import { ExpectedClearanceSchema } from '@/data/schema.ts';
import { toExpectedClearance } from '@/rules/types.ts';
import type { Procedure, ResolvedClearance, RuleCitation } from '@/rules/types.ts';

const citation: RuleCitation = {
  id: 'SFOW-N-TRUKN-01',
  source: 'SFO ATCT SOP 2-2 a',
  text: 'Northbound, runway 01, T/J -> TRUKN#',
};

const resolved: ResolvedClearance = {
  clearedTo: { value: 'KSEA', citations: [citation] },
  runway: { value: '01R', citations: [citation] },
  procedure: {
    value: { kind: 'sid', id: 'TRUKN2', family: 'TRUKN', spoken: 'Trukn Two' },
    citations: [citation],
  },
  route: { value: { template: 'transition', fix: 'DEDHD' }, citations: [citation] },
  altitude: { value: { phrase: 'climb_via_except', feet: 10000 }, citations: [citation] },
  expect: { value: { kind: 'filed', feet: 35000, minutes: 10 }, citations: [citation] },
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

  /** A clearance the SOP issues without a DP, flown on the heading its row names. */
  function onTheHeading(procedure: Extract<Procedure, { kind: 'heading' }>): ResolvedClearance {
    return {
      ...resolved,
      procedure: { value: procedure, citations: [citation] },
      route: { value: { template: 'radar_vectors_fix', fix: 'OAK' }, citations: [citation] },
      altitude: { value: { phrase: 'maintain', feet: 5000 }, citations: [citation] },
    };
  }

  it('writes a null family and the heading for a clearance issued without a DP', () => {
    const flattened = toExpectedClearance(
      onTheHeading({
        kind: 'heading',
        heading: 'runway heading',
        turn: undefined,
        spoken: 'fly runway heading',
      }),
    );
    expect(flattened.sidFamily).toBeNull();
    expect(flattened.heading).toBe('runway heading');
    expect(ExpectedClearanceSchema.parse(flattened)).toEqual(flattened);
  });

  it('writes the degrees of a numbered heading', () => {
    const flattened = toExpectedClearance(
      onTheHeading({
        kind: 'heading',
        heading: 270,
        turn: 'left',
        spoken: 'turn left heading 270',
      }),
    );
    expect(flattened.sidFamily).toBeNull();
    expect(flattened.heading).toBe(270);
    expect(ExpectedClearanceSchema.parse(flattened)).toEqual(flattened);
  });

  it('produces a value the fixture schema accepts', () => {
    expect(ExpectedClearanceSchema.parse(toExpectedClearance(resolved))).toEqual(
      toExpectedClearance(resolved),
    );
  });
});
