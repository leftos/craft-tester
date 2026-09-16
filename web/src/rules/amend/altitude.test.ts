import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, LoaRule, Scenario } from '@/data/schema.ts';
import { checkAltitude } from '@/rules/amend/altitude.ts';
import { classify } from '@/rules/classify.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

const ksfo = ksfoJson as unknown as AirportData;

const BASE_SCENARIO: Scenario = {
  callsign: 'UAL1',
  aircraftType: 'B738',
  equipmentSuffix: '/L',
  destination: 'KSEA',
  filedRoute: 'TRUKN2 DEDHD',
  filedAltitude: 34000,
  runwayConfigId: '28/01',
  departureRunway: '01R',
  localTime: '1400',
  dayOfWeek: 'tuesday',
  squawk: '1234',
};

/** An LOA row that forces even altitudes to Boise whatever the course, which is 022 magnetic. */
const EVEN_TO_BOISE: LoaRule = {
  id: 'LOA-TEST-EVEN',
  source: 'test',
  text: 'Boise arrivals from the Bay are assigned even altitudes',
  destinations: ['KBOI'],
  rule: { kind: 'even' },
};

function scenario(overrides: Partial<Scenario>): Scenario {
  return Object.assign({ ...BASE_SCENARIO }, overrides);
}

function withLoa(row: LoaRule): AirportData {
  return { ...ksfo, loaRules: [row, ...ksfo.loaRules] };
}

function check(flight: Scenario, airport: AirportData = ksfo) {
  const ctx = classify(flight, airport);
  if (isUnresolved(ctx)) throw new Error(ctx.reason);
  return checkAltitude(flight, ctx, airport);
}

function amendment(flight: Scenario, airport: AirportData = ksfo) {
  const result = check(flight, airport);
  if (result === undefined) throw new Error('the filed altitude is legal');
  if (isUnresolved(result)) throw new Error(result.reason);
  if (result.box !== 'altitude') throw new Error(`the check amended the ${result.box} box`);
  return result;
}

function citations(flight: Scenario, airport: AirportData = ksfo): string[] {
  return amendment(flight, airport).citations.map((citation) => citation.id);
}

describe('checkAltitude parity', () => {
  it('steps an odd flight level to Seattle down to the even one the ZSE LOA rotation wants', () => {
    const flight = scenario({ destination: 'KSEA', filedAltitude: 33000 });
    expect(amendment(flight).proposedFeet).toBe(32000);
    expect(amendment(flight).reason).toBe(
      'filed FL330 on a 346° magnetic course to Seattle needs an even level under LOA-ZSE-PARITY; the highest legal altitude at or below it is FL320',
    );
    expect(citations(flight)).toEqual(['A-PARITY', 'LOA-ZSE-PARITY']);
  });

  it('leaves an even flight level to Seattle alone', () => {
    expect(check(scenario({ destination: 'KSEA', filedAltitude: 34000 }))).toBeUndefined();
  });

  it('leaves an odd flight level to Salt Lake City alone, on a 051 magnetic course', () => {
    expect(check(scenario({ destination: 'KSLC', filedAltitude: 33000 }))).toBeUndefined();
  });

  it('proposes FL410 for FL430 to Denver, which is the even series on an odd-side course', () => {
    const flight = scenario({ aircraftType: 'B77L', destination: 'KDEN', filedAltitude: 43000 });
    expect(amendment(flight).proposedFeet).toBe(41000);
    expect(citations(flight)).toEqual(['A-PARITY']);
  });

  it('follows an LOA row that forces even altitudes whatever the course', () => {
    const flight = scenario({ destination: 'KBOI', filedAltitude: 33000 });
    const airport = withLoa(EVEN_TO_BOISE);
    expect(amendment(flight, airport).proposedFeet).toBe(32000);
    expect(citations(flight, airport)).toEqual(['A-PARITY', 'LOA-TEST-EVEN']);
  });
});

describe('checkAltitude equipment and performance', () => {
  it('steps a non-RVSM flight below the RVSM band, onto the parity its course wants', () => {
    const flight = scenario({
      destination: 'KSLC',
      filedAltitude: 33000,
      equipmentSuffix: '/A',
    });
    expect(amendment(flight).proposedFeet).toBe(27000);
    expect(citations(flight)).toEqual(['A-RVSM']);
  });

  it('holds a B737 at its service ceiling', () => {
    const flight = scenario({ aircraftType: 'B737', destination: 'KBOI', filedAltitude: 43000 });
    expect(amendment(flight).proposedFeet).toBe(41000);
    expect(citations(flight)).toEqual(['A-PARITY', 'FLEET-B737']);
  });
});

describe('checkAltitude TRACON destinations', () => {
  it('caps a C172 to Rio Vista at the TEC route altitude off the 01s', () => {
    const flight = scenario({
      aircraftType: 'C172',
      equipmentSuffix: '/G',
      destination: 'O88',
      filedAltitude: 10000,
    });
    expect(amendment(flight).proposedFeet).toBe(5000);
    expect(citations(flight)).toEqual(['A-PARITY', 'TEC-O88-SFOW-TP-01']);
  });

  it('leaves 3,000 to Oakland alone, which is the TEC cap and odd like its 036 course', () => {
    expect(check(scenario({ destination: 'KOAK', filedAltitude: 3000 }))).toBeUndefined();
  });

  it('caps nothing when the TEC route begins on a DP the flight is not assigned', () => {
    const vectored = {
      aircraftType: 'BE20',
      equipmentSuffix: '/A',
      destination: 'KSMF',
      filedRoute: 'GAPP7 TRUKN FEVTA FEVTA1',
      departureRunway: '28R',
    };
    expect(check(scenario({ ...vectored, filedAltitude: 9000 }))).toBeUndefined();
    expect(check(scenario({ ...vectored, filedAltitude: 15000 }))).toBeUndefined();
  });

  it('does not fall through to another row when the row that routes the flight has no cap', () => {
    const flight = scenario({
      aircraftType: 'B350',
      destination: 'KSAC',
      filedRoute: 'TRUKN2 ORRCA',
      filedAltitude: 12000,
    });
    const result = check(flight);
    if (result !== undefined && isUnresolved(result)) throw new Error(result.reason);
    const cited = result === undefined ? [] : result.citations.map((citation) => citation.id);
    expect(cited.filter((id) => id.startsWith('TEC-'))).toEqual([]);
  });
});

describe('checkAltitude unresolved', () => {
  it('reports the altitude box unresolved when the destination is not in the route library', () => {
    const result = check(scenario({ destination: 'KZZZ' }));
    expect(result).toEqual({
      element: 'BOX.altitude',
      reason: expect.stringContaining('KZZZ'),
    });
  });
});
