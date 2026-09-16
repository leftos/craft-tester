import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, AltitudePhrase, RouteTemplate, Scenario } from '@/data/schema.ts';
import { resolveClearance } from '@/rules/engine.ts';
import type { ResolvedClearance } from '@/rules/types.ts';

const ksfo = ksfoJson as unknown as AirportData;

const BASE: Scenario = {
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
  return Object.assign({ ...BASE }, overrides);
}

function clearanceFor(flight: Scenario, airport: AirportData = ksfo): ResolvedClearance {
  const result = resolveClearance(flight, airport);
  if (!result.ok) throw new Error(result.unresolved.map((item) => item.reason).join('; '));
  return result.clearance;
}

type Expectation = {
  sidId: string;
  route: { template: RouteTemplate; fix?: string };
  altitude: { phrase: AltitudePhrase; feet?: number };
  frequency: string;
  /**
   * The expect clause where one is spoken. Every KSFO chart publishes the expect note itself, so
   * under `unless_chart_publishes_it` the clause is `null` on every case that leaves this out.
   */
  expectClause?: { feet: number; minutes: number } | null;
};

const SOUTHBOUND_LAX = {
  filedRoute: 'SSTIK5 SUSEY EBAYE BURGL IRNMN2',
  destination: 'KLAX',
  filedAltitude: 33000,
};

const SOUTHBOUND_SAN = {
  filedRoute: 'SEGUL1 YYUNG LAX COMIX2',
  destination: 'KSAN',
  filedAltitude: 37000,
};

