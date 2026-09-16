import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { checkType } from '@/rules/amend/type.ts';
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

function check(flight: Scenario, airport: AirportData = ksfo) {
  const ctx = classify(flight, airport);
  if (isUnresolved(ctx)) throw new Error(ctx.reason);
  const result = resolveClearance(flight, airport);
  if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
  return checkType(flight, ctx, result.clearance, airport);
}

function amendments(flight: Scenario, airport: AirportData = ksfo) {
  const result = check(flight, airport);
  if (isUnresolved(result)) throw new Error(result.reason);
  return result;
}

describe('checkType equipment suffix', () => {
  it('leaves a suffix the equipment table holds alone', () => {
    expect(amendments(scenario({}))).toEqual([]);
  });

  it('proposes the suffix the fleet files when the plan filed none', () => {
    const [amendment, ...rest] = amendments(scenario({ equipmentSuffix: null }));
    expect(rest).toEqual([]);
    expect(amendment?.box).toBe('type');
    expect(amendment).toMatchObject({ proposed: 'B738/L' });
    expect(amendment?.reason).toContain('no equipment suffix filed');
    expect(amendment?.citations.map((citation) => citation.id)).toEqual(['EQUIP/L']);
  });

  it('proposes the suffix the fleet files when the plan filed one the table does not hold', () => {
    const flight = scenario({ aircraftType: 'B752', equipmentSuffix: '/Q' });
    const [amendment, ...rest] = amendments(flight);
    expect(rest).toEqual([]);
    expect(amendment).toMatchObject({ proposed: 'B752/L' });
    expect(amendment?.reason).toContain('suffix /Q is not in FAA JO 7110.65 Table 5-4-1');
  });

  it('reports the type box unresolved when the fleet does not list the type', () => {
    const flight = scenario({ equipmentSuffix: null });
    expect(check(flight, withoutFleetType('B738'))).toEqual({
      element: 'BOX.type',
      reason: expect.stringContaining('B738'),
    });
  });
});

describe('checkType RNAV ambiguity', () => {
  it('offers an RNAV suffix to a non-RNAV flight that filed an RNAV procedure', () => {
    const flight = scenario({
      aircraftType: 'A320',
      equipmentSuffix: '/A',
      destination: 'KLAX',
      filedRoute: 'SSTIK5 YYUNG LAX COMIX2',
      departureRunway: '01L',
      filedAltitude: 33000,
    });
    const [amendment, ...rest] = amendments(flight);
    expect(rest).toEqual([]);
    expect(amendment).toMatchObject({ box: 'type', proposed: 'A320/L' });
    expect(amendment?.reason).toContain('SSTIK5');
    expect(amendment?.citations.map((citation) => citation.id)).toEqual(['EQUIP/L']);
  });
});
