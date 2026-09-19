import { describe, expect, it } from 'vitest';
import koakJson from '@data/koak.json';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import { resolveAmendedClearance, resolveAmendments } from '@/rules/amend/engine.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { speakClearance } from '@/rules/speak.ts';
import type { Procedure, ResolvedClearance } from '@/rules/types.ts';

const ksfo = ksfoJson as unknown as AirportData;
const koak = koakJson as unknown as AirportData;

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

/** The same plan filed with a suffix the table holds but RVSM does not, so only its altitude is wrong. */
function ual313NonRvsm(): Scenario {
  return scenario({ ...ual313(), equipmentSuffix: '/G' });
}

/**
 * A plan whose valid non-RNAV suffix clashes with the RNAV departure it files, and with nothing
 * else.
 *
 * Everything else about it stands for an RNAV flight — a route of navaids and of the fixes the
 * TRUKN2 publishes transitions to, and a flight level with the parity its course wants, below the
 * RVSM band the suffix may not enter — so the suffix answers the whole plan and the pair is raised.
 */
function rnavClash(): Scenario {
  return scenario({
    callsign: 'AAL88',
    aircraftType: 'A320',
    equipmentSuffix: '/A',
    filedAltitude: 28000,
    squawk: '4602',
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

/** The SID a clearance assigns; every plan these tests amend is issued one. */
function assigned(clearance: ResolvedClearance): Extract<Procedure, { kind: 'sid' }> {
  const procedure = clearance.procedure.value;
  if (procedure.kind !== 'sid') throw new Error('the clearance assigns no procedure');
  return procedure;
}

/** The transitions of the procedure a clearance issues; one on the runway heading has none. */
function transitionsOf(clearance: ResolvedClearance) {
  const procedure = clearance.procedure.value;
  if (procedure.kind !== 'sid') return [];
  return ksfo.sids.find((sid) => sid.id === procedure.id)?.transitions ?? [];
}

/** Reads the corrected plan's clearance aloud, the way the reveal does (`ui/session.ts`). */
function spoken(flight: Scenario) {
  const { corrected } = resolved(flight);
  const result = resolveAmendedClearance(flight, corrected, ksfo);
  if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
  const { clearance } = result;
  return speakClearance({
    callsign: corrected.callsign,
    clearance,
    destinationSpoken:
      ksfo.routeLibrary.destinations.find((row) => row.icao === corrected.destination)?.spoken ??
      corrected.destination,
    filedRoute: corrected.filedRoute,
    originalRoute: flight.filedRoute,
    airportFaa: ksfo.airport.faa,
    squawk: corrected.squawk,
    telephony: ksfo.routeLibrary.telephony,
    fixSpoken: ksfo.fixSpoken,
    sidTransitions: transitionsOf(clearance),
  });
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

  it('judges the altitude and the route boxes behind the suffix the type box is corrected to', () => {
    const flight = ual313();
    const result = resolved(flight);
    expect(result.amendments.map((amendment) => [amendment.box, amendment.alternativeTo])).toEqual([
      ['type', undefined],
      ['route', undefined],
    ]);
    const [type, route] = result.amendments;
    if (type?.box !== 'type') throw new Error('the first amendment is not the type box');
    expect(type.proposed).toBe('B752/L');
    expect(type.reason).toContain('suffix /Q is not in');
    expect(type.citations.map((citation) => citation.id)).toEqual(['EQUIP/L']);
    if (route?.box !== 'route') throw new Error('the second amendment is not the route box');
    expect(route.reason).toContain('BVLQ124 names no fix, navaid, airway or procedure');
    expect(result.corrected.filedRoute).toBe('TRUKN2 MOGEE Q124 BVL WAATS5');
    expect(result.corrected.filedAltitude).toBe(flight.filedAltitude);
  });

  it('pairs the type box with the route box where a valid suffix clashes with the procedure', () => {
    const result = resolved(rnavClash());
    expect(result.amendments.map((amendment) => [amendment.box, amendment.alternativeTo])).toEqual([
      ['type', 'route'],
      ['route', 'type'],
    ]);
    const [type] = result.amendments;
    if (type?.box !== 'type') throw new Error('the first amendment is not the type box');
    expect(type.proposed).toBe('A320/L');
    expect(type.reason).toContain('an RNAV suffix would make the plan correct as filed');
    expect(type.reason).toContain('the filed TRUKN2');
  });

  it('corrects one side only of the RNAV pair, the type box the strip reads first', () => {
    const flight = rnavClash();
    const result = resolved(flight);
    expect(result.corrected.equipmentSuffix).toBe('/L');
    expect(result.corrected.filedRoute).toBe(flight.filedRoute);
    const route = result.amendments.find((amendment) => amendment.box === 'route');
    if (route?.box !== 'route') throw new Error('the route amendment is missing');
    expect(route.proposed).not.toBe(flight.filedRoute);
  });

  it('proposes the procedure the corrected type box is assigned, not the one the filed box was', () => {
    const flight = scenario({
      callsign: 'N898BY',
      aircraftType: 'SR22',
      equipmentSuffix: null,
      destination: 'KSMF',
      filedRoute: 'MOLEN9 OAK V6 SAC',
      filedAltitude: 6000,
      runwayConfigId: '01/01',
      departureRunway: '01R',
      localTime: '0545',
      dayOfWeek: 'thursday',
      squawk: '4620',
    });
    const result = resolved(flight);
    expect(result.amendments.map((amendment) => [amendment.box, amendment.alternativeTo])).toEqual([
      ['type', undefined],
      ['route', undefined],
    ]);
    const [type, route] = result.amendments;
    if (type?.box !== 'type' || route?.box !== 'route')
      throw new Error('the boxes are not amended');
    expect(type.proposed).toBe('SR22/G');
    expect(route.proposed).toBe('NIITE4 OAK V6 SAC');
    expect(route.reason).toBe(
      'MOLEN9 is not the procedure the SOP assigns an RNAV piston from 01R in 01/01; it is NIITE4',
    );
    expect(route.reason).not.toContain('runway heading');
    const amended = resolveAmendedClearance(flight, result.corrected, ksfo);
    if (!amended.ok) throw new Error(amended.unresolved.map((item) => item.reason).join('; '));
    expect(assigned(amended.clearance).family).toBe('NIITE');
  });

  it('offers no RNAV alternative where the RNAV plan is assigned another procedure anyway', () => {
    const flight = scenario({
      callsign: 'N938KR',
      aircraftType: 'SR22',
      equipmentSuffix: '/E',
      destination: 'KMRY',
      filedRoute: 'SSTIK5 EUGEN',
      filedAltitude: 5000,
      runwayConfigId: '01/01',
      departureRunway: '01L',
      localTime: '0023',
      squawk: '4620',
    });
    const result = resolved(flight);
    expect(result.amendments.map((amendment) => [amendment.box, amendment.alternativeTo])).toEqual([
      ['type', undefined],
      ['route', undefined],
    ]);
    const [type, route] = result.amendments;
    if (type?.box !== 'type' || route?.box !== 'route')
      throw new Error('the boxes are not amended');
    expect(type.proposed).toBe('SR22/G');
    expect(type.reason).toContain('suffix /E is not in');
    expect(type.reason).not.toContain('an RNAV suffix would make');
    expect(route.proposed).toBe('GAPP7 SFO EUGEN');
  });

  it('leaves the altitude of a jet whose corrected suffix carries RVSM approval alone', () => {
    const flight = scenario({ equipmentSuffix: '/E' });
    const result = resolved(flight);
    expect(result.amendments.map((amendment) => amendment.box)).toEqual(['type']);
    expect(result.amendments[0]).toMatchObject({ proposed: 'B738/L' });
    expect(result.corrected.filedAltitude).toBe(flight.filedAltitude);
  });

  it('amends the type box alone for a suffix that reports no altitude inside the RVSM band', () => {
    const flight = scenario({ equipmentSuffix: '/Y' });
    const result = resolved(flight);
    expect(result.amendments.map((amendment) => amendment.box)).toEqual(['type']);
    const [type] = result.amendments;
    if (type?.box !== 'type') throw new Error('the first amendment is not the type box');
    expect(type.proposed).toBe('B738/L');
    expect(type.reason).toContain('has no Mode C transponder');
    expect(type.citations.map((citation) => citation.id)).toEqual(['T-MODE-C', 'EQUIP/L']);
    expect(result.corrected.filedAltitude).toBe(flight.filedAltitude);
    expect(result.corrected.filedRoute).toBe(flight.filedRoute);
  });

  it('builds the noise row the table puts above the filed family, leaving nothing to amend again', () => {
    const flight = scenario({
      callsign: 'FDX1961',
      aircraftType: 'A306',
      destination: 'RKSI',
      filedRoute: 'TRUKN2 SFO RBL J1 OED J501 TOU J523 YZT J502 ANN J195 BKA J605 MDO',
      filedAltitude: 29000,
      localTime: '2300',
    });
    const result = resolved(flight);
    expect(result.amendments.map((amendment) => amendment.box)).toEqual(['altitude', 'route']);
    const [altitude, route] = result.amendments;
    if (altitude?.box !== 'altitude' || route?.box !== 'route')
      throw new Error('the boxes are not amended');
    expect(altitude.proposedFeet).toBe(28000);
    expect(route.proposed).toBe(
      'NIITE4 DEDHD RBL J1 OED J501 TOU J523 YZT J502 ANN J195 BKA J605 MDO',
    );
    const again = resolveAmendments(result.corrected, ksfo);
    if (!again.ok) throw new Error(again.unresolved.map((item) => item.reason).join('; '));
    expect(again.amendments).toEqual([]);
  });

  it('fails the whole result when a box the data cannot answer blocks one check', () => {
    const result = resolveAmendments(scenario({ destination: 'KZZZ' }), ksfo);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unresolved.map((item) => item.element)).toContain('BOX.altitude');
  });
});

describe('resolveAmendments RNAV pair', () => {
  /** The Oakland worksheet plan whose /A suffix is the one thing wrong with it, or the only thing right. */
  function nks510(): Scenario {
    return {
      callsign: 'NKS510',
      aircraftType: 'A320',
      equipmentSuffix: '/A',
      destination: 'KLAX',
      filedRoute: 'CNDEL5 SUSEY EBAYE BURGL IRNMN2',
      filedAltitude: 35000,
      runwayConfigId: 'SFOW',
      departureRunway: '30',
      localTime: '1400',
      dayOfWeek: 'tuesday',
      squawk: '4611',
    };
  }

  it('raises the RNAV pair with the altitude box on its other side when the RNAV plan is clean', () => {
    const flight = nks510();
    const result = resolveAmendments(flight, koak);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.amendments.map((amendment) => [amendment.box, amendment.alternativeTo])).toEqual([
      ['type', 'altitude'],
      ['altitude', 'type'],
      ['route', 'type'],
    ]);
    const [type, altitude] = result.amendments;
    if (type?.box !== 'type' || altitude?.box !== 'altitude') {
      throw new Error('the type and altitude boxes are not both amended');
    }
    expect(type.proposed).toBe('A320/L');
    expect(altitude.proposedFeet).toBe(27000);
    expect(result.corrected).toEqual({ ...flight, equipmentSuffix: '/L' });
  });

  it('does not raise the RNAV pair when the RNAV plan still needs an amendment', () => {
    const result = resolved(scenario({ ...rnavClash(), filedAltitude: 27000 }));
    expect(result.amendments.map((amendment) => amendment.box)).toEqual(['altitude', 'route']);
    expect(result.amendments.every((amendment) => amendment.alternativeTo === undefined)).toBe(
      true,
    );
  });
});

