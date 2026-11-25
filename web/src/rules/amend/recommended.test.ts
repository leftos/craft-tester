import { describe, expect, it } from 'vitest';
import koakJson from '@data/koak.json';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario, TecRoute } from '@/data/schema.ts';
import { sidOf } from '@/data/sidOf.ts';
import type { RouteCheckResult } from '@/rules/amend/route.ts';
import { resolveAmendments } from '@/rules/amend/engine.ts';
import { checkRouteWithAlternative } from '@/rules/amend/route.ts';
import type { AmendmentResult } from '@/rules/amend/types.ts';
import type { Handling } from '@/rules/classify.ts';
import { classify } from '@/rules/classify.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { recommendedToolRoute } from '@/rules/tecRoutes.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

const koak = koakJson as unknown as AirportData;
const ksfo = ksfoJson as unknown as AirportData;
const nimi = sidOf(koak, 'NIMI').id;
const oak = sidOf(koak, 'OAK').id;
const quake = sidOf(koak, 'QUAKE').id;
const hussh = sidOf(koak, 'HUSSH').id;

/** QXE416, a DH8D that ZOA CPS-004 3.1 proposes the jet rows to, bound for KAPC off 30 in SFOW. */
const QXE416: Scenario = {
  callsign: 'QXE416',
  aircraftType: 'DH8D',
  equipmentSuffix: '/L',
  destination: 'KAPC',
  filedRoute: `${quake} OAK V195 CROIT V108 SGD`,
  filedAltitude: 4000,
  runwayConfigId: 'SFOW',
  departureRunway: '30',
  localTime: '1400',
  dayOfWeek: 'tuesday',
  squawk: '4722',
};

/** N471RY of Amendment Practice 3: an SR22 filed SGD alone, off 28R in SFOW. */
const N471RY: Scenario = {
  callsign: 'N471RY',
  aircraftType: 'SR22',
  equipmentSuffix: '/G',
  destination: 'KAPC',
  filedRoute: 'SGD',
  filedAltitude: 4000,
  runwayConfigId: 'SFOW',
  departureRunway: '28R',
  localTime: '1400',
  dayOfWeek: 'tuesday',
  squawk: '4607',
};

/** The route box check, with the box graded correct beside the expected one. */
function checked(flight: Scenario, handling: Handling = 'proposed'): RouteCheckResult {
  const ctx = classify(flight, koak, handling);
  if (isUnresolved(ctx)) throw new Error(ctx.reason);
  const result = resolveClearance(flight, koak, handling);
  if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
  return checkRouteWithAlternative(flight, ctx, result.clearance, koak);
}

/** The route amendment the check raised, failing the test where it raised none. */
function routeAmendment(check: RouteCheckResult) {
  const { outcome } = check;
  if (outcome === undefined || isUnresolved(outcome) || outcome.box !== 'route') {
    throw new Error('the check raised no route amendment');
  }
  return outcome;
}

