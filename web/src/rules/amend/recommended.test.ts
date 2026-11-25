import { describe, expect, it } from 'vitest';
import koakJson from '@data/koak.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { sidOf } from '@/data/sidOf.ts';
import type { RouteCheckResult } from '@/rules/amend/route.ts';
import { checkRouteWithAlternative } from '@/rules/amend/route.ts';
import { classify } from '@/rules/classify.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

const koak = koakJson as unknown as AirportData;
const nimi = sidOf(koak, 'NIMI').id;
const oak = sidOf(koak, 'OAK').id;
const quake = sidOf(koak, 'QUAKE').id;

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
function checked(flight: Scenario): RouteCheckResult {
  const ctx = classify(flight, koak, 'proposed');
  if (isUnresolved(ctx)) throw new Error(ctx.reason);
  const result = resolveClearance(flight, koak, 'proposed');
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
        `, and the ZOA route tool's route for a jet in SFOW is ${oak} OAK SAU; ${previous} is correct too`,
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
      `${nimi} is not the procedure the SOP assigns an RNAV jet from 30 in SFOW; it is ${oak}`,
    );
    expect(check.alsoCorrect).toBeUndefined();
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
