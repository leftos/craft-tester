import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { checkRoute } from '@/rules/amend/route.ts';
import { classify } from '@/rules/classify.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

const ksfo = ksfoJson as unknown as AirportData;

const BASE_SCENARIO: Scenario = {
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
  return Object.assign({ ...BASE_SCENARIO }, overrides);
}

function check(flight: Scenario) {
  const ctx = classify(flight, ksfo);
  if (isUnresolved(ctx)) throw new Error(ctx.reason);
  const result = resolveClearance(flight, ksfo);
  if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
  return checkRoute(flight, ctx, result.clearance, ksfo);
}

function amendment(flight: Scenario) {
  const result = check(flight);
  if (result === undefined) throw new Error('the filed route is the one the SOP assigns');
  if (isUnresolved(result)) throw new Error(result.reason);
  if (result.box !== 'route') throw new Error(`the check amended the ${result.box} box`);
  return result;
}

function citations(flight: Scenario): string[] {
  return amendment(flight).citations.map((citation) => citation.id);
}

describe('checkRoute procedure', () => {
  it('leaves a plan that files the assigned procedure and a routing the LOA accepts alone', () => {
    expect(check(scenario({}))).toBeUndefined();
  });

  it('prepends the assigned procedure to a plan filed without one', () => {
    const flight = scenario({ filedRoute: 'DEDHD RBL LMT HAWKZ7' });
    expect(amendment(flight).proposed).toBe('TRUKN2 DEDHD RBL LMT HAWKZ7');
    expect(amendment(flight).reason).toContain('no departure procedure');
    expect(citations(flight)).toContain('SFOW-N-TRUKN-01');
  });

  it('replaces a stale version of the assigned procedure with the current one', () => {
    const flight = scenario({ filedRoute: 'TRUKN1 DEDHD RBL LMT HAWKZ7' });
    expect(amendment(flight).proposed).toBe('TRUKN2 DEDHD RBL LMT HAWKZ7');
    expect(amendment(flight).reason).toBe(
      'TRUKN1 is not the current version of the TRUKN departure, which is TRUKN2',
    );
  });

  it('replaces a procedure the configuration does not assign with the one it does', () => {
    const flight = scenario({
      destination: 'KLAX',
      filedRoute: 'SSTIK5 EBAYE AVE SADDE8',
      departureRunway: '28L',
      runwayConfigId: '28 RT',
    });
    expect(amendment(flight).proposed).toBe('GAPP7 EBAYE AVE SADDE8');
    expect(amendment(flight).reason).toBe(
      'SSTIK5 is not the procedure the SOP assigns an RNAV jet from 28L in 28 RT; it is GAPP7',
    );
    expect(citations(flight)).toContain('SFOW-S-GAPP');
  });

  it('replaces a procedure an operational notice has taken out of use, and cites the notice', () => {
    const flight = scenario({
      destination: 'KLAX',
      aircraftType: 'A320',
      filedRoute: 'SEGUL1 YYUNG LAX COMIX2',
      departureRunway: '01L',
      filedAltitude: 33000,
    });
    expect(amendment(flight).proposed).toBe('SSTIK5 YYUNG LAX COMIX2');
    expect(citations(flight)).toContain('SFO-SEGUL-OFF');
  });
});

