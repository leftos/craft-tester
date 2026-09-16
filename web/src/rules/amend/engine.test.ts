import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { resolveAmendments } from '@/rules/amend/engine.ts';

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

  it('fails the whole result when a box the data cannot answer blocks one check', () => {
    const result = resolveAmendments(scenario({ destination: 'KZZZ' }), ksfo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unresolved.map((item) => item.element)).toContain('BOX.altitude');
  });
});
