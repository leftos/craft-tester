import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { buildOptions } from '@/rules/options.ts';
import type { Procedure, ResolvedClearance } from '@/rules/types.ts';

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

/** A clearance issuing one procedure, which is all the option lists read off a clearance. */
function issuing(procedure: Procedure): ResolvedClearance {
  return {
    clearedTo: { value: BASE.destination, citations: [] },
    runway: { value: BASE.departureRunway, citations: [] },
    procedure: { value: procedure, citations: [] },
    route: { value: { template: 'as_filed' }, citations: [] },
    altitude: { value: { phrase: 'climb_via' }, citations: [] },
    expect: { value: null, citations: [] },
    redundantExpect: { value: null, citations: [] },
    frequency: { value: { value: '120.9', sectorId: 'richmond' }, citations: [] },
  };
}

/** The flight the SOP sends off without a procedure, which contributes no transitions of its own. */
const onHeading = issuing({
  kind: 'heading',
  heading: 'runway heading',
  turn: undefined,
  spoken: 'fly runway heading',
});

describe('buildOptions', () => {
  it('offers every route shape, altitude phrase, and expect clause', () => {
    const options = buildOptions(scenario({}), ksfo, onHeading);
    expect(options.routeTemplates).toEqual([
      'transition',
      'radar_vectors_fix',
      'radar_vectors_airway',
      'radar_vectors_direct',
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
    const { routeFixes } = buildOptions(
      scenario({ filedRoute: 'TRUKN2 DEDHD RBL LMT' }),
      ksfo,
      onHeading,
    );
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

  it('offers the transitions of the procedure the clearance issues, ahead of the filed route', () => {
    const issued = issuing({ kind: 'sid', id: 'TRUKN2', family: 'TRUKN', spoken: 'Trukn Two' });
    const { routeFixes } = buildOptions(scenario({ filedRoute: 'OAK V244 ALTAM' }), ksfo, issued);
    expect(routeFixes).toEqual([
      'DEDHD',
      'GRTFL',
      'MOGEE',
      'ORRCA',
      'SYRAH',
      'TIPRE',
      'OAK',
      'V244',
      'ALTAM',
    ]);
  });

  it('offers only the filed fixes when the filed SID is not published', () => {
    expect(
      buildOptions(scenario({ filedRoute: 'TRUKN9 DEDHD RBL LMT' }), ksfo, onHeading).routeFixes,
    ).toEqual(['DEDHD', 'RBL', 'LMT']);
  });

  it('keeps a filed route that has no procedure token', () => {
    const filedRoute = 'OAK V244 ALTAM V392 SAC';
    expect(buildOptions(scenario({ filedRoute }), ksfo, onHeading).routeFixes).toEqual([
      'OAK',
      'V244',
      'ALTAM',
    ]);
  });

  it('offers neither the heading nor RV of a vectors-direct route as a route fix', () => {
    expect(buildOptions(scenario({ filedRoute: 'RH RV' }), ksfo, onHeading).routeFixes).toEqual([]);
    expect(buildOptions(scenario({ filedRoute: 'H090 RV' }), ksfo, onHeading).routeFixes).toEqual(
      [],
    );
  });

  it('offers the airway a route joins straight off the SID as a route element', () => {
    const { routeFixes } = buildOptions(scenario({ filedRoute: 'SFO4 V6 SAC' }), ksfo, onHeading);
    expect(routeFixes).toEqual(['V6', 'SAC']);
  });

  it('offers the interim altitudes, the published top altitudes, and the filed altitude, sorted', () => {
    const { altitudeFeet } = buildOptions(scenario({ filedAltitude: 11000 }), ksfo, onHeading);
    expect(altitudeFeet).toEqual([3000, 5000, 10000, 11000, 15000, 19000]);
  });

  it('offers the labelled frequency pool', () => {
    const { frequencies } = buildOptions(scenario({}), ksfo, onHeading);
    expect(frequencies).toContain('120.9');
    expect(frequencies).toContain('135.1');
    expect(frequencies).toEqual(ksfo.frequencies.map((frequency) => frequency.value));
  });

  it("lists the configuration's runways, in the order the data rows them", () => {
    expect(buildOptions(scenario({}), ksfo, onHeading).runways).toEqual([
      '01L',
      '01R',
      '28L',
      '28R',
    ]);
    expect(buildOptions(scenario({ runwayConfigId: '19/19' }), ksfo, onHeading).runways).toEqual([
      '19L',
      '19R',
    ]);
  });

  it('offers no runway at all for a configuration the data does not carry', () => {
    expect(buildOptions(scenario({ runwayConfigId: '14/14' }), ksfo, onHeading).runways).toEqual(
      [],
    );
  });

  it('is deterministic', () => {
    expect(buildOptions(scenario({}), ksfo, onHeading)).toEqual(
      buildOptions(scenario({}), ksfo, onHeading),
    );
  });
});
