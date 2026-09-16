import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { buildOptions } from '@/rules/options.ts';

const ksfo = ksfoJson as unknown as AirportData;

const BASE: Scenario = {
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
  return Object.assign({ ...BASE }, overrides);
}

describe('buildOptions', () => {
  it('offers every route shape, altitude phrase, and expect clause', () => {
    const options = buildOptions(scenario({}), ksfo);
    expect(options.routeTemplates).toEqual([
      'transition',
      'radar_vectors_fix',
      'radar_vectors_airway',
      'as_filed',
    ]);
    expect(options.altitudePhrases).toEqual(['climb_via', 'climb_via_except', 'maintain']);
    expect(options.expect).toEqual([
      'ten_minutes',
      'five_minutes',
      'three_minutes',
      'final',
      'none',
    ]);
  });

  it('offers the filed SID transitions and the head of the filed route as route fixes', () => {
    const { routeFixes } = buildOptions(scenario({ filedRoute: 'TRUKN2 DEDHD RBL LMT' }), ksfo);
    expect(routeFixes).toEqual([
      'DEDHD',
      'GRTFL',
      'MOGEE',
      'ORRCA',
      'SYRAH',
      'TIPRE',
      'RBL',
      'LMT',
    ]);
  });

  it('offers only the filed fixes when the filed SID is not published', () => {
    expect(buildOptions(scenario({ filedRoute: 'TRUKN9 DEDHD RBL LMT' }), ksfo).routeFixes).toEqual(
      ['DEDHD', 'RBL', 'LMT'],
    );
  });

  it('keeps a filed route that has no procedure token', () => {
    const filedRoute = 'OAK V244 ALTAM V392 SAC';
    expect(buildOptions(scenario({ filedRoute }), ksfo).routeFixes).toEqual([
      'OAK',
      'V244',
      'ALTAM',
    ]);
  });

  it('offers the airway a route joins straight off the SID as a route element', () => {
    const { routeFixes } = buildOptions(scenario({ filedRoute: 'SFO4 V6 SAC' }), ksfo);
    expect(routeFixes).toEqual(['V6', 'SAC']);
  });

  it('offers the interim altitudes, the published top altitudes, and the filed altitude, sorted', () => {
    const { altitudeFeet } = buildOptions(scenario({ filedAltitude: 11000 }), ksfo);
    expect(altitudeFeet).toEqual([3000, 5000, 10000, 11000, 15000, 19000]);
  });

  it('offers the labelled frequency pool', () => {
    const { frequencies } = buildOptions(scenario({}), ksfo);
    expect(frequencies).toContain('120.9');
    expect(frequencies).toContain('135.1');
    expect(frequencies).toEqual(ksfo.frequencies.map((frequency) => frequency.value));
  });

  it("lists the configuration's runways, in the order the data rows them", () => {
    expect(buildOptions(scenario({}), ksfo).runways).toEqual(['01L', '01R', '28L', '28R']);
    expect(buildOptions(scenario({ runwayConfigId: '19/19' }), ksfo).runways).toEqual([
      '19L',
      '19R',
    ]);
  });

  it('offers no runway at all for a configuration the data does not carry', () => {
    expect(buildOptions(scenario({ runwayConfigId: '14/14' }), ksfo).runways).toEqual([]);
  });

  it('is deterministic', () => {
    expect(buildOptions(scenario({}), ksfo)).toEqual(buildOptions(scenario({}), ksfo));
  });
});
