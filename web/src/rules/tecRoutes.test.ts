import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, RunwayConfig, Scenario, TecRoute } from '@/data/schema.ts';
import type { Classification } from '@/rules/classify.ts';
import { keyedTecRoute, tecHead } from '@/rules/tecRoutes.ts';

const ksfo = ksfoJson as unknown as AirportData;

const config: RunwayConfig = {
  id: '28 RT',
  source: 'SFO ATCT SOP 1-7',
  name: 'Landing and departing runways 28',
  plan: 'SFOW',
  trainingWeight: 20,
  arrivalRunways: ['28L', '28R'],
  departureRunways: [
    {
      runway: '28L',
      classes: ['P', 'T', 'J'],
      defaultForAirlines: [],
      defaultForGroups: [],
      defaultForClasses: [],
      onRequestFor: [],
    },
  ],
};

const CTX: Classification = {
  aircraftClass: 'J',
  aircraftType: 'B737',
  approachCategory: undefined,
  plan: 'SFOW',
  runwayFamily: '28',
  config,
  rnavCapable: true,
  activeNoiseWindows: [],
  activeNotices: [],
};

const SCENARIO: Scenario = {
  callsign: 'SWA1',
  aircraftType: 'B737',
  equipmentSuffix: '/L',
  destination: 'KSMF',
  filedRoute: 'FEVTA FEVTA1',
  filedAltitude: 10000,
  runwayConfigId: '28 RT',
  departureRunway: '28L',
  localTime: '1400',
  dayOfWeek: 'tuesday',
  squawk: '1234',
};

/** The TEC row the route tool writes on an initial heading rather than on a departure. */
const headingRow: TecRoute = {
  id: 'TEC-KSMF-OAKE-J',
  source: 'ZOA Reference Tool, TEC/AAR/ADR Routes',
  kind: 'tec',
  destination: 'KSMF',
  plan: 'SFOW',
  runwayFamilies: [],
  classes: ['J'],
  route: 'H270 FEVTA FEVTA1',
  altitudeCapFeet: 10000,
};

function row(overrides: Partial<TecRoute>): TecRoute {
  return Object.assign({ ...headingRow }, overrides);
}

const airport: AirportData = { ...ksfo, tecRoutes: [headingRow, ...ksfo.tecRoutes] };

describe('tecHead', () => {
  it('reads the departure family a row begins on', () => {
    expect(tecHead(row({ route: 'TRUKN# TRUKN FEVTA FEVTA1' }))).toEqual({
      kind: 'family',
      family: 'TRUKN',
    });
  });

  it('reads the initial heading a row is issued on', () => {
    expect(tecHead(headingRow)).toEqual({ kind: 'heading', heading: 270 });
  });

  it('reads a row that begins on a fix as beginning on no departure at all', () => {
    expect(tecHead(row({ route: 'EUGEN' }))).toEqual({ kind: 'none' });
  });

  it.each(['H400', 'H000'])('rejects %s, which is no magnetic heading', (head) => {
    expect(() => tecHead(row({ route: `${head} FEVTA` }))).toThrow('TEC-KSMF-OAKE-J');
  });
});

describe('keyedTecRoute', () => {
  it('takes the first row written for the flight, whatever its route begins on', () => {
    expect(keyedTecRoute(CTX, SCENARIO, airport)?.id).toBe('TEC-KSMF-OAKE-J');
  });

  it('has no row for a destination outside the TRACON', () => {
    expect(keyedTecRoute(CTX, { ...SCENARIO, destination: 'KSLC' }, airport)).toBeUndefined();
  });
});
