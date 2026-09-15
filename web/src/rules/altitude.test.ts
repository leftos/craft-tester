import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, RunwayConfig, Scenario, Sid } from '@/data/schema.ts';
import { resolveAltitude } from '@/rules/altitude.ts';
import type { Classification } from '@/rules/classify.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

const ksfo = ksfoJson as unknown as AirportData;

function sid(id: string): Sid {
  const found = ksfo.sids.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`${id} is not in the data`);
  return found;
}

const config: RunwayConfig = {
  id: '28/01',
  name: 'Landing runways 28, departing runways 01',
  plan: 'SFOW',
  arrivalRunways: ['28L', '28R'],
  departureRunways: [{ runway: '01R', classes: ['P', 'T', 'J'] }],
};

const BASE_CTX: Classification = {
  aircraftClass: 'J',
  plan: 'SFOW',
  runwayFamily: '01',
  config,
  activeNoiseWindows: [],
  activeNotices: [],
};

const BASE_SCENARIO: Scenario = {
  callsign: 'UAL1',
  aircraftType: 'B738',
  rnavCapable: true,
  destination: 'KSEA',
  filedRoute: 'TRUKN2 DEDHD',
  filedAltitude: 34000,
  runwayConfigId: '28/01',
  departureRunway: '01R',
  localTime: '1400',
  dayOfWeek: 'tuesday',
  squawk: '1234',
};

function ctx(overrides: Partial<Classification>): Classification {
  return Object.assign({ ...BASE_CTX }, overrides);
}

function scenario(overrides: Partial<Scenario>): Scenario {
  return Object.assign({ ...BASE_SCENARIO }, overrides);
}

function resolve(
  classification: Classification,
  procedure: Sid,
  flight: Scenario,
  airport: AirportData = ksfo,
) {
  const result = resolveAltitude(classification, procedure, flight, airport);
  if (isUnresolved(result)) throw new Error(result.reason);
  return result;
}

describe('resolveAltitude', () => {
  it('clears a SID with a published top altitude to climb via the SID', () => {
    const result = resolve(ctx({}), sid('TRUKN2'), scenario({}));
    expect(result.altitude.value).toEqual({ phrase: 'climb_via' });
    expect(result.altitude.citations.map((citation) => citation.id)).toEqual([
      'A-CLIMB-VIA',
      'SFOW-J-10000',
    ]);
  });

  it('issues the interim altitude when the SID has no published top altitude', () => {
    const result = resolve(ctx({}), sid('SEGUL1'), scenario({}));
    expect(result.altitude.value).toEqual({ phrase: 'climb_via_except', feet: 10000 });
    expect(result.altitude.citations.map((citation) => citation.id)).toEqual([
      'A-CLIMB-VIA-EXCEPT',
      'SFOW-J-10000',
    ]);
  });

  it('takes the SID-specific interim row off the 28s', () => {
    const result = resolve(ctx({ runwayFamily: '28' }), sid('WESLA5'), scenario({}));
    expect(result.altitude.value).toEqual({ phrase: 'climb_via_except', feet: 3000 });
    expect(result.altitude.citations.map((citation) => citation.id)).toEqual([
      'A-CLIMB-VIA-EXCEPT',
      'SFOW-28-3000',
    ]);
  });

  it('says "maintain" for a SID with no crossing restrictions', () => {
    const result = resolve(ctx({ runwayFamily: '28' }), sid('GAPP7'), scenario({}));
    expect(result.altitude.value).toEqual({ phrase: 'maintain', feet: 3000 });
    expect(result.altitude.citations.map((citation) => citation.id)).toEqual([
      'A-MAINTAIN',
      'SFOW-28-3000',
    ]);
  });

  it('follows the per-runway crossing restrictions of a radar-vector SID', () => {
    expect(resolve(ctx({}), sid('SFO5'), scenario({})).altitude.value).toEqual({
      phrase: 'climb_via_except',
      feet: 10000,
    });
    expect(
      resolve(ctx({ runwayFamily: '28' }), sid('SFO5'), scenario({ departureRunway: '28L' }))
        .altitude.value,
    ).toEqual({ phrase: 'maintain', feet: 3000 });
  });

  it('caps the interim altitude at the filed altitude', () => {
    const result = resolve(ctx({}), sid('SEGUL1'), scenario({ filedAltitude: 5000 }));
    expect(result.altitude.value).toEqual({ phrase: 'climb_via_except', feet: 5000 });
  });

  it('turns a filed altitude below the published top altitude into climb via SID except maintain filed', () => {
    const result = resolve(ctx({}), sid('TRUKN2'), scenario({ filedAltitude: 11000 }));
    expect(result.altitude.value).toEqual({ phrase: 'climb_via_except', feet: 11000 });
    expect(result.altitude.citations.map((citation) => citation.id)).toEqual([
      'A-CLIMB-VIA-EXCEPT',
      'SFOW-J-10000',
    ]);
  });

  it('leaves a filed altitude at the published top altitude a plain climb via SID', () => {
    const result = resolve(ctx({}), sid('TRUKN2'), scenario({ filedAltitude: 19000 }));
    expect(result.altitude.value).toEqual({ phrase: 'climb_via' });
    expect(result.altitude.citations.map((citation) => citation.id)).toEqual([
      'A-CLIMB-VIA',
      'SFOW-J-10000',
    ]);
  });

  it('honours a row whose outcome is a plain climb via SID', () => {
    const airport: AirportData = {
      ...ksfo,
      // GAPP7 publishes no top altitude, which `only_when_interim_below_filed` has no altitude to
      // compare the filed one with; this case is about the phrase, so the expect clause is pinned.
      phraseology: { ...ksfo.phraseology, expectAltitude: 'always' },
      altitudeRules: [
        {
          id: 'TEST-CVS',
          source: 'test',
          text: 'climb via',
          plan: 'SFOW',
          runwayFamilies: ['01'],
          classes: ['J'],
          outcome: { kind: 'climb_via' },
          whenTopAltitudePublished: 'interim',
          expectAfterMinutes: 10,
        },
      ],
    };
    const result = resolve(ctx({}), sid('GAPP7'), scenario({}), airport);
    expect(result.altitude.value).toEqual({ phrase: 'climb_via' });
  });

  it('blocks the altitude element when no row is keyed to the flight', () => {
    const result = resolveAltitude(ctx({ plan: 'SFOX' }), sid('TRUKN2'), scenario({}), ksfo);
    expect(result).toEqual({ element: 'A.phrase', reason: expect.stringContaining('SFOX') });
  });
});

