import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, RunwayConfig, Scenario, TecRoute } from '@/data/schema.ts';
import type { Classification } from '@/rules/classify.ts';
import { classify } from '@/rules/classify.ts';
import { tecHead, usableTecRoute } from '@/rules/tecRoutes.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

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
  gnssCapable: true,
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
  initialAltitudeFeet: 10000,
  finalAltitudeFeet: 10000,
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

/** The TEC row a KSFO flight to KLVK is routed on, read against the airport data given. */
function klvkRow(overrides: Partial<Scenario>, data: AirportData = ksfo): string | undefined {
  const flight: Scenario = {
    ...SCENARIO,
    aircraftType: 'B738',
    destination: 'KLVK',
    filedRoute: 'TRUKN2 TRUKN ALTAM',
    filedAltitude: 5000,
    runwayConfigId: '28/01',
    departureRunway: '01R',
    ...overrides,
  };
  const ctx = classify(flight, data);
  if (isUnresolved(ctx)) throw new Error(ctx.reason);
  return usableTecRoute(ctx, flight, data)?.id;
}

describe('usableTecRoute', () => {
  it('takes the first row written for the flight where its route begins on a heading', () => {
    expect(usableTecRoute(CTX, SCENARIO, airport)?.id).toBe('TEC-KSMF-OAKE-J');
  });

  it('has no row for a destination outside the TRACON', () => {
    expect(usableTecRoute(CTX, { ...SCENARIO, destination: 'KSLC' }, airport)).toBeUndefined();
  });

  it('takes the first keyed row whose SID the flight can fly off its runway', () => {
    expect(klvkRow({})).toBe('TEC-KLVK-SFOW-JT');
  });

  it.each([
    ['jet', 'B738'],
    ['turboprop', 'BE20'],
  ])('skips the RNAV row for a /A %s to KLVK off 01R and takes TEC-KLVK-SFOW-JT-01', (_, type) => {
    expect(klvkRow({ aircraftType: type, equipmentSuffix: '/A' })).toBe('TEC-KLVK-SFOW-JT-01');
  });

  it('skips a TRUKN# row off 01L, which TRUKN2 is not published from', () => {
    expect(klvkRow({ departureRunway: '01L' })).toBe('TEC-KLVK-SFOW-JT-01');
  });

  describe('a notice that takes the row family out of use with no heading', () => {
    const segulRow = row({
      id: 'TEC-KLVK-SFOW-SEGUL',
      destination: 'KLVK',
      classes: ['J', 'T'],
      route: 'SEGUL# SEGUL ALTAM',
    });
    const withSegulRow: AirportData = { ...ksfo, tecRoutes: [segulRow, ...ksfo.tecRoutes] };
    const off28L = { runwayConfigId: '28 RT', departureRunway: '28L' };

    it('skips the row for the next keyed row while the notice is active', () => {
      expect(klvkRow({ ...off28L, activeNotices: ['SFO-SEGUL-OFF'] }, withSegulRow)).toBe(
        'TEC-KLVK-SFOW-JT',
      );
    });

    it('takes the row once the notice is lifted', () => {
      expect(klvkRow({ ...off28L, activeNotices: [] }, withSegulRow)).toBe('TEC-KLVK-SFOW-SEGUL');
    });
  });

  describe('a family the SOP does not put in use from the runway family in the configuration', () => {
    /** The TEC row a KSFO RNAV jet to KSMF is routed on, in the configuration and off the runway given. */
    function ksmfRow(runwayConfigId: string, departureRunway: string): string | undefined {
      const flight: Scenario = {
        ...SCENARIO,
        filedRoute: 'TRUKN2 TRUKN FEVTA FEVTA1',
        runwayConfigId,
        departureRunway,
      };
      const ctx = classify(flight, ksfo);
      if (isUnresolved(ctx)) throw new Error(ctx.reason);
      return usableTecRoute(ctx, flight, ksfo)?.id;
    }

    it('takes TEC-KSMF-SFOW-J off 01R in 28/01, where SFOW-N-TRUKN-01 puts TRUKN in use', () => {
      expect(ksmfRow('28/01', '01R')).toBe('TEC-KSMF-SFOW-J');
    });

    it('routes the same jet off 28L in 28/01 on no row, TRUKN being in use off the 28s only in 28 RT', () => {
      expect(ksmfRow('28/01', '28L')).toBeUndefined();
    });

    it('takes TEC-KSMF-SFOW-J off 28L in 28 RT', () => {
      expect(ksmfRow('28 RT', '28L')).toBe('TEC-KSMF-SFOW-J');
    });

    it.each(['28L', '28R'])(
      'skips TEC-KSMF-SFOW-J off %s in 28 SO, which puts TRUKN in use nowhere',
      (runway) => {
        expect(ksmfRow('28 SO', runway)).toBeUndefined();
      },
    );
  });
});