describe('checkRouteWithAlternative on a recommended route tool row', () => {
  it('amends a box that needs amending to the tool route, the proposal it replaces correct too', () => {
    const check = checked(QXE416);
    const amendment = routeAmendment(check);
    const previous = `${oak} OAK V195 CROIT V108 SGD`;
    expect(amendment.proposed).toBe(`${oak} OAK SAU`);
    expect(
      amendment.reason.endsWith(
        `, and the ZOA route tool's route for a jet or DH8D in SFOW is ${oak} OAK SAU; ${previous} is correct too`,
      ),
    ).toBe(true);
    expect(amendment.citations.map((citation) => citation.id)).toContain('TOOL-KAPC-SFOW-J');
    expect(check.alsoCorrect).toBe(previous);
  });

  it('leaves a box that needs no amendment as filed, the tool route correct too', () => {
    const check = checked({ ...QXE416, filedRoute: `${oak} OAK V195 CROIT V108 SGD` });
    expect(check.outcome).toBeUndefined();
    expect(check.alsoCorrect).toBe(`${oak} OAK SAU`);
  });

  it('names no other box where the proposal is already the tool route', () => {
    const check = checked({ ...QXE416, filedRoute: `${nimi} OAK SAU` });
    const amendment = routeAmendment(check);
    expect(amendment.proposed).toBe(`${oak} OAK SAU`);
    expect(amendment.reason).toBe(
      `${nimi} is not the procedure the SOP assigns an RNAV jet or DH8D from 30 in SFOW; it is ${oak}`,
    );
    expect(check.alsoCorrect).toBeUndefined();
  });

  it('names a KOAK B738 the way the SOP names the class its J rows read', () => {
    const check = checked({ ...QXE416, aircraftType: 'B738', filedRoute: `${nimi} OAK SAU` });
    expect(routeAmendment(check).reason).toBe(
      `${nimi} is not the procedure the SOP assigns an RNAV jet or DH8D from 30 in SFOW; it is ${oak}`,
    );
  });

  it('amends a piston filed with no procedure to the tool route, the filed tail correct too', () => {
    const check = checked(N471RY);
    const amendment = routeAmendment(check);
    const previous = `${nimi} OAK SGD`;
    expect(amendment.proposed).toBe(`${nimi} OAK SAU`);
    expect(
      amendment.reason.endsWith(
        `, and the ZOA route tool's route for a piston in SFOW is ${nimi} OAK SAU; ${previous} is correct too`,
      ),
    ).toBe(true);
    expect(check.alsoCorrect).toBe(previous);
  });

  it('reads a tool row that begins on a family as written for a flight cleared on a heading', () => {
    const flight: Scenario = {
      ...QXE416,
      runwayConfigId: 'SFOE',
      departureRunway: '10R',
      filedRoute: `${nimi} OAK V195 CROIT V108 SGD`,
    };
    const amendment = routeAmendment(checked(flight));
    expect(amendment.proposed).toBe(`${oak} OAK ALTAM V334 OAKEY V108 SGD`);
    const again = resolveAmendments(
      { ...flight, filedRoute: amendment.proposed },
      koak,
      'proposed',
    );
    if (!again.ok) throw new Error(again.unresolved.map((item) => item.reason).join('; '));
    expect(again.amendments.filter((item) => item.box === 'route')).toEqual([]);
  });

  it('drops the family and the vector navaid of a tool row for a flight the SOP clears on a heading', () => {
    const flight: Scenario = {
      ...QXE416,
      aircraftType: 'B738',
      departureRunway: '28L',
      localTime: '2300',
      filedRoute: `${oak} OAK SAU`,
    };
    const cleared = resolveClearance(flight, koak, 'proposed');
    if (!cleared.ok) throw new Error(cleared.unresolved.map((item) => item.reason).join('; '));
    expect(cleared.clearance.procedure.value.kind).toBe('heading');
    const check = checked(flight);
    const amendment = routeAmendment(check);
    expect(amendment.proposed).toBe('SAU');
    expect(amendment.reason).toBe(
      'the SOP sends an RNAV jet or DH8D off 28L on heading 270 with no departure procedure, ' +
        "and the ZOA route tool's route for a jet or DH8D in SFOW is SAU; OAK SAU is correct too",
    );
    expect(check.alsoCorrect).toBe('OAK SAU');
  });

  it('keeps the airport navaid of a tool row on a transition SID for a flight cleared on a heading', () => {
    const flight: Scenario = {
      ...QXE416,
      aircraftType: 'B738',
      departureRunway: '28L',
      localTime: '2300',
      filedRoute: `${oak} OAK SAU`,
    };
    const ctx = classify(flight, koak, 'proposed');
    if (isUnresolved(ctx)) throw new Error(ctx.reason);
    const id = recommendedToolRoute(ctx, flight, koak)?.id;
    expect(id).toBeDefined();
    const tecRoutes = koak.tecRoutes.map((row) =>
      row.id === id ? { ...row, route: 'CNDEL# OAK SAU' } : row,
    );
    const airport: AirportData = { ...koak, tecRoutes };
    expect(sidOf(airport, 'CNDEL').routePhrasing).not.toBe('radar_vectors_fix');
    const cleared = resolveClearance(flight, airport, 'proposed');
    if (!cleared.ok) throw new Error(cleared.unresolved.map((item) => item.reason).join('; '));
    expect(cleared.clearance.procedure.value.kind).toBe('heading');
    const check = checkRouteWithAlternative(flight, ctx, cleared.clearance, airport);
    expect(routeAmendment(check).proposed).toBe('OAK SAU');
  });

  it('keeps the vector navaid of a tool row where an airway leaves from it', () => {
    const tail = koak.routeLibrary.routes.find((row) => row.destination === 'KCCR')?.tail;
    expect(tail).toBe('OAK V6 COLLI');
    const flight: Scenario = {
      ...QXE416,
      aircraftType: 'B738',
      destination: 'KCCR',
      departureRunway: '28L',
      localTime: '2300',
      filedRoute: tail ?? '',
    };
    const cleared = resolveClearance(flight, koak, 'proposed');
    if (!cleared.ok) throw new Error(cleared.unresolved.map((item) => item.reason).join('; '));
    expect(cleared.clearance.procedure.value.kind).toBe('heading');
    const result = resolveAmendments(flight, koak, 'proposed');
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.corrected.filedRoute).toBe('OAK V6 COLLI');
  });

  it('keeps the navaid of a tool row that begins on no departure family at night', () => {
    const flight: Scenario = {
      ...QXE416,
      aircraftType: 'BE20',
      equipmentSuffix: '/A',
      runwayConfigId: 'SFOE',
      departureRunway: '10R',
      localTime: '2300',
      filedRoute: 'OAK V195 CROIT V108 SGD',
    };
    const cleared = resolveClearance(flight, koak, 'proposed');
    if (!cleared.ok) throw new Error(cleared.unresolved.map((item) => item.reason).join('; '));
    expect(cleared.clearance.procedure.value.kind).toBe('heading');
    const result = resolveAmendments(flight, koak, 'proposed');
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.corrected.filedRoute).toBe('OAK ALTAM V334 OAKEY V108 SGD');
  });

  it('recommends no tool route the flight cannot fly', () => {
    const flight: Scenario = { ...N471RY, equipmentSuffix: '/A' };
    const ctx = classify(flight, koak, 'proposed');
    if (isUnresolved(ctx)) throw new Error(ctx.reason);
    const id = recommendedToolRoute(ctx, flight, koak)?.id;
    const tecRoutes = koak.tecRoutes.map((row) =>
      row.id === id ? { ...row, route: 'NIMI# OAK SYRAH SAU' } : row,
    );
    const airport: AirportData = { ...koak, tecRoutes };
    expect(airport.rnavWaypoints).toContain('SYRAH');
    const cleared = resolveClearance(flight, airport, 'proposed');
    if (!cleared.ok) throw new Error(cleared.unresolved.map((item) => item.reason).join('; '));
    const check = checkRouteWithAlternative(flight, ctx, cleared.clearance, airport);
    const amendment = routeAmendment(check);
    expect(amendment.proposed).toBe(`${nimi} OAK SGD`);
    expect(amendment.reason).not.toContain('route tool');
    expect(check.alsoCorrect).toBeUndefined();
  });

  it('names a KSFO B738 by its class alone', () => {
    const flight: Scenario = {
      ...QXE416,
      aircraftType: 'B738',
      destination: 'KLAX',
      filedRoute: `${sidOf(ksfo, 'SSTIK').id} EBAYE AVE SADDE8`,
      runwayConfigId: '28 RT',
      departureRunway: '28L',
    };
    const result = resolveAmendments(flight, ksfo, 'proposed');
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    const route = result.amendments.find((item) => item.box === 'route');
    expect(route?.reason).toContain('the SOP assigns an RNAV jet from 28L in 28 RT');
  });

  it('keys a KOAK DH8D to the jet rows under the accepted handling too', () => {
    const check = checked({ ...QXE416, filedRoute: `${nimi} OAK SAU` }, 'accepted');
    const amendment = routeAmendment(check);
    expect(amendment.proposed).toBe(`${oak} OAK SAU`);
    expect(amendment.reason).not.toContain('route tool');
    expect(check.alsoCorrect).toBeUndefined();
  });

  it('leaves a warning amendment for the vector navaid untouched', () => {
    const flight: Scenario = {
      ...QXE416,
      aircraftType: 'B738',
      runwayConfigId: 'SFOE',
      departureRunway: '10R',
      filedRoute: `${oak} SGD`,
    };
    const check = checked(flight);
    const amendment = routeAmendment(check);
    expect(amendment.warning).toBe(true);
    expect(amendment.proposed).toBe(`${oak} OAK SGD`);
    expect(amendment.reason).not.toContain('route tool');
    expect(check.alsoCorrect).toBeUndefined();
  });
});

