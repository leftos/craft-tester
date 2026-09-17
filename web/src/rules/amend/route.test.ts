import { describe, expect, it } from 'vitest';
import koakJson from '@data/koak.json';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, AssignmentRule, LoaRule, LoaRuleKind, Scenario } from '@/data/schema.ts';
import { checkRoute } from '@/rules/amend/route.ts';
import { classify } from '@/rules/classify.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

const ksfo = ksfoJson as unknown as AirportData;
const koak = koakJson as unknown as AirportData;

/** The optional keys an LOA routing row narrows itself with: the classes and the RNAV column. */
type LoaRouteNarrowing = Omit<Extract<LoaRuleKind, { kind: 'route' }>, 'kind' | 'tokens'>;

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

function checkAt(flight: Scenario, airport: AirportData) {
  const ctx = classify(flight, airport);
  if (isUnresolved(ctx)) throw new Error(ctx.reason);
  const result = resolveClearance(flight, airport);
  if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
  return checkRoute(flight, ctx, result.clearance, airport);
}

function check(flight: Scenario) {
  return checkAt(flight, ksfo);
}

function amendmentAt(flight: Scenario, airport: AirportData) {
  const result = checkAt(flight, airport);
  if (result === undefined) throw new Error('the filed route is the one the SOP assigns');
  if (isUnresolved(result)) throw new Error(result.reason);
  if (result.box !== 'route') throw new Error(`the check amended the ${result.box} box`);
  return result;
}