describe('resolveAmendments RNAV route elements', () => {
  /** The Oakland jet whose Las Vegas route is a Q route between two RNAV waypoints. */
  function b738w(overrides: Partial<Scenario> = {}): Scenario {
    return {
      callsign: 'SWA2468',
      aircraftType: 'B738',
      equipmentSuffix: '/W',
      destination: 'KLAS',
      filedRoute: 'NTELL Q174 FLCHR COKTL4',
      filedAltitude: 29000,
      runwayConfigId: 'OAKE',
      departureRunway: '12',
      localTime: '1246',
      dayOfWeek: 'friday',
      squawk: '4614',
      ...overrides,
    };
  }

  /** The worksheet plan whose /A suffix cannot fly the Q route and the RNAV waypoint it files. */
  function fdx3859(): Scenario {
    return {
      callsign: 'FDX3859',
      aircraftType: 'B752',
      equipmentSuffix: '/A',
      destination: 'KDEN',
      filedRoute: 'HUSSH2 MOGEE Q124 BVL TCH KAMPR LONGZ1',
      filedAltitude: 34000,
      runwayConfigId: 'SFOW',
      departureRunway: '30',
      localTime: '1400',
      dayOfWeek: 'tuesday',
      squawk: '4602',
    };
  }

  function amended(flight: Scenario, airport: AirportData = koak) {
    const result = resolveAmendments(flight, airport);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    return result;
  }

  it('raises the type box alone for a route of RNAV elements the filed suffix cannot fly', () => {
    const flight = b738w();
    const result = amended(flight);
    expect(result.amendments.map((amendment) => [amendment.box, amendment.alternativeTo])).toEqual([
      ['type', undefined],
    ]);
    const [type] = result.amendments;
    if (type?.box !== 'type') throw new Error('the first amendment is not the type box');
    expect(type.proposed).toBe('B738/L');
    expect(type.reason).toBe(
      'the route needs RNAV a /W flight does not carry (Q174 is an RNAV route, NTELL and FLCHR ' +
        'are RNAV waypoints) and the data holds no conventional route, so the type box carries ' +
        'the suffix the fleet files for the type',
    );
    expect(type.citations.map((citation) => citation.id)).toEqual([
      'EQUIP/L',
      'R-RNAV-AIRWAY',
      'R-RNAV-WAYPOINT',
    ]);
    expect(result.corrected).toEqual({ ...flight, equipmentSuffix: '/L' });
    expect(amended(result.corrected).amendments).toEqual([]);
  });

  it('leaves the same plan alone where the filed suffix carries the navigation', () => {
    expect(amended(b738w({ equipmentSuffix: '/L' })).amendments).toEqual([]);
  });

  it('fails the route box where the fleet files no suffix that can fly the route', () => {
    const fleet = koak.routeLibrary.fleet.map((row) =>
      row.type === 'B738' ? { ...row, suffixes: ['/A'] } : row,
    );
    const airport: AirportData = { ...koak, routeLibrary: { ...koak.routeLibrary, fleet } };
    const result = resolveAmendments(b738w({ equipmentSuffix: '/A' }), airport);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unresolved.map((gap) => gap.element)).toEqual(['BOX.route']);
    expect(result.unresolved[0]?.reason).toContain(
      'the data holds no conventional route to propose',
    );
  });

  it('raises a GNSS suffix for the T route only a GPS-equipped flight may file', () => {
    const result = amended(b738w({ equipmentSuffix: '/Z', filedRoute: 'NTELL T257 FLCHR COKTL4' }));
    const [type] = result.amendments;
    if (type?.box !== 'type') throw new Error('the first amendment is not the type box');
    expect(type.proposed).toBe('B738/L');
    expect(type.reason).toContain(
      'the route needs GPS a /Z flight does not carry (T257 is an RNAV route)',
    );
    expect(type.citations.map((citation) => citation.id)).toEqual(['EQUIP/L', 'R-RNAV-AIRWAY']);
  });

  it('judges the altitude and the route for the plan the RNAV type box leaves', () => {
    const result = amended(fdx3859());
    expect(result.amendments.map((amendment) => [amendment.box, amendment.alternativeTo])).toEqual([
      ['type', undefined],
      ['altitude', undefined],
      ['route', undefined],
    ]);
    const [type, altitude, route] = result.amendments;
    if (type?.box !== 'type' || altitude?.box !== 'altitude' || route?.box !== 'route') {
      throw new Error('the three boxes are not amended');
    }
    expect(type.proposed).toBe('B752/L');
    expect(type.reason).toContain('(Q124 is an RNAV route, KAMPR is an RNAV waypoint)');
    expect(altitude.proposedFeet).toBe(33000);
    expect(route.proposed).toBe('OAK6 OAK MOGEE Q124 BVL TCH KAMPR LONGZ1');
    expect(amended(result.corrected).amendments).toEqual([]);
  });
});

