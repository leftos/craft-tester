import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import airportsIndex from '@data/airports.json';
import airportJsonSchema from '@data/schema/airport.schema.json';
import fixtureJsonSchema from '@data/schema/fixture.schema.json';
import { AirportDataSchema, AirportsIndexSchema, FixtureSchema } from '@/data/schema.ts';
import type { Fixture } from '@/data/schema.ts';

const minimalFixture: Fixture = {
  id: 'ksfo-synthetic-trukn2-jet-01r',
  source: { kind: 'synthetic' },
  status: 'pending',
  airport: 'KSFO',
  scenario: {
    callsign: 'UAL123',
    aircraftType: 'B738/L',
    rnavCapable: true,
    destination: 'KSEA',
    filedRoute: 'TRUKN2 DEDHD',
    filedAltitude: 35000,
    runwayConfigId: '28/01',
    departureRunway: '01R',
    localTime: '1430',
    dayOfWeek: 'tuesday',
    squawk: '4517',
  },
};

describe('exported JSON Schema', () => {
  it('matches the checked-in airport schema', () => {
    expect(z.toJSONSchema(AirportDataSchema)).toEqual(airportJsonSchema);
  });

  it('matches the checked-in fixture schema', () => {
    expect(z.toJSONSchema(FixtureSchema)).toEqual(fixtureJsonSchema);
  });
});

describe('AirportsIndexSchema', () => {
  it('accepts the checked-in airport index', () => {
    expect(AirportsIndexSchema.parse(airportsIndex)).toEqual([{ icao: 'KSFO', file: 'ksfo.json' }]);
  });
});

describe('FixtureSchema', () => {
  it('accepts a minimal fixture with no expectation yet', () => {
    expect(FixtureSchema.parse(minimalFixture)).toEqual(minimalFixture);
  });

  it('rejects an unknown key', () => {
    const withUnknownKey = { ...minimalFixture, mode: 'clearance' };
    expect(FixtureSchema.safeParse(withUnknownKey).success).toBe(false);
  });
});