function amendment(flight: Scenario) {
  return amendmentAt(flight, ksfo);
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
    expect(check(swa984({ filedRoute: 'SSTIK5 SUSEY EBAYE BURGL IRNMN2' }))).toBeUndefined();
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

  it('builds a route for a flight the SOP would send off on a heading, on the SID it passed over', () => {
    const flight = scenario({
      callsign: 'LXJ351',
      aircraftType: 'E55P',
      destination: 'KCRQ',
      filedRoute: 'OAK6 EHF LHS V459 SLI V23 OCN',
      filedAltitude: 39000,
      runwayConfigId: 'SFOW',
      departureRunway: '30',
      squawk: '4611',
    });
    const result = amendmentAt(flight, koak);
    expect(result.proposed).toBe('CNDEL5 KAYEX LOSHN EHF LHS V459 SLI V23 OCN');
    expect(result.reason).toContain('so the SID is issued in place of the heading');
    expect(result.citations.map((citation) => citation.id)).toEqual([
      'OAK-SFOW-S-CNDEL',
      'CONN-KAYEX-LOSHN',
      'CONN-LOSHN-EHF',
      'R-ROUTE-BUILD',
    ]);
  });

  /** The worksheet plan the SOP sends off 30 on a heading, whose route SKYL1 reaches by WAGES. */
  function pxt415(): Scenario {
    return scenario({
      callsign: 'PXT415',
      aircraftType: 'C25B',
      equipmentSuffix: '/A',
      destination: 'KUDD',
      filedRoute: 'SUNNE1 SUNNE KAYEX LOSHN PMD V137 PSP',
      filedAltitude: 32000,
      runwayConfigId: 'SFOW',
      departureRunway: '30',
      squawk: '4605',
    });
  }

  it("builds from the SID's own end fix when no transition of it reaches the filed route", () => {
    const result = amendmentAt(pxt415(), koak);
    expect(result.proposed).toBe('SKYL1 WAGES LOSHN PMD V137 PSP');
    expect(result.reason).toBe(
      'SKYL1 is the procedure the SOP assigns a non-RNAV jet from 30 in SFOW, and SUNNE is not one ' +
        'of its transitions, but WAGES is its own end fix and WAGES usually connects to LOSHN ' +
        '(route building), so the SID is issued in place of the heading',
    );
    expect(result.citations.map((citation) => citation.id)).toEqual([
      'OAK-SFOW-S-SKYL',
      'CONN-WAGES-LOSHN',
      'R-ROUTE-BUILD',
    ]);
  });

  it('prefers a transition over the end fix where both reach the filed route equally soon', () => {
    const airport: AirportData = {
      ...koak,
      routeConnections: [
        ...koak.routeConnections,
        {
          id: 'CONN-PXN-LOSHN',
          from: 'PXN',
          to: 'LOSHN',
          connects: 'usually',
          source: 'a test row',
          text: 'PXN usually connects to LOSHN',
        },
      ],
    };
    const result = amendmentAt(pxt415(), airport);
    expect(result.proposed).toBe('SKYL1 PXN LOSHN PMD V137 PSP');
    expect(result.reason).toContain('but PXN is and PXN usually connects to LOSHN');
    expect(result.citations.map((citation) => citation.id)).toEqual([
      'OAK-SFOW-S-SKYL',
      'CONN-PXN-LOSHN',
      'R-ROUTE-BUILD',
    ]);
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

describe('checkRoute on the runway heading', () => {
  /** The non-RNAV prop the noise window sends off 01L with no procedure at all (SFOW-NOISE-P-RWY). */
  function c172(overrides: Partial<Scenario> = {}): Scenario {
    return scenario({
      callsign: 'N172SP',
      aircraftType: 'C172',
      equipmentSuffix: '/A',
      destination: 'KMYV',
      filedRoute: 'GAPP7 OAK V6 SAC',
      filedAltitude: 5000,
      departureRunway: '01L',
      localTime: '2300',
      squawk: '4620',
      ...overrides,
    });
  }

  it('amends a plan that files a procedure down to the tail, and says why', () => {
    const flight = c172();
    expect(amendment(flight).proposed).toBe('OAK V6 SAC');
    expect(amendment(flight).reason).toBe(
      'SFOW-NOISE-P-RWY sends a non-RNAV piston off 01L on the runway heading with no departure ' +
        'procedure',
    );
    expect(citations(flight)).toEqual(['SFOW-NOISE-P-RWY', 'R-HEADING']);
  });

  it('names the row and the heading in degrees where the row assigns one', () => {
    const numbered: AssignmentRule = {
      id: 'SFOW-28-270',
      source: 'test row',
      text: 'SFOW: props off the 28s -> turn onto 270, no DP',
      plan: 'SFOW',
      direction: 'any',
      runwayFamilies: ['28'],
      classes: ['P'],
      sidFamily: null,
      nonDpHeading: 270,
      sector: 'richmond',
    };
    const airport: AirportData = {
      ...ksfo,
      assignmentRules: [numbered, ...ksfo.assignmentRules],
    };
    const flight = c172({
      destination: 'KSMF',
      departureRunway: '28L',
      runwayConfigId: '28 RT',
      localTime: '1400',
    });
    const result = amendmentAt(flight, airport);
    expect(result.proposed).toBe('OAK V6 SAC');
    expect(result.reason).toBe(
      'SFOW-28-270 sends a non-RNAV piston off 28L on heading 270 with no departure procedure',
    );
  });

  it('leaves a plan that files no procedure alone', () => {
    expect(check(c172({ filedRoute: 'OAK V6 SAC' }))).toBeUndefined();
  });

  it('passes over a TEC row that begins on a departure the flight is not issued', () => {
    const flight = c172({ filedRoute: 'SFO5 OAK V6 SAC' });
    expect(amendment(flight).proposed).toBe('OAK V6 SAC');
  });
});

describe('checkRoute letters of agreement', () => {
  /** An LOA routing row for one destination whose fixes no route in these tests names. */
  function loaRow(destination: string, narrowing: LoaRouteNarrowing): LoaRule {
    return {
      id: 'LOA-TEST-ROUTE',
      source: 'a test row',
      text: 'the test routing',
      destinations: [destination],
      rule: { kind: 'route', tokens: ['ZZZZZ'], ...narrowing },
    };
  }

  function airportWith(row: LoaRule): AirportData {
    return { ...ksfo, loaRules: [row, ...ksfo.loaRules] };
  }

  /** The non-RNAV piston the noise window sends off 01L, filed as its route box should read. */
  function n172sp(): Scenario {
    return scenario({
      callsign: 'N172SP',
      aircraftType: 'C172',
      equipmentSuffix: '/A',
      destination: 'KMYV',
      filedRoute: 'OAK V6 SAC',
      filedAltitude: 5000,
      departureRunway: '01L',
      localTime: '2300',
      squawk: '4620',
    });
  }

  const gap = { element: 'BOX.route', reason: expect.stringContaining('LOA-TEST-ROUTE') };

  it('reports the route box unresolved when no LOA routing fix is on the route', () => {
    const result = check(scenario({ destination: 'KPDX', filedRoute: 'TRUKN2 DEDHD LMT OCITY7' }));
    expect(result).toEqual({
      element: 'BOX.route',
      reason: expect.stringContaining('LOA-ZSE-PDX-ROUTE'),
    });
  });

  it('holds a row written for jets against a jet and passes over it for a prop', () => {
    const jet = scenario({});
    expect(checkAt(jet, airportWith(loaRow('KSEA', { classes: ['J'] })))).toEqual(gap);
    expect(checkAt(n172sp(), airportWith(loaRow('KMYV', {})))).toEqual(gap);
    expect(checkAt(n172sp(), airportWith(loaRow('KMYV', { classes: ['J'] })))).toBeUndefined();
  });

  it('holds a row written for the RNAV column against an RNAV flight only', () => {
    const rnav = scenario({});
    expect(checkAt(rnav, airportWith(loaRow('KSEA', { rnavOnly: true })))).toEqual(gap);
    expect(checkAt(n172sp(), airportWith(loaRow('KMYV', {})))).toEqual(gap);
    expect(checkAt(n172sp(), airportWith(loaRow('KMYV', { rnavOnly: true })))).toBeUndefined();
  });
});
