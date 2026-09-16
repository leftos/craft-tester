import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { resolveAmendedClearance, resolveAmendments } from '@/rules/amend/engine.ts';
import { resolveClearance } from '@/rules/engine.ts';

const ksfo = ksfoJson as unknown as AirportData;

const BASE_SCENARIO: Scenario = {
  callsign: 'UAL1',
  aircraftType: 'B738',
  equipmentSuffix: '/L',
  destination: 'KSEA',
  filedRoute: 'TRUKN2 DEDHD RBL LMT HAWKZ7',
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

function resolved(flight: Scenario) {
  const result = resolveAmendments(flight, ksfo);
  if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
  return result;
}

/** The worksheet plan whose non-RNAV suffix, RVSM altitude and RNAV procedure are all wrong. */
function ual313(): Scenario {
  return scenario({
    callsign: 'UAL313',
    aircraftType: 'B752',
    equipmentSuffix: '/Q',
    destination: 'KSLC',
    filedRoute: 'TRUKN2 MOGEE BVLQ124 BVL WAATS5',
    filedAltitude: 33000,
    runwayConfigId: '28 RT',
    departureRunway: '28L',
  });
}

function cleared(flight: Scenario) {
  const result = resolveClearance(flight, ksfo);
  if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
  return result.clearance;
}

describe('resolveAmendments', () => {
  it('amends nothing on a plan filed as the SOP and the letters of agreement want it', () => {
    const flight = scenario({});
    const result = resolved(flight);
    expect(result.amendments).toEqual([]);
    expect(result.corrected).toEqual(flight);
  });

  it('amends the altitude and the route of a stale procedure filed at an illegal level', () => {
    const flight = scenario({
      filedRoute: 'TRUKN1 DEDHD RBL LMT HAWKZ7',
      filedAltitude: 33000,
    });
    const result = resolved(flight);
    expect(result.amendments.map((amendment) => amendment.box)).toEqual(['altitude', 'route']);
    expect(result.corrected).toEqual(
      scenario({ filedRoute: 'TRUKN2 DEDHD RBL LMT HAWKZ7', filedAltitude: 32000 }),
    );
  });

  it('collapses the two type proposals of an RNAV clash and pairs the one left with the route', () => {
    const result = resolved(ual313());
    expect(result.amendments.map((amendment) => [amendment.box, amendment.alternativeTo])).toEqual([
      ['type', 'route'],
      ['altitude', undefined],
      ['route', 'type'],
    ]);
    const [type] = result.amendments;
    if (type?.box !== 'type') throw new Error('the first amendment is not the type box');
    expect(type.proposed).toBe('B752/L');
    expect(type.reason).toContain('suffix /Q is not in');
    expect(type.reason).toContain('an RNAV suffix would keep the filed TRUKN2');
    expect(type.citations.map((citation) => citation.id)).toEqual(['EQUIP/L']);
  });

  it('fails the whole result when a box the data cannot answer blocks one check', () => {
    const result = resolveAmendments(scenario({ destination: 'KZZZ' }), ksfo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unresolved.map((item) => item.element)).toContain('BOX.altitude');
  });
});

describe('resolveAmendedClearance', () => {
  it('speaks the amended altitude in the expect clause when the altitude box was amended', () => {
    const original = ual313();
    const { corrected } = resolved(original);
    expect(corrected.filedAltitude).toBe(27000);
    const result = resolveAmendedClearance(original, corrected, ksfo);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.clearance.expect.value).toEqual({ feet: 27000, minutes: 10, amended: true });
    expect(result.clearance.expect.citations.map((citation) => citation.id)).toEqual([
      'A-EXPECT-AMENDED',
    ]);
  });

  it('leaves the expect clause of a plan whose altitude was not amended alone', () => {
    const original = scenario({ filedRoute: 'TRUKN1 DEDHD RBL LMT HAWKZ7' });
    const { corrected } = resolved(original);
    expect(corrected.filedAltitude).toBe(original.filedAltitude);
    const result = resolveAmendedClearance(original, corrected, ksfo);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.clearance.expect).toEqual(cleared(corrected).expect);
    expect(result.clearance.expect.value).toBeNull();
  });
});
