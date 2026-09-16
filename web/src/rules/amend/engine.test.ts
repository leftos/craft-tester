import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { resolveAmendedClearance, resolveAmendments } from '@/rules/amend/engine.ts';
import { resolveClearance } from '@/rules/engine.ts';

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

function resolved(flight: Scenario) {
  const result = resolveAmendments(flight, ksfo);
  if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
  return result;
}

/** The worksheet plan whose non-RNAV suffix, RVSM altitude and RNAV procedure are all wrong. */
function ual313(): Scenario {
  return scenario({
    callsign: 'UAL313',
    aircraftType: 'B752',
    equipmentSuffix: '/Q',
    destination: 'KSLC',
    filedRoute: 'TRUKN2 MOGEE BVLQ124 BVL WAATS5',
    filedAltitude: 33000,
    runwayConfigId: '28 RT',
    departureRunway: '28L',
  });
}

/** The worksheet plan whose Sacramento route and altitude are both above what the TEC route allows. */
function skw2345(): Scenario {
  return scenario({
    callsign: 'SKW2345',
    aircraftType: 'E75L',
    destination: 'KSMF',
    filedRoute: 'SFO4 CCR CCR2',
    filedAltitude: 19000,
    squawk: '4615',
  });
}

/** The worksheet plan filed at an odd flight level on a northbound course, amended one level down. */
function swa126(): Scenario {
  return scenario({
    callsign: 'SWA126',
    aircraftType: 'B737',
    filedAltitude: 33000,
    squawk: '4613',
  });
}

function cleared(flight: Scenario) {
  const result = resolveClearance(flight, ksfo);
  if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
  return result.clearance;
}

describe('resolveAmendments', () => {
  it('amends nothing on a plan filed as the SOP and the letters of agreement want it', () => {
    const flight = scenario({});
    const result = resolved(flight);
    expect(result.amendments).toEqual([]);
    expect(result.corrected).toEqual(flight);
  });

  it('amends the altitude and the route of a stale procedure filed at an illegal level', () => {
    const flight = scenario({
      filedRoute: 'TRUKN1 DEDHD RBL LMT HAWKZ7',
      filedAltitude: 33000,
    });
    const result = resolved(flight);
    expect(result.amendments.map((amendment) => amendment.box)).toEqual(['altitude', 'route']);
    expect(result.corrected).toEqual(
      scenario({ filedRoute: 'TRUKN2 DEDHD RBL LMT HAWKZ7', filedAltitude: 32000 }),
    );
  });

  it('collapses the two type proposals of an RNAV clash and pairs the one left with the route', () => {
    const result = resolved(ual313());
    expect(result.amendments.map((amendment) => [amendment.box, amendment.alternativeTo])).toEqual([
      ['type', 'route'],
      ['altitude', undefined],
      ['route', 'type'],
    ]);
    const [type] = result.amendments;
    if (type?.box !== 'type') throw new Error('the first amendment is not the type box');
    expect(type.proposed).toBe('B752/L');
    expect(type.reason).toContain('suffix /Q is not in');
    expect(type.reason).toContain('an RNAV suffix would keep the filed TRUKN2');
    expect(type.citations.map((citation) => citation.id)).toEqual(['EQUIP/L']);
  });

  it('corrects one side only of the RNAV pair, the type box the strip reads first', () => {
    const flight = ual313();
    const result = resolved(flight);
    expect(result.corrected.equipmentSuffix).toBe('/L');
    expect(result.corrected.filedRoute).toBe(flight.filedRoute);
    const route = result.amendments.find((amendment) => amendment.box === 'route');
    if (route?.box !== 'route') throw new Error('the route amendment is missing');
    expect(route.proposed).not.toBe(flight.filedRoute);
  });

  it('fails the whole result when a box the data cannot answer blocks one check', () => {
    const result = resolveAmendments(scenario({ destination: 'KZZZ' }), ksfo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unresolved.map((item) => item.element)).toContain('BOX.altitude');
  });
});

