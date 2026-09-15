import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import airportsIndex from '@data/airports.json';
import airportJsonSchema from '@data/schema/airport.schema.json';
import fixtureJsonSchema from '@data/schema/fixture.schema.json';
import {
  AirportDataSchema,
  AirportsIndexSchema,
  AssignmentRuleSchema,
  FixtureSchema,
} from '@/data/schema.ts';
import type { AirportData, AssignmentRule, Fixture } from '@/data/schema.ts';

const minimalAssignmentRule: AssignmentRule = {
  id: 'SFOW-N-TRUKN-01',
  source: 'SFO ATCT SOP 2-2 a',
  text: 'Northbound, runway 01, T/J -> TRUKN#',
  plan: 'SFOW',
  direction: 'north',
  runwayFamilies: ['01'],
  classes: ['T', 'J'],
  sidFamily: 'TRUKN',
  sector: 'richmond',
};

const minimalAirportData: AirportData = {
  airport: {
    icao: 'KSFO',
    faa: 'SFO',
    spoken: 'San Francisco',
    clearanceDelivery: '118.2',
    lat: 37.618806,
    lon: -122.375417,
  },
  provenance: {
    airac: { cycle: '2609', effective: '2026-09-03', cifpSha256: 'a'.repeat(64) },
    chartsApi: 'https://api.aviationapi.com/v1/charts',
    sop: {
      url: 'https://oakartcc.org/controllers/file/9a2b1e84',
      version: '1.11',
      sha256: 'b'.repeat(64),
      transcribedAt: '2026-09-15',
    },
  },
  runwayConfigs: [
    {
      id: '28/01',
      source: 'SFO ATCT SOP 1-7',
      name: 'Landing runways 28, departing runways 01',
      plan: 'SFOW',
      arrivalRunways: ['28L', '28R'],
      departureRunways: [
        { runway: '01R', classes: ['P', 'T', 'J'], defaultForClasses: [], onRequestFor: [] },
      ],
    },
  ],
  departureSectors: [{ id: 'richmond', name: 'NorCal Richmond', frequency: '120.9' }],
  departureStaffingFallbacks: [
    { id: 'nct_combined', name: 'NorCal Approach (combined)', frequency: '133.95' },
  ],
  frequencies: [{ label: 'San Francisco Clearance', value: '118.2' }],
  directionRunwayPreference: {
    SFOW: {
      north: { '01': '01R' },
      south: { '01': '01L' },
      oceanic: { '01': '01L' },
    },
  },
  gates: { north: ['DEDHD'], south: ['KTINA'], oceanic: ['BEBOP'] },
  noSid: { runwayFamilies: ['01'], phrasing: 'radar_vectors_fix' },
  sids: [
    {
      id: 'TRUKN2',
      family: 'TRUKN',
      chartName: 'TRUKN TWO (RNAV)',
      spoken: 'Trukn Two',
      kind: 'rnav_pilot_nav',
      rnavRequired: true,
      runways: ['01R', '28L', '28R'],
      transitions: [{ fix: 'DEDHD', spoken: 'Dedhd', kind: 'enroute', spokenAsTransition: true }],
      topAltitude: { kind: 'published', feet: 10000 },
      chartExpectFiledAltitudeMinutes: null,
      hasCrossingRestrictions: true,
      restrictions: [{ fix: 'TRUKN', altitudeDescription: '+' }],
      climbViaEligible: true,
      routePhrasing: 'transition',
      chartFrequencies: [{ frequency: '120.9' }],
      chart: { pdfUrl: 'https://charts.aviationapi.com/TRUKN2.PDF' },
    },
  ],
  fixSpoken: { OSI: 'Woodside' },
  assignmentRules: [minimalAssignmentRule],
  noiseWindows: [],
  altitudeRules: [
    {
      id: 'SFOW-J-10000',
      source: 'SFO ATCT SOP 2-2 c ii',
      text: 'SFOW: all others, runways 01/28, J -> 10,000 or CVS x 10,000',
      plan: 'SFOW',
      runwayFamilies: ['01', '28'],
      classes: ['J'],
      outcome: { kind: 'interim', feet: 10000 },
      whenTopAltitudePublished: 'climb_via',
      expectAfterMinutes: 10,
    },
  ],
  phraseology: {
    expectAltitude: 'always',
    nonStandardInterimExpectMinutes: 3,
    vectorHybridTransitionsSpoken: false,
  },
  phraseologyRules: [],
  equipmentSuffixes: [],
  tecRoutes: [],
  loaRules: [],
  notices: [],
  aircraftClasses: { B738: 'J' },
  routeLibrary: { destinations: [], telephony: {}, cargoAirlines: [], fleet: [], routes: [] },
};

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

describe('AirportDataSchema', () => {
  it('accepts a minimal airport file', () => {
    expect(AirportDataSchema.parse(minimalAirportData)).toEqual(minimalAirportData);
  });
});

describe('AssignmentRuleSchema', () => {
  it('rejects a rule that sets both sidFamily and nonDpHeading', () => {
    const both = { ...minimalAssignmentRule, nonDpHeading: 'runway heading' };
    expect(AssignmentRuleSchema.safeParse(both).success).toBe(false);
  });

  it('rejects a rule that sets neither sidFamily nor nonDpHeading', () => {
    const neither = { ...minimalAssignmentRule, sidFamily: null };
    expect(AssignmentRuleSchema.safeParse(neither).success).toBe(false);
  });

  it('accepts a rule that clears the flight without a DP', () => {
    const nonDp = { ...minimalAssignmentRule, sidFamily: null, nonDpHeading: 'runway heading' };
    expect(AssignmentRuleSchema.parse(nonDp)).toEqual(nonDp);
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