/** The boxes the reasons of a result say are correct too, which grading must accept. */
function promisedBoxes(result: AmendmentResult): string[] {
  if (!result.ok) return [];
  return result.amendments.flatMap((amendment) => {
    const promised = /; ([^;]+) is correct too$/.exec(amendment.reason)?.[1];
    return promised === undefined ? [] : [promised];
  });
}

describe('resolveAmendments on a recommended route tool row', () => {
  it('keeps the route box of the RNAV pair on the proposal grading accepts', () => {
    const flight: Scenario = {
      ...QXE416,
      aircraftType: 'B738',
      equipmentSuffix: '/A',
      filedRoute: `${hussh} SYRAH`,
      localTime: '2300',
    };
    const result = resolveAmendments(flight, koak, 'proposed');
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    const also = result.routeAlsoCorrect;
    expect(promisedBoxes(result).filter((box) => box !== also)).toEqual([]);
    expect(
      result.amendments.map((item) => [
        item.box,
        item.alternativeTo,
        item.box === 'altitude' ? item.proposedFeet : item.proposed,
      ]),
    ).toEqual([
      ['type', 'route', 'B738/L'],
      ['route', 'type', `${oak} OAK SAU`],
    ]);
    expect(result.amendments.find((item) => item.box === 'route')?.reason).toBe(
      `${hussh} is not the procedure the SOP assigns a non-RNAV jet or DH8D from 30 in SFOW; it is ${oak}, ` +
        `and the ZOA route tool's route for a jet or DH8D in SFOW is ${oak} OAK SAU`,
    );
    expect(also).toBeUndefined();
  });

  it('answers a route an /A cannot fly with the tool route, leaving the type box as filed', () => {
    const flight: Scenario = {
      ...N471RY,
      equipmentSuffix: '/A',
      filedRoute: `${quake} OAK SYRAH SGD`,
    };
    const result = resolveAmendments(flight, koak, 'proposed');
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.amendments.map((item) => item.box)).toEqual(['route']);
    const route = result.amendments[0];
    expect(route?.box === 'route' ? route.proposed : undefined).toBe(`${nimi} OAK SAU`);
    expect(result.routeAlsoCorrect).toBeUndefined();
    expect(promisedBoxes(result)).toEqual([]);
  });

  it('lets an obligatory row keyed for the flight win over a recommended one', () => {
    const obligatory: TecRoute = {
      id: 'TOOL-KAPC-SFOW-J-5000',
      kind: 'tool',
      destination: 'KAPC',
      plan: 'SFOW',
      runwayFamilies: [],
      classes: ['J'],
      route: 'OAK# OAK V195 CROIT V108 SGD',
      finalAltitudeFeet: 5000,
      source: 'hand-built row for the test',
    };
    const airport: AirportData = { ...koak, tecRoutes: [...koak.tecRoutes, obligatory] };
    const result = resolveAmendments(QXE416, airport, 'proposed');
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    const route = result.amendments.find((item) => item.box === 'route');
    expect(route?.box === 'route' ? route.proposed : undefined).toBe(
      `${oak} OAK V195 CROIT V108 SGD`,
    );
    expect(route?.reason).not.toContain('correct too');
    expect(result.routeAlsoCorrect).toBeUndefined();
  });
});