describe('resolveAmendedClearance', () => {
  it('speaks the amended altitude in the expect clause when the altitude box was amended', () => {
    const original = ual313();
    const { corrected } = resolved(original);
    expect(corrected.filedAltitude).toBe(27000);
    const result = resolveAmendedClearance(original, corrected, ksfo);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.clearance.expect.value).toEqual({ kind: 'amended', feet: 27000, minutes: 10 });
    expect(result.clearance.expect.citations.map((citation) => citation.id)).toEqual([
      'A-EXPECT-AMENDED',
    ]);
  });

  it('says the amended altitude is the final one where the clearance climbs straight to it', () => {
    const original = skw2345();
    const { corrected } = resolved(original);
    expect(corrected.filedAltitude).toBe(9000);
    const result = resolveAmendedClearance(original, corrected, ksfo);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.clearance.altitude.value).toEqual({ phrase: 'climb_via_except', feet: 9000 });
    expect(result.clearance.expect.value).toEqual({ kind: 'final', feet: 9000 });
    expect(result.clearance.expect.citations.map((citation) => citation.id)).toEqual(['A-FINAL']);
    expect(result.clearance.redundantExpect.value).toBeNull();
  });

  it('keeps the amended clause where the amended altitude is above the altitude cleared to', () => {
    const original = swa126();
    const { corrected } = resolved(original);
    expect(corrected.filedAltitude).toBe(32000);
    const result = resolveAmendedClearance(original, corrected, ksfo);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.clearance.expect.value).toEqual({ kind: 'amended', feet: 32000, minutes: 10 });
    expect(result.clearance.expect.citations.map((citation) => citation.id)).toEqual([
      'A-EXPECT-AMENDED',
    ]);
  });

  it('keeps the amended clause on a plain climb via SID, which speaks no altitude of its own', () => {
    const original = swa126();
    const { corrected } = resolved(original);
    const airport: AirportData = {
      ...ksfo,
      altitudeRules: ksfo.altitudeRules.map((row) => ({
        ...row,
        whenTopAltitudePublished: 'climb_via' as const,
      })),
      sids: ksfo.sids.map((sid) =>
        sid.family === 'TRUKN'
          ? { ...sid, topAltitude: { kind: 'published' as const, feet: corrected.filedAltitude } }
          : sid,
      ),
    };
    const result = resolveAmendedClearance(original, corrected, airport);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.clearance.altitude.value).toEqual({ phrase: 'climb_via' });
    expect(result.clearance.expect.value).toEqual({ kind: 'amended', feet: 32000, minutes: 10 });
    expect(result.clearance.expect.citations.map((citation) => citation.id)).toEqual([
      'A-EXPECT-AMENDED',
    ]);
  });

  it('holds nothing redundant, because the amended clause is mandatory', () => {
    const original = ual313();
    const { corrected } = resolved(original);
    const result = resolveAmendedClearance(original, corrected, ksfo);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.clearance.redundantExpect.value).toBeNull();
    expect(result.clearance.redundantExpect.citations).toEqual([]);
  });

  it('reads the filed RNAV procedure of a plan whose type box carried the RNAV fix', () => {
    const original = ual313();
    const { corrected } = resolved(original);
    const result = resolveAmendedClearance(original, corrected, ksfo);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.clearance.sid.value.family).toBe('TRUKN');
    expect(corrected.filedRoute.startsWith(result.clearance.sid.value.id)).toBe(true);
  });

  it('cites the rule an amended route is read under on the route element', () => {
    const original = scenario({ filedRoute: 'TRUKN1 DEDHD RBL LMT HAWKZ7' });
    const { corrected } = resolved(original);
    expect(corrected.filedRoute).not.toBe(original.filedRoute);
    const result = resolveAmendedClearance(original, corrected, ksfo);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.clearance.route.citations.map((citation) => citation.id)).toContain(
      'R-THEN-AS-FILED',
    );
  });

  it('leaves the route element of a plan whose route was not amended alone', () => {
    const original = scenario({ filedAltitude: 33000 });
    const { corrected } = resolved(original);
    expect(corrected.filedRoute).toBe(original.filedRoute);
    expect(corrected.filedAltitude).not.toBe(original.filedAltitude);
    const result = resolveAmendedClearance(original, corrected, ksfo);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.clearance.route).toEqual(cleared(corrected).route);
    expect(result.clearance.route.citations.map((citation) => citation.id)).not.toContain(
      'R-THEN-AS-FILED',
    );
  });

  it('leaves the expect clause of a plan whose altitude was not amended alone', () => {
    const original = scenario({ filedRoute: 'TRUKN1 DEDHD RBL LMT HAWKZ7' });
    const { corrected } = resolved(original);
    expect(corrected.filedAltitude).toBe(original.filedAltitude);
    const result = resolveAmendedClearance(original, corrected, ksfo);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.clearance.expect).toEqual(cleared(corrected).expect);
    expect(result.clearance.expect.value).toBeNull();
  });
});
