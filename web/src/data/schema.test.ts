import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import airportsIndex from '@data/airports.json';
import airportJsonSchema from '@data/schema/airport.schema.json';
import fixtureJsonSchema from '@data/schema/fixture.schema.json';
import {
  AirportDataSchema,
  AirportsIndexSchema,
  AmendmentSchema,
  AssignmentRuleSchema,
  FixtureSchema,
  TecRouteSchema,
} from '@/data/schema.ts';
import type { AirportData, AssignmentRule, Fixture, TecRoute } from '@/data/schema.ts';

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

const minimalTecRoute: TecRoute = {
  id: 'TEC-KSMF-SFOW-J',
  source: 'ZOA Reference Tool, TEC/AAR/ADR Routes',
  kind: 'tec',
  destination: 'KSMF',
  plan: 'SFOW',
  runwayFamilies: [],
  classes: ['J'],
  route: 'TRUKN# TRUKN FEVTA FEVTA1',
};

const minimalAirportData: AirportData = {
  airport: {
    icao: 'KSFO',
    faa: 'SFO',
    spoken: 'San Francisco',
    clearanceDelivery: '118.2',
    lat: 37.618806,
    lon: -122.375417,
    magneticVariation: 14,
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
  runways: [
    { designator: '01R', magneticBearing: 14 },
    { designator: '28L', magneticBearing: 284 },
    { designator: '28R', magneticBearing: 284 },
  ],
  runwayConfigs: [
    {
      id: '28/01',
      source: 'SFO ATCT SOP 1-7',
      name: 'Landing runways 28, departing runways 01',
      plan: 'SFOW',
      trainingWeight: 55,
      arrivalRunways: ['28L', '28R'],
      departureRunways: [
        {
          runway: '01R',
          classes: ['P', 'T', 'J'],
          defaultForAirlines: [],
          defaultForGroups: [],
          defaultForClasses: [],
          onRequestFor: [],
        },
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
  rnavWaypoints: [],
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
  routeConnections: [],
  airways: [],
  commonArrivals: [],
  tecRoutes: [],
  loaRules: [],
  notices: [],
  aircraftClasses: { B738: 'J' },
  aircraftGroups: {},
  routeLibrary: { destinations: [], telephony: {}, cargoAirlines: [], fleet: [], routes: [] },
};

const minimalFixture: Fixture = {
  id: 'ksfo-synthetic-trukn2-jet-01r',
  source: { kind: 'synthetic' },
  status: 'pending',
  mode: 'clearance',
  airport: 'KSFO',
  scenario: {
    callsign: 'UAL123',
    aircraftType: 'B738/L',
    equipmentSuffix: '/L',
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
  it('accepts the checked-in airport index and its file naming', () => {
    const index = AirportsIndexSchema.parse(airportsIndex);
    expect(index).toContainEqual({ icao: 'KSFO', file: 'ksfo.json' });
    expect(index).toContainEqual({ icao: 'KOAK', file: 'koak.json' });
    const misnamed = index.filter(
      (entry) => !entry.file.endsWith('.json') || entry.file !== `${entry.icao.toLowerCase()}.json`,
    );
    expect(misnamed).toEqual([]);
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

describe('TecRouteSchema', () => {
  it('rejects a row that states an initial altitude without a final one', () => {
    const initialOnly = { ...minimalTecRoute, initialAltitudeFeet: 3000 };
    expect(TecRouteSchema.safeParse(initialOnly).success).toBe(false);
  });

  it('rejects a row whose initial altitude is above its final one', () => {
    const inverted = { ...minimalTecRoute, initialAltitudeFeet: 9000, finalAltitudeFeet: 5000 };
    expect(TecRouteSchema.safeParse(inverted).success).toBe(false);
  });

  it('accepts a row whose initial altitude is its final one', () => {
    const level = { ...minimalTecRoute, initialAltitudeFeet: 5000, finalAltitudeFeet: 5000 };
    expect(TecRouteSchema.parse(level)).toEqual(level);
  });
});

describe('FixtureSchema', () => {
  it('accepts a minimal fixture with no expectation yet', () => {
    expect(FixtureSchema.parse(minimalFixture)).toEqual(minimalFixture);
  });

  it('rejects an unknown key', () => {
    const withUnknownKey = { ...minimalFixture, trainer: 'someone' };
    expect(FixtureSchema.safeParse(withUnknownKey).success).toBe(false);
  });

  it('rejects a fixture that does not say which mode it belongs to', () => {
    const { mode, ...withoutMode } = minimalFixture;
    expect(mode).toBe('clearance');
    expect(FixtureSchema.safeParse(withoutMode).success).toBe(false);
  });
});

describe('AmendmentSchema', () => {
  it.each([
    { box: 'route', proposed: 'TRUKN3 DEDHD RBL', reason: 'the SID version is stale' },
    { box: 'altitude', proposedFeet: 33000, reason: 'FL340 is the wrong parity eastbound' },
    { box: 'type', proposed: 'B752/L', reason: 'the plan filed no equipment suffix' },
  ])('accepts the $box amendment', (amendment) => {
    expect(AmendmentSchema.parse(amendment)).toEqual(amendment);
  });

  it('rejects an altitude amendment that proposes text instead of feet', () => {
    expect(AmendmentSchema.safeParse({ box: 'altitude', proposed: '10000' }).success).toBe(false);
  });
});