const CASES: [string, Partial<Scenario>, Expectation][] = [
  [
    // TRUKN2 publishes a top altitude and the flight files above it, so the SOP interim table does
    // not apply and the altitude is a plain climb via SID (SFO ATCT SOP 2-2 c (1)).
    'a jet north via DEDHD off 01R in 28/01 gets TRUKN and the DEDHD transition',
    {},
    {
      sidId: 'TRUKN2',
      route: { template: 'transition', fix: 'DEDHD' },
      altitude: { phrase: 'climb_via' },
      frequency: '120.9',
    },
  ],
  [
    'the same jet off 28L in 28 RT keeps TRUKN',
    { runwayConfigId: '28 RT', departureRunway: '28L' },
    {
      sidId: 'TRUKN2',
      route: { template: 'transition', fix: 'DEDHD' },
      altitude: { phrase: 'climb_via' },
      frequency: '120.9',
    },
  ],
  [
    'off 28L in 28 SO it gets SNTNA instead',
    { runwayConfigId: '28 SO', departureRunway: '28L' },
    {
      sidId: 'SNTNA2',
      route: { template: 'transition', fix: 'DEDHD' },
      altitude: { phrase: 'climb_via' },
      frequency: '120.9',
    },
  ],
  [
    'a north jet inside the noise window gets NIITE',
    { localTime: '2300' },
    {
      sidId: 'NIITE4',
      route: { template: 'transition', fix: 'DEDHD' },
      altitude: { phrase: 'climb_via' },
      frequency: '120.9',
    },
  ],
  [
    'a south jet via SUSEY off 01L gets SSTIK',
    { ...SOUTHBOUND_LAX, departureRunway: '01L' },
    {
      sidId: 'SSTIK5',
      route: { template: 'transition', fix: 'SUSEY' },
      altitude: { phrase: 'climb_via' },
      frequency: '135.1',
    },
  ],
  [
    'a south jet via YYUNG gets SSTIK while the SEGUL notice is in force',
    { ...SOUTHBOUND_SAN, departureRunway: '01L' },
    {
      sidId: 'SSTIK5',
      route: { template: 'transition', fix: 'YYUNG' },
      altitude: { phrase: 'climb_via' },
      frequency: '135.1',
    },
  ],
  [
    'the same flight gets SEGUL once the notice is lifted',
    { ...SOUTHBOUND_SAN, departureRunway: '01L', activeNotices: [] },
    {
      sidId: 'SEGUL1',
      route: { template: 'transition', fix: 'YYUNG' },
      altitude: { phrase: 'climb_via_except', feet: 10000 },
      frequency: '135.1',
    },
  ],
  [
    'a filed altitude below the interim altitude caps the clearance',
    { ...SOUTHBOUND_SAN, departureRunway: '01L', activeNotices: [], filedAltitude: 5000 },
    {
      sidId: 'SEGUL1',
      route: { template: 'transition', fix: 'YYUNG' },
      altitude: { phrase: 'climb_via_except', feet: 5000 },
      frequency: '135.1',
      expectClause: null,
    },
  ],
  [
    'a south jet via SUSEY off 28L gets WESLA and the 3,000 interim',
    {
      ...SOUTHBOUND_LAX,
      filedRoute: 'WESLA5 SUSEY EBAYE BURGL IRNMN2',
      runwayConfigId: '28 SO',
      departureRunway: '28L',
    },
    {
      sidId: 'WESLA5',
      route: { template: 'transition', fix: 'SUSEY' },
      altitude: { phrase: 'climb_via_except', feet: 3000 },
      frequency: '135.1',
    },
  ],
  [
    'an oceanic jet via BEBOP off 28L gets GNNRR',
    {
      filedRoute: 'GNNRR3 BEBOP R464 BILLO R464 BITTA MAGGI3',
      destination: 'PHNL',
      filedAltitude: 31000,
      runwayConfigId: '28 SO',
      departureRunway: '28L',
    },
    {
      sidId: 'GNNRR3',
      route: { template: 'transition', fix: 'BEBOP' },
      altitude: { phrase: 'climb_via' },
      frequency: '135.1',
    },
  ],
  [
    'a non-RNAV jet off 28L via ENI takes the north GAP row, because ENI is a north gate fix',
    {
      filedRoute: 'MOLEN9 ENI',
      destination: 'CYVR',
      filedAltitude: 33000,
      equipmentSuffix: '/A',
      runwayConfigId: '28 SO',
      departureRunway: '28L',
    },
    {
      sidId: 'GAPP7',
      route: { template: 'radar_vectors_fix', fix: 'ENI' },
      altitude: { phrase: 'maintain', feet: 3000 },
      frequency: '120.9',
    },
  ],
  [
    // SOP 2-2 a: northbound off the 01s is SFO#; GAPP# is runway 28 only.
    'a prop via OAK off 01L gets SFO with radar vectors and a 5,000 interim',
    {
      aircraftType: 'C172',
      equipmentSuffix: '/A',
      runwayConfigId: '01/01',
      departureRunway: '01L',
      filedRoute: 'OAK V6 SAC',
      destination: 'KSMF',
      filedAltitude: 5000,
    },
    {
      sidId: 'SFO5',
      route: { template: 'radar_vectors_fix', fix: 'OAK' },
      altitude: { phrase: 'climb_via_except', feet: 5000 },
      frequency: '120.9',
      expectClause: null,
    },
  ],
  [
    'a non-RNAV jet north via RBL off 01R gets the San Francisco departure',
    {
      equipmentSuffix: '/A',
      filedRoute: 'SFO5 RBL J1 OED',
      destination: 'RKSI',
      filedAltitude: 30000,
    },
    {
      sidId: 'SFO5',
      route: { template: 'radar_vectors_fix', fix: 'RBL' },
      altitude: { phrase: 'climb_via_except', feet: 10000 },
      frequency: '120.9',
    },
  ],
  [
    'a non-RNAV jet north off 28L gets GAP and a 3,000 maintain',
    { equipmentSuffix: '/A', runwayConfigId: '28 SO', departureRunway: '28L' },
    {
      sidId: 'GAPP7',
      route: { template: 'radar_vectors_fix', fix: 'DEDHD' },
      altitude: { phrase: 'maintain', feet: 3000 },
      frequency: '120.9',
    },
  ],
  [
    'a jet north via DEDHD off 10L in 19/10 gets CIITY',
    { runwayConfigId: '19/10', departureRunway: '10L', filedRoute: 'CIITY3 DEDHD RBL LMT HAWKZ7' },
    {
      sidId: 'CIITY3',
      route: { template: 'transition', fix: 'DEDHD' },
      altitude: { phrase: 'climb_via' },
      frequency: '120.9',
    },
  ],
  [
    'a jet south via SUSEY off 10R gets SAHEY',
    {
      ...SOUTHBOUND_LAX,
      filedRoute: 'SAHEY4 SUSEY EBAYE BURGL IRNMN2',
      runwayConfigId: '19/10',
      departureRunway: '10R',
    },
    {
      sidId: 'SAHEY4',
      route: { template: 'transition', fix: 'SUSEY' },
      altitude: { phrase: 'climb_via' },
      frequency: '135.1',
    },
  ],
];

