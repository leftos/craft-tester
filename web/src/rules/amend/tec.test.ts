import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, AssignmentRule, Scenario, TecRoute } from '@/data/schema.ts';
import { checkRoute } from '@/rules/amend/route.ts';
import { tecTokens } from '@/rules/amend/tec.ts';
import { classify } from '@/rules/classify.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { usableTecRoute } from '@/rules/tecRoutes.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

const ksfo = ksfoJson as unknown as AirportData;

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
};

const airport: AirportData = {
  ...ksfo,
  tecRoutes: [headingRow, ...ksfo.tecRoutes],
  assignmentRules: [assignmentRow, ...ksfo.assignmentRules],
};

const flight: Scenario = {
  callsign: 'SWA1',
  aircraftType: 'B737',
  equipmentSuffix: '/L',
  destination: 'KSMF',
  filedRoute: 'TRUKN2 FEVTA FEVTA1',
  filedAltitude: 10000,
  runwayConfigId: '28 RT',
  departureRunway: '28L',
  localTime: '1400',
  dayOfWeek: 'tuesday',
  squawk: '1234',
};

/** The classified flight, which the TEC rows are keyed against. */
function classified(scenario: Scenario) {
  const ctx = classify(scenario, airport);
  if (isUnresolved(ctx)) throw new Error(ctx.reason);
  return ctx;
}

describe('a TEC route that begins on an initial heading', () => {
  it('leaves the heading out of the route it proposes', () => {
    expect(tecTokens(headingRow, airport)).toEqual(['FEVTA', 'FEVTA1']);
  });

  it('routes the flight the SOP clears on that heading', () => {
    const row = usableTecRoute(classified(flight), flight, airport);
    expect(row?.id).toBe('TEC-KSMF-OAKE-J');
  });

  it('amends the route box to the published route without the heading', () => {
    const result = resolveClearance(flight, airport);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.clearance.procedure.value).toMatchObject({ kind: 'heading', heading: 270 });
    const amendment = checkRoute(flight, classified(flight), result.clearance, airport);
    if (amendment === undefined) throw new Error('the filed route is the one the SOP assigns');
    if (isUnresolved(amendment)) throw new Error(amendment.reason);
    if (amendment.box !== 'route') throw new Error(`the check amended the ${amendment.box} box`);
    expect(amendment.proposed).toBe('FEVTA FEVTA1');
    expect(amendment.citations.map((citation) => citation.id)).toContain('TEC-KSMF-OAKE-J');
  });
});