describe('resolveAmendments forced transition', () => {
  /** The southbound jet off the 01s inside the 0100L-0500L window, which the SOP sends over GOBBS. */
  function nightSouth(overrides: Partial<Scenario> = {}): Scenario {
    return scenario({
      callsign: 'SWA77',
      aircraftType: 'B737',
      destination: 'KSAN',
      filedRoute: 'SSTIK5 YYUNG LAX COMIX2',
      filedAltitude: 35000,
      departureRunway: '01L',
      localTime: '0200',
      squawk: '4620',
      ...overrides,
    });
  }

  /** The route amendment of a plan, absent when the route box reads right as filed. */
  function routeAmendment(flight: Scenario) {
    return resolved(flight).amendments.find((amendment) => amendment.box === 'route');
  }

  it('routes a southbound night departure over the transition the noise row forces', () => {
    const amendment = routeAmendment(nightSouth());
    expect(amendment?.proposed).toBe('NIITE4 GOBBS YYUNG LAX COMIX2');
    expect(amendment?.citations.map((citation) => citation.id)).toEqual([
      'SFOW-NOISE-S-NIITE-GOBBS',
      'R-TRANSITION',
    ]);
  });

  it('clears the corrected plan on the southbound noise row, not the northbound one', () => {
    const { corrected } = resolved(nightSouth());
    const clearance = cleared(corrected);
    expect(assigned(clearance).id).toBe('NIITE4');
    expect(clearance.route.value).toMatchObject({ fix: 'GOBBS' });
    expect(clearance.procedure.citations.map((citation) => citation.id)).toEqual([
      'SFOW-NOISE-S-NIITE-GOBBS',
    ]);
  });

  it('leaves the same plan alone outside the noise window', () => {
    expect(routeAmendment(nightSouth({ localTime: '1400' }))).toBeUndefined();
  });
});