describe('resolveClearance on the generated KSFO data', () => {
  it.each(CASES)('%s', (_name, overrides, expected) => {
    const flight = scenario(overrides);
    const clearance = clearanceFor(flight);
    expect(clearance.sid.value.id).toBe(expected.sidId);
    expect(clearance.route.value).toEqual(expected.route);
    expect(clearance.altitude.value).toEqual(expected.altitude);
    expect(clearance.frequency.value.value).toBe(expected.frequency);
    expect(clearance.clearedTo.value).toBe(flight.destination);
    expect(clearance.runway.value).toBe(flight.departureRunway);
    const expectClause = expected.expectClause === undefined ? null : expected.expectClause;
    expect(clearance.expect.value).toEqual(expectClause);
    for (const element of [
      clearance.clearedTo,
      clearance.sid,
      clearance.route,
      clearance.altitude,
      clearance.expect,
      clearance.frequency,
      clearance.runway,
    ]) {
      expect(element.citations.length).toBeGreaterThan(0);
    }
  });

  it('cites the assignment row, and the notice that changed the outcome', () => {
    const clearance = clearanceFor(scenario({ ...SOUTHBOUND_SAN, departureRunway: '01L' }));
    expect(clearance.sid.citations.map((citation) => citation.id)).toEqual([
      'SFOW-S-SSTIK-01',
      'SFO-SEGUL-OFF',
    ]);
  });

  it('cites only the assignment row when no notice changed the outcome', () => {
    const clearance = clearanceFor(scenario({}));
    expect(clearance.sid.citations.map((citation) => citation.id)).toEqual(['SFOW-N-TRUKN-01']);
  });

  const truknBaseFix = ksfo.sids.find((sid) => sid.id === 'TRUKN2')?.baseFix;

  it.skipIf(truknBaseFix === undefined)(
    'names the base fix and says "then as filed" when the flight leaves on it',
    () => {
      const clearance = clearanceFor(scenario({ filedRoute: 'TRUKN2 TRUKN CCR CCR2' }));
      expect(clearance.sid.value.id).toBe('TRUKN2');
      expect(clearance.route.value).toEqual({ template: 'as_filed', fix: 'TRUKN' });
    },
  );

  it.skipIf(truknBaseFix !== undefined)(
    'cannot place a flight on a SID base fix while the data has no base fix',
    () => {
      const result = resolveClearance(scenario({ filedRoute: 'TRUKN2 TRUKN CCR CCR2' }), ksfo);
      expect(result).toMatchObject({ ok: false, unresolved: [{ element: 'R.sid' }] });
    },
  );

  it('vectors a flight that joins an airway onto a radar-vector SID', () => {
    const clearance = clearanceFor(
      scenario({ filedRoute: 'SFO4 V6 SAC', destination: 'KSMF', filedAltitude: 11000 }),
    );
    expect(clearance.sid.value.family).toBe('SFO');
    expect(clearance.route.value).toEqual({ template: 'radar_vectors_airway', fix: 'V6' });
    expect(clearance.route.citations.map((citation) => citation.id)).toEqual(['R-RV-AIRWAY']);
  });

  it('blocks a route that joins an airway with no fix to place it in a gate', () => {
    const result = resolveClearance(scenario({ filedRoute: 'SFO4 V6' }), ksfo);
    expect(result).toMatchObject({ ok: false, unresolved: [{ element: 'R.route' }] });
  });

  it('speaks the expect clause when the SID chart publishes no expect note', () => {
    const airport: AirportData = {
      ...ksfo,
      sids: ksfo.sids.map((sid) => ({ ...sid, chartExpectFiledAltitudeMinutes: null })),
    };
    expect(clearanceFor(scenario({}), airport).expect.value).toEqual({
      feet: scenario({}).filedAltitude,
      minutes: 10,
    });
  });

  it('speaks no expect clause once the phraseology toggle says never', () => {
    const airport: AirportData = {
      ...ksfo,
      phraseology: { ...ksfo.phraseology, expectAltitude: 'never' },
    };
    expect(clearanceFor(scenario({}), airport).expect.value).toBeNull();
  });

  it('blocks the SID element when the airway leads to a fix in no departure gate', () => {
    const result = resolveClearance(scenario({ filedRoute: 'TRUKN2 J501 OED' }), ksfo);
    expect(result).toMatchObject({
      ok: false,
      unresolved: [{ element: 'R.sid', reason: expect.stringContaining('no-gate') }],
    });
  });

  it('blocks the SID element for an aircraft type the data does not class', () => {
    const result = resolveClearance(scenario({ aircraftType: 'ZZZZ' }), ksfo);
    expect(result).toMatchObject({ ok: false, unresolved: [{ element: 'R.sid' }] });
  });

  it('blocks the SID element for a non-RNAV prop sent off runway heading at night', () => {
    const result = resolveClearance(
      scenario({
        aircraftType: 'C172',
        equipmentSuffix: '/A',
        runwayConfigId: '01/01',
        departureRunway: '01L',
        filedRoute: 'OAK V6 SAC',
        destination: 'KSMF',
        filedAltitude: 5000,
        localTime: '2300',
      }),
      ksfo,
    );
    expect(result).toMatchObject({
      ok: false,
      unresolved: [{ element: 'R.sid', reason: expect.stringContaining('runway heading') }],
    });
  });
});
