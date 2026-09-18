import { describe, expect, it } from 'vitest';
import koakJson from '@data/koak.json';
import ksfoJson from '@data/ksfo.json';
import type {
  AirportData,
  AssignmentRule,
  CommonArrival,
  LoaRule,
  LoaRuleKind,
  Notice,
  Scenario,
  TecRoute,
} from '@/data/schema.ts';
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

/**
 * The airport with no fix published as an RNAV waypoint.
 *
 * A route over one is flown only by an RNAV-capable aircraft, which is the type box's rule rather
 * than the route box's: a check that is about which procedure the SOP assigns, or which route is
 * built from it, is read against a data set where no fix carries that second question.
 */
function withoutRnavWaypoints(airport: AirportData): AirportData {
  return { ...airport, rnavWaypoints: [] };
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
    expect(amendment(flight).arrivalSwap).toBe('GAPP7 SFO EBAYE AVE SADDE8');
    expect(amendment(flight).reason).toContain(
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
    expect(amendment(flight).arrivalSwap).toBe('SSTIK5 YYUNG LAX COMIX2');
    expect(citations(flight)).toContain('SFO-SEGUL-OFF');
  });
});

describe('checkRoute departure structure', () => {
  /** The worksheet plan that files the fix its departure flies over, then a transition of it. */
  function fft2015(overrides: Partial<Scenario> = {}): Scenario {
    return scenario({
      callsign: 'FFT2015',
      aircraftType: 'A20N',
      destination: 'KLAX',
      filedRoute: 'PORTE8 PORTE SUSEY EBAYE BURGL',
      filedAltitude: 29000,
      departureRunway: '28L',
      runwayConfigId: '28 RT',
      squawk: '4612',
      ...overrides,
    });
  }

  it('reads a KSFO plan from the transition rather than the base fix the SID flies over', () => {
    const result = amendment(fft2015());
    expect(result.proposed).toBe('WESLA5 SUSEY EBAYE BURGL');
    expect(result.citations.map((citation) => citation.id)).toContain('R-SID-STRUCTURE');
  });

  it('reads a KOAK plan past the procedure name and the base fix filed as route elements', () => {
    const flight = fft2015({
      filedRoute: 'CNDEL PORTE SUSEY EBAYE BURGL',
      departureRunway: '30',
      runwayConfigId: 'SFOW',
    });
    const result = amendmentAt(flight, koak);
    expect(result.proposed).toBe('CNDEL5 SUSEY EBAYE BURGL');
    expect(result.citations.map((citation) => citation.id)).toContain('R-SID-STRUCTURE');
  });

  it('amends a plan whose procedure is right and whose only fault is the structure fix', () => {
    const result = amendment(fft2015({ filedRoute: 'WESLA5 PORTE SUSEY EBAYE BURGL' }));
    expect(result.proposed).toBe('WESLA5 SUSEY EBAYE BURGL');
    expect(result.reason).toBe(
      'PORTE lies on the WESLA5 structure; the route is read from its published transition SUSEY',
    );
    expect(result.warning).toBeUndefined();
  });

  it('cites the structure rule on a KOAK box the route builder reads past the base fix in', () => {
    const flight = fft2015({
      destination: 'KSBA',
      filedRoute: 'CNDEL5 PORTE AVE GVO',
      departureRunway: '30',
      runwayConfigId: 'SFOW',
    });
    const result = amendmentAt(flight, koak);
    expect(result.proposed).toBe('CNDEL5 YYUNG GVO');
    expect(result.citations.map((citation) => citation.id)).toContain('R-SID-STRUCTURE');
    expect(result.reason).toBe(
      'CNDEL5 is the procedure the SOP assigns an RNAV jet from 30 in SFOW, and AVE is not one of ' +
        'its transitions, but YYUNG is and YYUNG usually connects to GVO (route building), so the ' +
        'SID is kept, and PORTE lies on the SKYL1 structure; the route is read from its published ' +
        'transition AVE',
    );
  });

  it('leaves a base fix the route files no transition of that SID after alone', () => {
    const flight = scenario({
      callsign: 'N221TB',
      aircraftType: 'TBM9',
      equipmentSuffix: '/G',
      destination: 'KSMF',
      filedRoute: 'TRUKN2 TRUKN FEVTA FEVTA1',
      filedAltitude: 11000,
      localTime: '1230',
      squawk: '4117',
    });
    expect(check(flight)).toBeUndefined();
  });
});