describe('resolveAmendedClearance', () => {
  it('speaks the amended altitude in the expect clause when the altitude box was amended', () => {
    const original = ual313NonRvsm();
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
    expect(corrected.filedAltitude).toBe(10000);
    const result = resolveAmendedClearance(original, corrected, ksfo);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.clearance.altitude.value).toEqual({ phrase: 'climb_via_except', feet: 10000 });
    expect(result.clearance.expect.value).toEqual({ kind: 'final', feet: 10000 });
    expect(result.clearance.expect.citations.map((citation) => citation.id)).toEqual(['A-FINAL']);
  });

  it('keeps the amended clause beside the final reading as the longer reading still allowed', () => {
    const original = skw2345();
    const { corrected } = resolved(original);
    const result = resolveAmendedClearance(original, corrected, ksfo);
    if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
    expect(result.clearance.redundantExpect.value).toEqual({
      kind: 'amended',
      feet: 10000,
      minutes: 10,
    });
    expect(result.clearance.redundantExpect.citations.map((citation) => citation.id)).toEqual([
      'A-FINAL',
    ]);
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
    expect(result.clearance.redundantExpect.value).toBeNull();
    expect(result.clearance.redundantExpect.citations).toEqual([]);
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
    const original = ual313NonRvsm();
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
    expect(assigned(result.clearance).family).toBe('TRUKN');
    expect(corrected.filedRoute.startsWith(assigned(result.clearance).id)).toBe(true);
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

  it('reads a plan amended off its procedure as the runway heading and vectors to the fix', () => {
    const original = scenario({
      callsign: 'N172SP',
      aircraftType: 'C172',
      equipmentSuffix: '/A',
      destination: 'KMYV',
      filedRoute: 'GAPP7 OAK V6 SAC',
      filedAltitude: 5000,
      departureRunway: '01L',
      localTime: '2300',
      squawk: '4620',
    });
    const { corrected } = resolved(original);
    expect(corrected.filedRoute).toBe('OAK V6 SAC');
    expect(spoken(original).abbreviated).toContain(
      'cleared to Yuba County airport, via fly runway heading, radar vectors Oakland VOR,',
    );
  });

  it('reads a built route as the transition, the chain flown direct, then as filed', () => {
    const original = scenario({
      callsign: 'SWA984',
      aircraftType: 'B737',
      destination: 'KLAX',
      filedRoute: 'SSTIK5 EBAYE AVE SADDE8',
      filedAltitude: 35000,
      departureRunway: '01L',
      squawk: '4602',
    });
    expect(spoken(original).abbreviated).toContain(
      'Sstik Five departure, Susey transition, direct Ebaye, direct Burgl, Irnmn Two arrival.',
    );
  });
});
