import { describe, expect, it } from 'vitest';
import koakJson from '@data/koak.json';
import type { AirportData, Fixture, Sid } from '@/data/schema.ts';
import {
  sidFamiliesNamed,
  withCurrentVersions,
  withStampedVersions,
} from '@/rules/fixtureVersions.ts';

const koak = koakJson as unknown as AirportData;

/** KOAK's data with one OAK departure, at a version no real cycle has published. */
function airportPublishingOak(): AirportData {
  const template = koak.sids[0] as Sid;
  return { ...koak, sids: [{ ...template, family: 'OAK', id: 'OAK42', spoken: 'Oakland Forty' }] };
}

/** An amendment fixture written against OAK6, filing the route given. */
function fixtureFiling(filedRoute: string): Fixture {
  return {
    id: 'versions-test',
    source: { kind: 'synthetic' },
    status: 'settled',
    mode: 'amendment',
    airport: 'KOAK',
    sidVersions: { OAK: { id: 'OAK6', spoken: 'Oakland Six' } },
    scenario: {
      callsign: 'AAY1002',
      aircraftType: 'A319',
      equipmentSuffix: '/L',
      destination: 'KBLI',
      filedRoute,
      filedAltitude: 36000,
      runwayConfigId: 'SFOW',
      departureRunway: '30',
      localTime: '1400',
      dayOfWeek: 'tuesday',
      squawk: '4603',
    },
    expected: {
      amendments: [
        {
          box: 'route',
          proposed: 'OAK6 OAK GRTFL OED J1 SEA',
          reason: 'OAK9 is not the current version of the OAK departure, which is OAK6',
        },
      ],
    },
  } as Fixture;
}

describe('withCurrentVersions', () => {
  it('maps a stamped id in the filed route, the proposal and the reason', () => {
    const mapped = withCurrentVersions(fixtureFiling('OAK6 OAK GRTFL'), airportPublishingOak());
    expect(mapped.scenario.filedRoute).toBe('OAK42 OAK GRTFL');
    expect(mapped.expected).toEqual({
      amendments: [
        {
          box: 'route',
          proposed: 'OAK42 OAK GRTFL OED J1 SEA',
          reason: 'OAK9 is not the current version of the OAK departure, which is OAK42',
        },
      ],
    });
  });

  it('maps a stamped spoken name in a clearance', () => {
    const fixture = {
      ...fixtureFiling('OAK6 OAK GRTFL'),
      mode: 'clearance',
      expected: { route: 'OAK6 OAK', spoken: 'Oakland Six departure, Oakland, then as filed' },
    } as unknown as Fixture;
    const mapped = withCurrentVersions(fixture, airportPublishingOak());
    expect(mapped.expected).toEqual({
      route: 'OAK42 OAK',
      spoken: 'Oakland Forty departure, Oakland, then as filed',
    });
  });

  it('leaves a stale version beside the stamped one alone', () => {
    const mapped = withCurrentVersions(
      fixtureFiling('OAK9 OAK GRTFL OED J1 SEA'),
      airportPublishingOak(),
    );
    expect(mapped.scenario.filedRoute).toBe('OAK9 OAK GRTFL OED J1 SEA');
  });

  it('does not change the fixture it is given', () => {
    const fixture = fixtureFiling('OAK6 OAK GRTFL');
    withCurrentVersions(fixture, airportPublishingOak());
    expect(fixture.scenario.filedRoute).toBe('OAK6 OAK GRTFL');
    expect(fixture.sidVersions).toEqual({ OAK: { id: 'OAK6', spoken: 'Oakland Six' } });
  });

  it('throws when the stamped family is no longer published', () => {
    const airport = { ...koak, sids: [] };
    expect(() => withCurrentVersions(fixtureFiling('OAK6 OAK'), airport)).toThrow(
      'fixture versions-test stamps SID family OAK, which KOAK no longer publishes',
    );
  });

  it('puts an answer at the current versions back into the stamped ones', () => {
    const answer = { route: 'OAK42 OAK', spoken: 'Oakland Forty departure, then as filed' };
    const stamp = { OAK: { id: 'OAK6', spoken: 'Oakland Six' } };
    expect(withStampedVersions(answer, stamp, airportPublishingOak())).toEqual({
      route: 'OAK6 OAK',
      spoken: 'Oakland Six departure, then as filed',
    });
    expect(answer.route).toBe('OAK42 OAK');
  });

  it('names each family a versioned token stands for, a stale one included', () => {
    const answer = {
      reason: 'OAK9 is not the current version; OAKLAND and OAK are not tokens of it',
    };
    expect(sidFamiliesNamed(answer, airportPublishingOak())).toEqual(['OAK']);
    expect(sidFamiliesNamed('OAK OAKX1 XOAK1', airportPublishingOak())).toEqual([]);
  });

  it('returns a fixture with no stamp equal to the one given', () => {
    const { sidVersions: _stamp, ...unstamped } = fixtureFiling('OAK6 OAK GRTFL');
    expect(withCurrentVersions(unstamped, airportPublishingOak())).toEqual(unstamped);
  });
});