describe('checkRoute malformed route element', () => {
  /** The worksheet plan that files BVL and Q124 run together as one element of its route. */
  function ual313(overrides: Partial<Scenario> = {}): Scenario {
    return scenario({
      callsign: 'UAL313',
      aircraftType: 'B752',
      destination: 'KSLC',
      filedRoute: 'TRUKN2 MOGEE BVLQ124 BVL WAATS5',
      filedAltitude: 33000,
      departureRunway: '28L',
      runwayConfigId: '28 RT',
      squawk: '4614',
      ...overrides,
    });
  }

  it('drops the element that names nothing and connects the fixes either side of it', () => {
    const result = amendment(ual313());
    expect(result.proposed).toBe('TRUKN2 MOGEE Q124 BVL WAATS5');
    expect(result.reason).toBe(
      'BVLQ124 names no fix, navaid, airway or procedure; the route is connected MOGEE Q124 BVL',
    );
    expect(result.citations.map((citation) => citation.id)).toContain('R-ROUTE-TOKEN');
    expect(result.warning).toBeUndefined();
  });

  it('repairs the KOAK twin of the same plan, whose box carries the airport navaid', () => {
    const flight = ual313({
      filedRoute: 'OAK6 MOGEE BVLQ124 BVL WAATS5',
      departureRunway: '30',
      runwayConfigId: 'SFOW',
    });
    const result = amendmentAt(flight, koak);
    expect(result.proposed).toBe('OAK6 OAK MOGEE Q124 BVL WAATS5');
    expect(result.citations.map((citation) => citation.id)).toContain('R-ROUTE-TOKEN');
    expect(result.warning).toBeUndefined();
  });

  it('joins the fixes either side direct where no chain of rows connects them', () => {
    const result = amendment(
      ual313({
        destination: 'KSEA',
        filedRoute: 'TRUKN2 DEDHD RBLLMT LMT HAWKZ7',
        departureRunway: '01R',
        runwayConfigId: '28/01',
      }),
    );
    expect(result.proposed).toBe('TRUKN2 DEDHD LMT HAWKZ7');
    expect(result.reason).toBe(
      'RBLLMT names no fix, navaid, airway or procedure; the route is connected DEDHD LMT',
    );
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
    expect(amendment(flight).arrivalSwap).toBe('SSTIK5 SUSEY EBAYE AVE SADDE8');
    expect(amendment(flight).reason).toContain(
      'SSTIK5 is the procedure the SOP assigns an RNAV jet from 01L in 28/01, and EBAYE is not one ' +
        'of its transitions, but SUSEY is and SUSEY always connects to EBAYE (route building), so ' +
        'the SID is kept',
    );
    expect(citations(flight).slice(0, 3)).toEqual([
      'SFOW-S-SSTIK-01',
      'CONN-SUSEY-EBAYE',
      'R-ROUTE-BUILD',
    ]);
  });

  it('builds a two-hop chain over a connection that usually holds, and says so', () => {
    const flight = swa984({ filedRoute: 'SSTIK5 BOILE EHF SADDE8' });
    expect(amendment(flight).arrivalSwap).toBe('SSTIK5 KAYEX LOSHN BOILE EHF SADDE8');
    expect(amendment(flight).reason).toContain('LOSHN usually connects to BOILE');
    expect(citations(flight).slice(0, 4)).toEqual([
      'SFOW-S-SSTIK-01',
      'CONN-KAYEX-LOSHN',
      'CONN-LOSHN-BOILE',
      'R-ROUTE-BUILD',
    ]);
  });

  it('falls back to the vector SID when no connection reaches the filed route', () => {
    const flight = swa984({ filedRoute: 'SSTIK5 OSI SNS SADDE8' });
    expect(amendment(flight).arrivalSwap).toBe('GAPP7 SFO OSI SNS SADDE8');
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
      filedRoute: 'GAPP7 SFO EHF LHS V459 SLI V23 OCN',
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
    const result = amendmentAt(pxt415(), withoutRnavWaypoints(koak));
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
      ...withoutRnavWaypoints(koak),
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
      'SFO5 SFO RBL J1 OED J501 TOU J523 YZT J502 ANN… (continued)',
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
      filedRoute: 'GAPP7 SFO TRUKN FEVTA FEVTA1',
      filedAltitude: 9000,
      departureRunway: '28R',
    });
    expect(checkAt(flight, withoutRnavWaypoints(ksfo))).toBeUndefined();
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
      filedRoute: 'GAPP7 SFO TRUKN FEVTA FEVTA1',
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
    expect(amendment(flight).proposed).toBe('GAPP7 SFO OAK V244 ALTAM MOD');
    expect(citations(flight)).toContain('TEC-KLVK-SFOW-JT-28');
  });
});