describe('the expect clause', () => {
  function withExpectAltitude(mode: AirportData['phraseology']['expectAltitude']): AirportData {
    return { ...ksfo, phraseology: { ...ksfo.phraseology, expectAltitude: mode } };
  }

  it('is spoken on every clearance while the toggle says always', () => {
    const result = resolve(ctx({}), sid('TRUKN2'), scenario({}), withExpectAltitude('always'));
    expect(result.expect.value).toEqual({ feet: 34000, minutes: 10 });
    expect(result.expect.citations.map((citation) => citation.id)).toEqual(['A-EXPECT']);
  });

  it('is never spoken while the toggle says never', () => {
    const result = resolve(ctx({}), sid('SEGUL1'), scenario({}), withExpectAltitude('never'));
    expect(result.expect.value).toBeNull();
  });

  it('keeps the expect clause on climb via with the filed altitude above the top altitude', () => {
    const airport = withExpectAltitude('only_when_interim_below_filed');
    expect(resolve(ctx({}), sid('TRUKN2'), scenario({}), airport).expect.value).toEqual({
      feet: 34000,
      minutes: 10,
    });
  });

  it('drops the expect clause on climb via with the filed altitude equal to the top altitude', () => {
    const airport = withExpectAltitude('only_when_interim_below_filed');
    const result = resolve(ctx({}), sid('TRUKN2'), scenario({ filedAltitude: 19000 }), airport);
    expect(result.altitude.value).toEqual({ phrase: 'climb_via' });
    expect(result.expect.value).toBeNull();
  });

  it('drops the expect clause when the interim altitude equals the filed altitude', () => {
    const airport = withExpectAltitude('only_when_interim_below_filed');
    const result = resolve(ctx({}), sid('SEGUL1'), scenario({ filedAltitude: 10000 }), airport);
    expect(result.altitude.value).toEqual({ phrase: 'climb_via_except', feet: 10000 });
    expect(result.expect.value).toBeNull();
  });

  it('keeps the expect clause when the interim altitude is below the filed altitude', () => {
    const airport = withExpectAltitude('only_when_interim_below_filed');
    expect(resolve(ctx({}), sid('SEGUL1'), scenario({}), airport).expect.value).toEqual({
      feet: 34000,
      minutes: 10,
    });
  });
});