describe('checkRoute route building', () => {
  /** The worksheet plan filed to a fix the assigned SSTIK# does not publish a transition to. */
  function swa984(overrides: Partial<Scenario> = {}): Scenario {
    return scenario({
      callsign: 'SWA984',
      aircraftType: 'B737',
      destination: 'KLAX',
      filedRoute: 'SSTIK5 EBAYE AVE SADDE8',
      filedAltitude: 35000,
      departureRunway: '01L',
      squawk: '4602',
      ...overrides,
    });
  }

  it('keeps the assigned SID by the transition that always connects to the filed route', () => {
    const flight = swa984();
    expect(amendment(flight).proposed).toBe('SSTIK5 SUSEY EBAYE AVE SADDE8');
    expect(amendment(flight).reason).toBe(
      'SSTIK5 is the procedure the SOP assigns an RNAV jet from 01L in 28/01, and EBAYE is not one ' +
        'of its transitions, but SUSEY is and SUSEY always connects to EBAYE (route building), so ' +
        'the SID is kept',
    );
    expect(citations(flight)).toEqual(['SFOW-S-SSTIK-01', 'CONN-SUSEY-EBAYE', 'R-ROUTE-BUILD']);
  });

  it('builds a two-hop chain over a connection that usually holds, and says so', () => {
    const flight = swa984({ filedRoute: 'SSTIK5 BOILE EHF SADDE8' });
    expect(amendment(flight).proposed).toBe('SSTIK5 KAYEX LOSHN BOILE EHF SADDE8');
    expect(amendment(flight).reason).toContain('LOSHN usually connects to BOILE');
    expect(citations(flight)).toEqual([
      'SFOW-S-SSTIK-01',
      'CONN-KAYEX-LOSHN',
      'CONN-LOSHN-BOILE',
      'R-ROUTE-BUILD',
    ]);
  });

  it('falls back to the vector SID when no connection reaches the filed route', () => {
    const flight = swa984({ filedRoute: 'SSTIK5 OSI SNS SADDE8' });
    expect(amendment(flight).proposed).toBe('GAPP7 OSI SNS SADDE8');
    expect(citations(flight)).toContain('SFOW-S-GAPP');
  });

  it('leaves a plan that already files the transition alone', () => {
    expect(check(swa984({ filedRoute: 'SSTIK5 SUSEY EBAYE AVE SADDE8' }))).toBeUndefined();
  });

  it('leaves a plan filed on the vector SID alone rather than building the SOP one', () => {
    const flight = scenario({
      callsign: 'LXJ351',
      aircraftType: 'E55P',
      destination: 'KCRQ',
      filedRoute: 'GAPP7 EHF LHS V459 SLI V23 OCN',
      filedAltitude: 39000,
      departureRunway: '01L',
    });
    expect(check(flight)).toBeUndefined();
  });

  it('gives a plan filed without a procedure the assigned one, not a built route', () => {
    const flight = scenario({
      callsign: 'KAL65',
      aircraftType: 'B77L',
      destination: 'RKSI',
      filedRoute: 'RBL J1 OED J501 TOU J523 YZT J502 ANN… (continued)',
      filedAltitude: 30000,
    });
    expect(amendment(flight).proposed).toBe(
      'SFO5 RBL J1 OED J501 TOU J523 YZT J502 ANN… (continued)',
    );
    expect(amendment(flight).reason).toBe(
      'the route files no departure procedure; the SOP assigns SFO5 from 01R in 28/01',
    );
  });
});

describe('checkRoute TRACON destinations', () => {
  it('replaces the whole route with the TEC route, at the version in force', () => {
    const flight = scenario({
      destination: 'KSMF',
      aircraftType: 'E75L',
      filedRoute: 'SFO4 CCR CCR2',
      filedAltitude: 10000,
    });
    expect(amendment(flight).proposed).toBe('TRUKN2 TRUKN FEVTA FEVTA1');
    expect(amendment(flight).reason).toBe(
      'KSMF is inside NorCal TRACON; the TEC route for a jet in SFOW is TRUKN2 TRUKN FEVTA FEVTA1',
    );
    expect(citations(flight)).toContain('TEC-KSMF-SFOW-J');
  });

  it('leaves a non-RNAV flight on the assigned vector SID when the TEC route begins on an RNAV DP', () => {
    const flight = scenario({
      aircraftType: 'BE20',
      equipmentSuffix: '/A',
      destination: 'KSMF',
      filedRoute: 'GAPP7 TRUKN FEVTA FEVTA1',
      filedAltitude: 9000,
      departureRunway: '28R',
    });
    expect(check(flight)).toBeUndefined();
  });

  it('routes a flight the assigned DP does carry on the TEC route that begins with it', () => {
    const flight = scenario({
      aircraftType: 'B738',
      equipmentSuffix: '/L',
      destination: 'KSMF',
      filedRoute: 'GAPP7 TRUKN FEVTA FEVTA1',
      filedAltitude: 9000,
      departureRunway: '01R',
    });
    expect(amendment(flight).proposed).toBe('TRUKN2 TRUKN FEVTA FEVTA1');
    expect(citations(flight)).toContain('TEC-KSMF-SFOW-J');
  });

  it('leaves the vector clearance alone when the configuration assigns no TEC row a departure', () => {
    const flight = scenario({
      aircraftType: 'E75L',
      equipmentSuffix: '/L',
      destination: 'KSMF',
      filedRoute: 'GAPP7 TRUKN FEVTA FEVTA1',
      filedAltitude: 9000,
      departureRunway: '28R',
    });
    expect(check(flight)).toBeUndefined();
  });

  it('skips the TEC row the configuration does not assign and takes the one it does', () => {
    const flight = scenario({
      aircraftType: 'TBM9',
      equipmentSuffix: '/L',
      destination: 'KLVK',
      filedRoute: 'GAPP7 TRUKN ALTAM',
      filedAltitude: 5000,
      departureRunway: '28R',
    });
    expect(amendment(flight).proposed).toBe('GAPP7 OAK V244 ALTAM MOD');
    expect(citations(flight)).toContain('TEC-KLVK-SFOW-JT-28');
  });
});

describe('checkRoute letters of agreement', () => {
  it('reports the route box unresolved when no LOA routing fix is on the route', () => {
    const result = check(scenario({ destination: 'KPDX', filedRoute: 'TRUKN2 DEDHD LMT OCITY7' }));
    expect(result).toEqual({
      element: 'BOX.route',
      reason: expect.stringContaining('LOA-ZSE-PDX-ROUTE'),
    });
  });
});