describe('checkRoute a TEC route over the SOP assignment', () => {
  function clearanceAt(flight: Scenario, airport: AirportData) {
    const result = resolveClearance(flight, airport);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    return result.clearance;
  }

  /** The KSFO RNAV jet off 28L in 28/01 to KSMF, filed on its TEC route. */
  function ksmfJet(overrides: Partial<Scenario> = {}): Scenario {
    return scenario({
      destination: 'KSMF',
      filedRoute: 'TRUKN2 TRUKN FEVTA FEVTA1',
      filedAltitude: 10000,
      departureRunway: '28L',
      ...overrides,
    });
  }

  /** The KOAK RNAV jet off 10R in SFOE to KMRY, filed direct to the TEC route's first fix. */
  function kmryJet(overrides: Partial<Scenario> = {}): Scenario {
    return scenario({
      destination: 'KMRY',
      filedRoute: 'EUGEN',
      filedAltitude: 11000,
      runwayConfigId: 'SFOE',
      departureRunway: '10R',
      ...overrides,
    });
  }

  it('issues TRUKN2 off 28L in 28 RT, where TRUKN is in use, citing the TEC row beside the SOP row', () => {
    const heavy = { aircraftType: 'B77L', runwayConfigId: '28 RT' };
    const procedure = clearanceAt(ksmfJet(heavy), ksfo).procedure;
    expect(procedure.value).toMatchObject({ kind: 'sid', id: 'TRUKN2' });
    const ids = procedure.citations.map((citation) => citation.id);
    expect(ksfo.assignmentRules.map((row) => row.id)).toContain(ids[0]);
    expect(ids[1]).toBe('TEC-KSMF-SFOW-J');
  });

  it('leaves the SOP answer off 28L in 28/01, where TRUKN is not in use off the 28s', () => {
    const procedure = clearanceAt(ksmfJet({ aircraftType: 'B77L' }), ksfo).procedure;
    expect(procedure.value).not.toMatchObject({ kind: 'sid', id: 'TRUKN2' });
    expect(procedure.citations.map((citation) => citation.id)).not.toContain('TEC-KSMF-SFOW-J');
  });

  it('issues the TEC row SID over a SOP heading and routes the box on it', () => {
    const flight = kmryJet();
    expect(clearanceAt(flight, koak).procedure.value).toMatchObject({ kind: 'sid', id: 'OAK6' });
    expect(amendmentAt(flight, koak).proposed).toBe('OAK6 OAK EUGEN');
  });

  it('keeps a noise-window heading and routes the box on the TEC route after its departure', () => {
    const flight = kmryJet({ localTime: '2300' });
    expect(clearanceAt(flight, koak).procedure.value).toMatchObject({
      kind: 'heading',
      heading: 140,
    });
    expect(amendmentAt(flight, koak).proposed).toBe('OAK EUGEN');
  });

  it('keeps a noise-window SID and joins it onto the TEC route after its departure', () => {
    const niite = ksfo.sids.find((sid) => sid.family === 'NIITE');
    if (niite === undefined) throw new Error('KSFO publishes no NIITE departure');
    const flight = ksmfJet({ runwayConfigId: '28 RT', localTime: '2300', dayOfWeek: 'tuesday' });
    expect(clearanceAt(flight, ksfo).procedure.value).toMatchObject({ kind: 'sid', id: niite.id });
    const box = amendment(flight).proposed.split(' ');
    expect(box[0]).toBe(niite.id);
    expect(box.slice(-2)).toEqual(['FEVTA', 'FEVTA1']);
    const cited = citations(flight).filter((id) => id === 'TEC-KSMF-SFOW-J');
    expect(cited).toEqual(['TEC-KSMF-SFOW-J']);
  });

  it('reads the noise row from the TEC route direction, not the direction the plan files', () => {
    const niite = ksfo.sids.find((sid) => sid.family === 'NIITE');
    if (niite === undefined) throw new Error('KSFO publishes no NIITE departure');
    const southbound = ksmfJet({
      departureRunway: '01R',
      filedRoute: 'SSTIK5 SUSEY',
      localTime: '2300',
    });
    const procedure = clearanceAt(southbound, ksfo).procedure;
    expect(procedure.value).toMatchObject({ kind: 'sid', id: niite.id });
    expect(procedure.citations[0]?.id).toBe('SFOW-NOISE-N-NIITE');
  });

  it('joins a noise-window SID onto a heading-headed TEC route as onto a family-headed one', () => {
    const headingRow: TecRoute = {
      id: 'TEST-KSMF-SFOW-H',
      source: 'test row',
      kind: 'tec',
      destination: 'KSMF',
      plan: 'SFOW',
      runwayFamilies: [],
      classes: ['J'],
      route: 'H030 TRUKN FEVTA FEVTA1',
      finalAltitudeFeet: 10000,
    };
    const airport: AirportData = { ...ksfo, tecRoutes: [headingRow, ...ksfo.tecRoutes] };
    const flight = ksmfJet({ departureRunway: '01R', localTime: '2300' });
    expect(clearanceAt(flight, airport).procedure.value).toMatchObject({
      kind: 'sid',
      family: 'NIITE',
    });
    expect(amendmentAt(flight, airport).proposed).toBe(amendment(flight).proposed);
    expect(amendmentAt(flight, airport).proposed.split(' ')[0]).toMatch(/^NIITE\d$/);
  });

  it.each([
    ['prop', 'C172'],
    ['turboprop', 'BE20'],
  ])('turns a KOAK OAKE %s to KSFO onto the TEC row heading 270, not the SOP 090', (_, type) => {
    const flight = scenario({
      callsign: 'N172SP',
      aircraftType: type,
      equipmentSuffix: '/G',
      destination: 'KSFO',
      filedRoute: 'OSI',
      filedAltitude: 5000,
      runwayConfigId: 'OAKE',
      departureRunway: '10R',
    });
    const procedure = clearanceAt(flight, koak).procedure;
    expect(procedure.value).toMatchObject({ kind: 'heading', heading: 270 });
    expect(procedure.citations.map((citation) => citation.id)).toContain('TEC-KSFO-OAKE-JTP');
  });

  it('clears the heading a notice issues for the TEC row family, the box on the route after it', () => {
    const notice: Notice = {
      id: 'TEST-TRUKN-OFF',
      source: 'test notice',
      dated: '2026-09-18',
      text: 'TRUKN SID: OFF. Issue 300 HDG',
      plan: 'SFOW',
      effect: { kind: 'sid_off', sidFamily: 'TRUKN', heading: 300 },
      defaultActive: false,
    };
    const truknRow: AssignmentRule = {
      id: 'TEST-SFOW-TRUKN-28',
      source: 'test row',
      text: 'SFOW: jets off the 28s -> TRUKN#',
      plan: 'SFOW',
      direction: 'any',
      runwayFamilies: ['28'],
      classes: ['J'],
      sidFamily: 'TRUKN',
      sector: 'richmond',
    };
    const airport: AirportData = {
      ...ksfo,
      notices: [...ksfo.notices, notice],
      assignmentRules: [...ksfo.assignmentRules, truknRow],
    };
    const flight = ksmfJet({ activeNotices: [notice.id] });
    const procedure = clearanceAt(flight, airport).procedure;
    expect(procedure.value).toMatchObject({ kind: 'heading', heading: 300, turn: 'right' });
    expect(procedure.citations.map((citation) => citation.id)).toEqual([
      truknRow.id,
      notice.id,
      'R-HEADING',
    ]);
    expect(amendmentAt(flight, airport).proposed).toBe('TRUKN FEVTA FEVTA1');
  });
});

