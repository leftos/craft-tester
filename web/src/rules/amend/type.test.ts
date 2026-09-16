import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { checkRnavClash, checkSuffix } from '@/rules/amend/type.ts';
import { classify } from '@/rules/classify.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

const ksfo = ksfoJson as unknown as AirportData;

/**
 * A plan that files a conventional procedure, so the type box is the only thing in question: a
 * non-RNAV suffix filed against an RNAV procedure is the separate ambiguity the last suite covers.
 */
const BASE_SCENARIO: Scenario = {
  callsign: 'UAL1',
  aircraftType: 'B738',
  equipmentSuffix: '/L',
  destination: 'KSEA',
  filedRoute: 'SFO5 DEDHD RBL LMT HAWKZ7',
  filedAltitude: 34000,
  runwayConfigId: '28/01',
  departureRunway: '01R',
  localTime: '1400',
  dayOfWeek: 'tuesday',
  squawk: '1234',
};

function scenario(overrides: Partial<Scenario>): Scenario {
  return Object.assign({ ...BASE_SCENARIO }, overrides);
}

/** The airport data with one type taken out of the fleet, which leaves it nothing to propose. */
function withoutFleetType(type: string): AirportData {
  const { routeLibrary } = ksfo;
  return {
    ...ksfo,
    routeLibrary: {
      ...routeLibrary,
      fleet: routeLibrary.fleet.filter((row) => row.type !== type),
    },
  };
}

/** The suffix gap of a plan, which is the half of the type box every other box is judged behind. */
function suffixGap(flight: Scenario, airport: AirportData = ksfo) {
  const amendment = checkSuffix(flight, airport);
  if (amendment !== undefined && isUnresolved(amendment)) throw new Error(amendment.reason);
  return amendment;
}

/** The RNAV clash a plan raises, judged against the clearance that plan is read under. */
function clash(flight: Scenario, airport: AirportData = ksfo) {
  const ctx = classify(flight, airport);
  if (isUnresolved(ctx)) throw new Error(ctx.reason);
  const result = resolveClearance(flight, airport);
  if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
  return checkRnavClash(flight, ctx, result.clearance, airport);
}

describe('checkSuffix equipment suffix', () => {
  it('leaves a suffix the equipment table holds alone', () => {
    expect(suffixGap(scenario({}))).toBeUndefined();
  });

  it('proposes the suffix the fleet files when the plan filed none', () => {
    const amendment = suffixGap(scenario({ equipmentSuffix: null }));
    expect(amendment?.box).toBe('type');
    expect(amendment).toMatchObject({ proposed: 'B738/L' });
    expect(amendment?.reason).toContain('no equipment suffix filed');
    expect(amendment?.citations.map((citation) => citation.id)).toEqual(['EQUIP/L']);
  });

  it('proposes the suffix the fleet files when the plan filed one the table does not hold', () => {
    const flight = scenario({ aircraftType: 'B752', equipmentSuffix: '/Q' });
    const amendment = suffixGap(flight);
    expect(amendment).toMatchObject({ proposed: 'B752/L' });
    expect(amendment?.reason).toContain('suffix /Q is not in FAA JO 7110.65 Table 5-4-1');
  });

  it('reports the type box unresolved when the fleet does not list the type', () => {
    const flight = scenario({ equipmentSuffix: null });
    expect(checkSuffix(flight, withoutFleetType('B738'))).toEqual({
      element: 'BOX.type',
      reason: expect.stringContaining('B738'),
    });
  });
});

describe('checkRnavClash RNAV ambiguity', () => {
  it('offers an RNAV suffix to a non-RNAV flight that filed an RNAV procedure', () => {
    const flight = scenario({
      aircraftType: 'A320',
      equipmentSuffix: '/A',
      destination: 'KLAX',
      filedRoute: 'SSTIK5 YYUNG LAX COMIX2',
      departureRunway: '01L',
      filedAltitude: 33000,
    });
    const amendment = clash(flight);
    expect(amendment).toMatchObject({ box: 'type', proposed: 'A320/L' });
    expect(amendment?.reason).toContain('SSTIK5');
    expect(amendment?.citations.map((citation) => citation.id)).toEqual(['EQUIP/L']);
  });

  it('offers no RNAV suffix where the SOP assigns that plan another procedure anyway', () => {
    const flight = scenario({
      aircraftType: 'SR22',
      equipmentSuffix: '/A',
      destination: 'KMRY',
      filedRoute: 'SSTIK5 EUGEN',
      runwayConfigId: '01/01',
      departureRunway: '01L',
      filedAltitude: 3000,
      localTime: '0023',
    });
    expect(clash(flight)).toBeUndefined();
  });
});
