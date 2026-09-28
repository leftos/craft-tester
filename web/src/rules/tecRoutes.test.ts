import { describe, expect, it } from 'vitest';
import koakJson from '@data/koak.json';
import ksfoJson from '@data/ksfo.json';
import type {
  AirportData,
  AssignmentRule,
  RunwayConfig,
  Scenario,
  TecRoute,
} from '@/data/schema.ts';
import { checkRoute, withVectorNavaid } from '@/rules/amend/route.ts';
import type { Classification, Handling } from '@/rules/classify.ts';
import { classify } from '@/rules/classify.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { tecHead, tecTokens, usableTecRoute } from '@/rules/tecRoutes.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

const ksfo = ksfoJson as unknown as AirportData;
const koak = koakJson as unknown as AirportData;

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
  tecClass: 'J',
  sopClass: 'J',
  handlingRule: null,
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
  why: null,
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
  const ctx = classify(flight, data, 'proposed');
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
      const ctx = classify(flight, ksfo, 'proposed');
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

describe('a TEC route that begins on an initial heading', () => {
  /** The SOP row that clears a flight whose TEC route carries no departure on that same heading. */
  const assignmentRow: AssignmentRule = {
    id: 'SFOW-TEC-NO-DP-28',
    source: 'SFO ATCT SOP 2-1 c',
    text: 'SFOW: jets on a TEC route with no DP, runway 28 -> heading 270 (no DP)',
    plan: 'SFOW',
    direction: 'any',
    runwayFamilies: ['28'],
    classes: ['J'],
    sidFamily: null,
    nonDpHeading: 270,
    sector: 'richmond',
    when: { tecRouteWithoutDp: true },
    why: null,
  };

  const withNoDpRow: AirportData = {
    ...airport,
    assignmentRules: [assignmentRow, ...ksfo.assignmentRules],
  };

  const flight: Scenario = { ...SCENARIO, filedRoute: 'TRUKN2 FEVTA FEVTA1' };

  /** The classified flight, which the TEC rows are keyed against. */
  function classified(scenario: Scenario): Classification {
    const ctx = classify(scenario, withNoDpRow, 'proposed');
    if (isUnresolved(ctx)) throw new Error(ctx.reason);
    return ctx;
  }

  it('keeps the heading in the route it proposes', () => {
    expect(tecTokens(headingRow, withNoDpRow)).toEqual(['H270', 'FEVTA', 'FEVTA1']);
  });

  it('routes the flight the SOP clears on that heading', () => {
    const row = usableTecRoute(classified(flight), flight, withNoDpRow);
    expect(row?.id).toBe('TEC-KSMF-OAKE-J');
  });

  it('amends the route box to the published route, its heading included', () => {
    const result = resolveClearance(flight, withNoDpRow, 'proposed');
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.clearance.procedure.value).toMatchObject({ kind: 'heading', heading: 270 });
    const amendment = checkRoute(flight, classified(flight), result.clearance, withNoDpRow);
    if (amendment === undefined) throw new Error('the filed route is the one the SOP assigns');
    if (isUnresolved(amendment)) throw new Error(amendment.reason);
    if (amendment.box !== 'route') throw new Error(`the check amended the ${amendment.box} box`);
    expect(amendment.proposed).toBe('H270 FEVTA FEVTA1');
    expect(amendment.citations.map((citation) => citation.id)).toContain('TEC-KSMF-OAKE-J');
  });
});

describe('tecTokens on the RH, RV and heading tokens', () => {
  /** The tokens a row reads as at the airport given, failing the test where it names no family. */
  function tokensOf(route: string, data: AirportData): string[] {
    const tokens = tecTokens(row({ route }), data);
    if (isUnresolved(tokens)) throw new Error(tokens.reason);
    return tokens;
  }

  it('reads RH RV as RH RV', () => {
    expect(tokensOf('RH RV', koak).join(' ')).toBe('RH RV');
  });

  it('reads H090 RV as H090 RV', () => {
    expect(tokensOf('H090 RV', koak).join(' ')).toBe('H090 RV');
  });

  it('reads H270 OSI as H270 OSI, keeping the heading', () => {
    expect(tokensOf('H270 OSI', koak).join(' ')).toBe('H270 OSI');
  });

  it('reads OAK# RV at KOAK as OAK6 RV, boxed OAK6 OAK RV after the airport navaid', () => {
    const tokens = tokensOf('OAK# RV', koak);
    expect(tokens.join(' ')).toBe('OAK6 RV');
    expect(withVectorNavaid(tokens, koak).join(' ')).toBe('OAK6 OAK RV');
  });

  it('reads NIMI# RV at KOAK as NIMI6 RV, boxed NIMI6 OAK RV, NIMI6 being a radar-vector SID', () => {
    expect(koak.sids.find((sid) => sid.id === 'NIMI6')).toMatchObject({
      kind: 'radar_vectors',
      routePhrasing: 'radar_vectors_fix',
    });
    const tokens = tokensOf('NIMI# RV', koak);
    expect(tokens.join(' ')).toBe('NIMI6 RV');
    expect(withVectorNavaid(tokens, koak).join(' ')).toBe('NIMI6 OAK RV');
  });

  it('reads the bare GAPP# at KSFO as GAPP7, boxed GAPP7 SFO', () => {
    const tokens = tokensOf('GAPP#', ksfo);
    expect(tokens.join(' ')).toBe('GAPP7');
    expect(withVectorNavaid(tokens, ksfo).join(' ')).toBe('GAPP7 SFO');
  });
});

describe('usableTecRoute for a type ZOA CPS-004 3.1 handles as another class', () => {
  /** The TEC row a KOAK flight of `aircraftType` to KSMF off 30 in SFOW is routed on. */
  function koakKsmfRow(aircraftType: string, handling: Handling): TecRoute | undefined {
    const flight: Scenario = {
      ...SCENARIO,
      aircraftType,
      filedRoute: 'OAK6 OAK FEVTA FEVTA1',
      runwayConfigId: 'SFOW',
      departureRunway: '30',
    };
    const ctx = classify(flight, koak, handling);
    if (isUnresolved(ctx)) throw new Error(ctx.reason);
    return usableTecRoute(ctx, flight, koak);
  }

  it.each(['DH8D', 'C510'])('proposes a %s the jet row', (aircraftType) => {
    const row = koakKsmfRow(aircraftType, 'proposed');
    expect(row?.id).toBe('TEC-KSMF-SFOW-J');
    expect(row?.route).toBe('OAK# OAK FEVTA FEVTA1');
  });

  it.each(['DH8D', 'C510'])('accepts a %s on the turboprop row', (aircraftType) => {
    const row = koakKsmfRow(aircraftType, 'accepted');
    expect(row?.id).toBe('TEC-KSMF-SFOW-T');
    expect(row?.route).toBe('NIMI# OAK V6 SAC');
  });

  it('routes a B738, which the table does not list, on the jet row under either handling', () => {
    expect(koakKsmfRow('B738', 'proposed')?.id).toBe('TEC-KSMF-SFOW-J');
    expect(koakKsmfRow('B738', 'accepted')?.id).toBe('TEC-KSMF-SFOW-J');
  });
});