describe('the sector of a departure a TEC route supplies', () => {
  function clearanceAt(flight: Scenario, airport: AirportData) {
    const result = resolveClearance(flight, airport);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    return result.clearance;
  }

  /** The row and sector the clearance hands the flight off on. */
  function handoff(flight: Scenario, airport: AirportData): [string | undefined, string] {
    const clearance = clearanceAt(flight, airport);
    return [clearance.procedure.citations[0]?.id, clearance.frequency.value.sectorId];
  }

  it('reads SFO# off its one row, Richmond, for a route that leaves over ALTAM in no gate', () => {
    const flight = scenario({
      equipmentSuffix: '/A',
      destination: 'KLVK',
      filedRoute: 'SFO5 V244 ALTAM MOD',
      filedAltitude: 5000,
    });
    expect(clearanceAt(flight, ksfo).procedure.citations.map((citation) => citation.id)).toContain(
      'TEC-KLVK-SFOW-JT-01',
    );
    expect(handoff(flight, ksfo)).toEqual(['SFOW-N-SFO-01', 'richmond']);
  });

  it.each([
    ['KMYV', 'GAPP7 SFO OAK V6 SAC', 'SFOW-N-GAPP-28', 'richmond'],
    ['KSJC', 'GAPP7 SFO OSI SJC', 'SFOW-S-GAPP', 'sutro'],
  ])(
    'reads GAPP# off the 28s to %s by the TEC route direction',
    (destination, route, row, sector) => {
      const flight = scenario({
        callsign: 'N172SP',
        aircraftType: 'C172',
        equipmentSuffix: '/A',
        destination,
        filedRoute: route,
        filedAltitude: 5000,
        departureRunway: '28R',
      });
      expect(handoff(flight, ksfo)).toEqual([row, sector]);
    },
  );

  it('falls back to the walked row for KOAK SFOE OAK#, which has no row south', () => {
    const flight = scenario({
      destination: 'KMRY',
      filedRoute: 'EUGEN',
      filedAltitude: 11000,
      runwayConfigId: 'SFOE',
      departureRunway: '10R',
    });
    expect(clearanceAt(flight, koak).procedure.value).toMatchObject({ kind: 'sid', id: 'OAK6' });
    expect(handoff(flight, koak)).toEqual(['OAK-B-SFOE-J-RWY-S', 'sutro']);
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
    const flight = c172({ destination: 'KTRK' });
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
      destination: 'KTRK',
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

  it('routes a noise-window heading on the TEC route after the departure the row begins on', () => {
    const flight = c172({ filedRoute: 'SFO5 OAK V6 SAC' });
    expect(amendment(flight).proposed).toBe('OAK V6 SAC');
  });
});

describe('checkRoute vector-SID navaid', () => {
  /** The KOAK jet the SOP clears on the OAK6, whose box files the vector SID and the navaid. */
  function swa126(overrides: Partial<Scenario> = {}): Scenario {
    return scenario({
      callsign: 'SWA126',
      aircraftType: 'B737',
      destination: 'KSEA',
      filedRoute: 'OAK6 OAK DEDHD RBL LMT HAWKZ7',
      filedAltitude: 32000,
      runwayConfigId: 'SFOW',
      departureRunway: '30',
      squawk: '4614',
      ...overrides,
    });
  }

  it('warns, rather than corrects, where the box files a vector SID without the navaid', () => {
    const flight = scenario({
      callsign: 'KAL65',
      aircraftType: 'B77L',
      destination: 'RKSI',
      filedRoute: 'SFO5 RBL J1 OED J501 TOU J523 YZT J502 ANN… (continued)',
      filedAltitude: 30000,
    });
    const result = amendment(flight);
    expect(result.proposed).toBe('SFO5 SFO RBL J1 OED J501 TOU J523 YZT J502 ANN… (continued)');
    expect(result.warning).toBe(true);
    expect(result.reason).toBe(
      'the route names SFO5 without SFO after it; a radar-vector SID is filed as the SID, the ' +
        'airport navaid, then the route (R-RV-NAVAID)',
    );
    expect(citations(flight)).toEqual(['R-RV-NAVAID']);
  });

  it('leaves a box that already files the vector SID and the navaid alone', () => {
    const flight = scenario({
      callsign: 'KAL65',
      aircraftType: 'B77L',
      destination: 'RKSI',
      filedRoute: 'SFO5 SFO RBL J1 OED J501 TOU J523 YZT J502 ANN… (continued)',
      filedAltitude: 30000,
    });
    expect(check(flight)).toBeUndefined();
  });

  it('writes the navaid into a TEC route that begins on a vector SID', () => {
    const flight = scenario({
      aircraftType: 'TBM9',
      equipmentSuffix: '/L',
      destination: 'KMYV',
      filedRoute: 'SFO5 OAK V6 SAC',
      filedAltitude: 5000,
      departureRunway: '28R',
    });
    expect(amendment(flight).proposed).toBe('GAPP7 SFO OAK V6 SAC');
    expect(citations(flight)).toContain('TEC-KMYV-SFOW-TP-28');
  });

  it('writes the navaid once into the box of a plan filed with no procedure', () => {
    const flight = swa126({ filedRoute: 'DEDHD RBL LMT HAWKZ7' });
    expect(amendmentAt(flight, koak).proposed).toBe('OAK6 OAK DEDHD RBL LMT HAWKZ7');
    expect(checkAt(swa126(), koak)).toBeUndefined();
  });

  it('warns on a KOAK box that files the OAK6 without OAK', () => {
    const flight = swa126({ filedRoute: 'OAK6 DEDHD RBL LMT HAWKZ7' });
    const result = amendmentAt(flight, koak);
    expect(result.proposed).toBe('OAK6 OAK DEDHD RBL LMT HAWKZ7');
    expect(result.warning).toBe(true);
    expect(result.citations.map((citation) => citation.id)).toEqual(['R-RV-NAVAID']);
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
      destination: 'KTRK',
      filedRoute: 'OAK V6 SAC',
      filedAltitude: 5000,
      departureRunway: '01L',
      localTime: '2300',
      squawk: '4620',
    });
  }

  const gap = { element: 'BOX.route', reason: expect.stringContaining('LOA-TEST-ROUTE') };

  /** The RNAV jet whose Portland route meets no LOA fix and reaches no arrival it can fly. */
  function pdxJet(): Scenario {
    return scenario({ destination: 'KPDX', filedRoute: 'TRUKN2 DEDHD LMT TMBRS4' });
  }

  it('reports the route box unresolved when no LOA routing fix is on the route', () => {
    expect(check(pdxJet())).toEqual({
      element: 'BOX.route',
      reason: expect.stringContaining('LOA-ZSE-PDX-ROUTE'),
    });
  });

  it('holds a row written for jets against a jet and passes over it for a prop', () => {
    expect(checkAt(pdxJet(), airportWith(loaRow('KPDX', { classes: ['J'] })))).toEqual(gap);
    expect(checkAt(n172sp(), airportWith(loaRow('KTRK', {})))).toEqual(gap);
    expect(checkAt(n172sp(), airportWith(loaRow('KTRK', { classes: ['J'] })))).toBeUndefined();
  });

  it('holds a row written for the RNAV column against an RNAV flight only', () => {
    expect(checkAt(pdxJet(), airportWith(loaRow('KPDX', { rnavOnly: true })))).toEqual(gap);
    expect(checkAt(n172sp(), airportWith(loaRow('KTRK', {})))).toEqual(gap);
    expect(checkAt(n172sp(), airportWith(loaRow('KTRK', { rnavOnly: true })))).toBeUndefined();
  });
});

describe('checkRoute arrivals', () => {
  /** The worksheet plan of an RNAV jet to Los Angeles filed on the conventional SADDE arrival. */
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

  /** A KOAK plan off 30 in the south-flow plan, which is where the worksheet's flights depart. */
  function offOakland(overrides: Partial<Scenario>): Scenario {
    return scenario({
      runwayConfigId: 'SFOW',
      departureRunway: '30',
      ...overrides,
    });
  }

  it('puts an RNAV jet filing the conventional SADDE8 onto IRNMN2 via BURGL and keeps the built SID', () => {
    const flight = swa984();
    const result = amendment(flight);
    expect(result.proposed).toBe('SSTIK5 SUSEY EBAYE BURGL IRNMN2');
    expect(result.arrivalSwap).toBe('SSTIK5 SUSEY EBAYE AVE SADDE8');
    expect(result.warning).toBeUndefined();
    expect(citations(flight)).toEqual(
      expect.arrayContaining(['CA-LAX-IRNMN', 'CONN-EBAYE-BURGL', 'R-ARRIVAL']),
    );
  });

  it('keeps the filed fix that connects to the arrival off a radar-vector SID', () => {
    const result = amendment(swa984({ departureRunway: '28L', runwayConfigId: '28 SO' }));
    expect(result.proposed).toBe('GAPP7 SFO EBAYE BURGL IRNMN2');
    expect(result.arrivalSwap).toBe('GAPP7 SFO EBAYE AVE SADDE8');
  });

  /** The worksheet plan of a non-RNAV jet to Los Angeles filed on the RNAV IRNMN arrival. */
  function nks510(overrides: Partial<Scenario> = {}): Scenario {
    return offOakland({
      callsign: 'NKS510',
      aircraftType: 'A320',
      equipmentSuffix: '/A',
      destination: 'KLAX',
      filedRoute: 'CNDEL5 SUSEY EBAYE BURGL IRNMN2',
      filedAltitude: 35000,
      squawk: '4611',
      ...overrides,
    });
  }

  it('issues the conventional southbound SID onto SADDE8 for a non-RNAV jet filing IRNMN2', () => {
    const result = amendmentAt(nks510(), koak);
    expect(result.proposed).toBe('SKYL1 AVE SADDE8');
    expect(result.arrivalSwap).toBe('SUSEY EBAYE BURGL IRNMN2');
    const cited = result.citations.map((citation) => citation.id);
    expect(cited[0]).toBe('OAK-SFOW-S-SKYL');
    expect(cited).toEqual(expect.arrayContaining(['CA-LAX-SADDE', 'R-ARRIVAL']));
    expect(cited).not.toContain('R-HEADING');
  });

  it('leaves a non-RNAV jet filing SKYL1 AVE SADDE8 as filed', () => {
    const flight = nks510({ filedRoute: 'SKYL1 AVE SADDE8', filedAltitude: 27000 });
    expect(checkAt(flight, koak)).toBeUndefined();
  });

  it('reroutes a box that meets no LOA token onto the transition the LOA names', () => {
    const flight = offOakland({
      callsign: 'N858EE',
      aircraftType: 'E55P',
      equipmentSuffix: '/Z',
      destination: 'KCRQ',
      filedRoute: 'COAST8 MCKEY LEGOZ LEGOZ1',
      filedAltitude: 37000,
      squawk: '4610',
    });
    const result = amendmentAt(flight, koak);
    expect(result.proposed).toBe('CNDEL5 YYUNG TILLT LEGOZ4');
    expect(result.arrivalSwap).toBe('MCKEY LEGOZ LEGOZ1');
    expect(result.reason).toContain(
      'LOA-ZLA-CRQ-ROUTE routes CRQ via BURGL, TILLT, REBRG, LANDO, DERBB, FIM, EHF or LHS and ' +
        'the route names none of them',
    );
  });

  it('keeps the filed fixes and continues to the entry fix off a radar-vector SID', () => {
    const flight = offOakland({
      callsign: 'SWA2021',
      aircraftType: 'B738',
      equipmentSuffix: '/G',
      destination: 'KPDX',
      filedRoute: 'OAK6 DEDHD LMT OCITY7',
      filedAltitude: 35000,
      squawk: '4604',
    });
    const result = amendmentAt(flight, koak);
    expect(result.proposed).toBe('OAK6 OAK DEDHD LMT MACHU TMBRS4');
    expect(result.arrivalSwap).toBe('OAK6 OAK DEDHD LMT OCITY7');
    expect(result.reason).toContain('so the flight continues to MACHU for TMBRS4');
  });

  it('reports the box unresolved when no arrival of the class is reachable', () => {
    const flight = scenario({
      callsign: 'SWA2021',
      equipmentSuffix: '/G',
      destination: 'KPDX',
      filedRoute: 'TRUKN2 DEDHD LMT OCITY7',
      filedAltitude: 35000,
      departureRunway: '28L',
      runwayConfigId: '28 RT',
      squawk: '4604',
    });
    expect(check(flight)).toEqual({
      element: 'BOX.route',
      reason: expect.stringContaining('LOA-ZSE-PDX-ROUTE'),
    });
  });

  it('leaves a stale arrival revision alone where nothing else is wrong', () => {
    expect(check(scenario({ filedRoute: 'TRUKN2 DEDHD RBL LMT HAWKZ7' }))).toBeUndefined();
  });

  it('leaves a conventional arrival alone where the common-arrivals sheet does not list the field', () => {
    const flight = offOakland({
      callsign: 'FDX3875',
      aircraftType: 'MD11',
      destination: 'PHNL',
      filedRoute: 'BEBOP R464 BILLO R464 BITTA MAGGI3',
      filedAltitude: 31000,
      squawk: '4613',
    });
    expect(checkAt(flight, koak)).toBeUndefined();
  });

  it('leaves the box alone when the class trigger reaches no arrival', () => {
    const flight = scenario({
      destination: 'KLAX',
      filedRoute: 'SSTIK5 SUSEY EBAYE DERBB SADDE8',
      filedAltitude: 35000,
      departureRunway: '01L',
    });
    const airport: AirportData = { ...ksfo, routeConnections: [] };
    expect(checkAt(flight, airport)).toBeUndefined();
  });

  it('never swaps the arrival of a TRACON destination', () => {
    const flight = scenario({
      aircraftType: 'BE20',
      equipmentSuffix: '/A',
      destination: 'KSMF',
      filedRoute: 'GAPP7 SFO TRUKN FEVTA FEVTA1',
      filedAltitude: 9000,
      departureRunway: '28R',
    });
    const cell: CommonArrival = {
      id: 'CA-SMF-TEST',
      source: 'a test row',
      text: 'the test sheet cell',
      destinations: ['KSMF'],
      family: 'SLMMR',
      transitions: ['NURAY'],
    };
    const plain = withoutRnavWaypoints(ksfo);
    const airport: AirportData = { ...plain, commonArrivals: [cell, ...ksfo.commonArrivals] };
    expect(checkAt(flight, plain)).toBeUndefined();
    expect(checkAt(flight, airport)).toBeUndefined();
  });

  it('excludes an arrival the sheet reserves for cargo from a passenger flight', () => {
    const airport: AirportData = {
      ...ksfo,
      routeConnections: [
        ...ksfo.routeConnections,
        {
          id: 'CONN-SNS-SNAXX',
          from: 'SNS',
          to: 'SNAXX',
          connects: 'usually',
          source: 'a test row',
          text: 'SNS usually connects to SNAXX',
        },
      ],
    };
    const filedRoute = 'SSTIK5 OSI SNS SADDE8';
    const passenger = amendmentAt(swa984({ filedRoute }), airport);
    expect(passenger.proposed).toBe('GAPP7 SFO OSI SNS SNAXX RYDRR2');
    const cargo = swa984({ filedRoute, callsign: 'FDX984', aircraftType: 'B752' });
    expect(amendmentAt(cargo, airport).proposed).toBe('GAPP7 SFO OSI SNS SNAXX BAYST1');
  });
});

describe('checkRoute on the bare GAPP# TEC route', () => {
  it('boxes a KSFO SFOE turboprop to KOAK as GAPP7 SFO, radar vectors direct', () => {
    const flight = scenario({
      aircraftType: 'BE20',
      equipmentSuffix: '/A',
      destination: 'KOAK',
      filedRoute: 'OAK',
      filedAltitude: 3000,
      runwayConfigId: '19/10',
      departureRunway: '10R',
    });
    expect(amendment(flight).proposed).toBe('GAPP7 SFO');
    expect(citations(flight)).toContain('TEC-KOAK-SFOE-TP');
  });
});
