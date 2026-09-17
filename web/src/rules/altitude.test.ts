import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type {
  AirportData,
  AltitudeRule,
  NonDpHeading,
  RunwayConfig,
  Scenario,
  Sid,
  TecRoute,
} from '@/data/schema.ts';
import { resolveAltitude } from '@/rules/altitude.ts';
import type { Classification } from '@/rules/classify.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

const ksfo = ksfoJson as unknown as AirportData;

function sid(id: string): Sid {
  const found = ksfo.sids.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`${id} is not in the data`);
  return found;
}

const config: RunwayConfig = {
  id: '28/01',
  source: 'SFO ATCT SOP 1-7',
  name: 'Landing runways 28, departing runways 01',
  plan: 'SFOW',
  trainingWeight: 55,
  arrivalRunways: ['28L', '28R'],
  departureRunways: [
    {
      runway: '01R',
      classes: ['P', 'T', 'J'],
      defaultForAirlines: [],
      defaultForGroups: [],
      defaultForClasses: [],
      onRequestFor: [],
    },
  ],
};

const BASE_CTX: Classification = {
  aircraftClass: 'J',
  aircraftType: 'B738',
  approachCategory: undefined,
  plan: 'SFOW',
  runwayFamily: '01',
  config,
  rnavCapable: true,
  gnssCapable: true,
  activeNoiseWindows: [],
  activeNotices: [],
};

const BASE_SCENARIO: Scenario = {
  callsign: 'UAL1',
  aircraftType: 'B738',
  equipmentSuffix: '/L',
  destination: 'KSEA',
  filedRoute: 'TRUKN2 DEDHD',
  filedAltitude: 34000,
  runwayConfigId: '28/01',
  departureRunway: '01R',
  localTime: '1400',
  dayOfWeek: 'tuesday',
  squawk: '1234',
};

/** An interim-altitude row that clears every jet off the 01s with a plain "climb via SID". */
const CLIMB_VIA_ROW: AltitudeRule = {
  id: 'TEST-CVS',
  source: 'test',
  text: 'climb via',
  plan: 'SFOW',
  runwayFamilies: ['01'],
  classes: ['J'],
  outcome: { kind: 'climb_via' },
  whenTopAltitudePublished: 'interim',
  expectAfterMinutes: 10,
};

/**
 * KSFO's own rows apply the interim table regardless of the top altitude since the user's 2026-09-15
 * review, so the cases below that defer to a published top altitude use a deferring row as test data.
 */
function withDeferringRow(airport: AirportData): AirportData {
  return {
    ...airport,
    altitudeRules: airport.altitudeRules.map((rule) =>
      rule.id === 'SFOW-J-10000' ? { ...rule, whenTopAltitudePublished: 'climb_via' } : rule,
    ),
  };
}

function ctx(overrides: Partial<Classification>): Classification {
  return Object.assign({ ...BASE_CTX }, overrides);
}

function scenario(overrides: Partial<Scenario>): Scenario {
  return Object.assign({ ...BASE_SCENARIO }, overrides);
}

function resolve(
  classification: Classification,
  procedure: Sid,
  flight: Scenario,
  airport: AirportData = ksfo,
) {
  const result = resolveAltitude(classification, { kind: 'sid', sid: procedure }, flight, airport);
  if (isUnresolved(result)) throw new Error(result.reason);
  return result;
}

describe('resolveAltitude', () => {
  it('clears a SID with a published top altitude to climb via the SID', () => {
    const result = resolve(ctx({}), sid('TRUKN2'), scenario({}), withDeferringRow(ksfo));
    expect(result.altitude.value).toEqual({ phrase: 'climb_via' });
    expect(result.altitude.citations.map((citation) => citation.id)).toEqual([
      'A-CLIMB-VIA',
      'SFOW-J-10000',
    ]);
  });

  it('issues the interim altitude when the SID has no published top altitude', () => {
    const result = resolve(ctx({}), sid('SEGUL1'), scenario({}));
    expect(result.altitude.value).toEqual({ phrase: 'climb_via_except', feet: 10000 });
    expect(result.altitude.citations.map((citation) => citation.id)).toEqual([
      'A-CLIMB-VIA-EXCEPT',
      'SFOW-J-10000',
    ]);
  });

  it('takes the SID-specific interim row off the 28s', () => {
    const result = resolve(ctx({ runwayFamily: '28' }), sid('WESLA5'), scenario({}));
    expect(result.altitude.value).toEqual({ phrase: 'climb_via_except', feet: 3000 });
    expect(result.altitude.citations.map((citation) => citation.id)).toEqual([
      'A-CLIMB-VIA-EXCEPT',
      'SFOW-28-3000',
    ]);
  });

  it('says "maintain" for a SID with no crossing restrictions', () => {
    const result = resolve(ctx({ runwayFamily: '28' }), sid('GAPP7'), scenario({}));
    expect(result.altitude.value).toEqual({ phrase: 'maintain', feet: 3000 });
    expect(result.altitude.citations.map((citation) => citation.id)).toEqual([
      'A-MAINTAIN',
      'SFOW-28-3000',
    ]);
  });

  it('follows the per-runway crossing restrictions of a radar-vector SID', () => {
    expect(resolve(ctx({}), sid('SFO5'), scenario({})).altitude.value).toEqual({
      phrase: 'climb_via_except',
      feet: 10000,
    });
    expect(
      resolve(ctx({ runwayFamily: '28' }), sid('SFO5'), scenario({ departureRunway: '28L' }))
        .altitude.value,
    ).toEqual({ phrase: 'maintain', feet: 3000 });
  });

  it('caps the interim altitude at the filed altitude', () => {
    const result = resolve(ctx({}), sid('SEGUL1'), scenario({ filedAltitude: 5000 }));
    expect(result.altitude.value).toEqual({ phrase: 'climb_via_except', feet: 5000 });
  });

  it('turns a filed altitude below the published top altitude into climb via SID except maintain filed', () => {
    const result = resolve(
      ctx({}),
      sid('TRUKN2'),
      scenario({ filedAltitude: 11000 }),
      withDeferringRow(ksfo),
    );
    expect(result.altitude.value).toEqual({ phrase: 'climb_via_except', feet: 11000 });
    expect(result.altitude.citations.map((citation) => citation.id)).toEqual([
      'A-CLIMB-VIA-EXCEPT',
      'SFOW-J-10000',
    ]);
  });

  it('leaves a filed altitude at the published top altitude a plain climb via SID', () => {
    const result = resolve(
      ctx({}),
      sid('TRUKN2'),
      scenario({ filedAltitude: 19000 }),
      withDeferringRow(ksfo),
    );
    expect(result.altitude.value).toEqual({ phrase: 'climb_via' });
    expect(result.altitude.citations.map((citation) => citation.id)).toEqual([
      'A-CLIMB-VIA',
      'SFOW-J-10000',
    ]);
  });

  it('honours a row whose outcome is a plain climb via SID', () => {
    const airport: AirportData = {
      ...ksfo,
      // GAPP7 publishes no top altitude, so there is no altitude to compare the filed one with and
      // `always` speaks the clause; this case is about the phrase, so the mode is pinned.
      phraseology: { ...ksfo.phraseology, expectAltitude: 'always' },
      altitudeRules: [CLIMB_VIA_ROW],
    };
    const result = resolve(ctx({}), sid('GAPP7'), scenario({}), airport);
    expect(result.altitude.value).toEqual({ phrase: 'climb_via' });
  });

  it('keys a row to a type its group adds outside the classes the row lists', () => {
    const airport: AirportData = {
      ...ksfo,
      aircraftGroups: { jets_and_dh8d: { classes: ['J'], types: ['DH8D'] } },
      altitudeRules: [{ ...CLIMB_VIA_ROW, groups: ['jets_and_dh8d'] }],
    };
    const dash8 = ctx({ aircraftClass: 'T', aircraftType: 'DH8D' });
    const result = resolve(dash8, sid('GAPP7'), scenario({ aircraftType: 'DH8D' }), airport);
    expect(result.altitude.citations.map((citation) => citation.id)).toContain('TEST-CVS');
  });

  it('blocks the altitude element for a turboprop the row and its group both pass over', () => {
    const airport: AirportData = {
      ...ksfo,
      aircraftGroups: { jets_and_dh8d: { classes: ['J'], types: ['DH8D'] } },
      altitudeRules: [{ ...CLIMB_VIA_ROW, groups: ['jets_and_dh8d'] }],
    };
    const result = resolveAltitude(
      ctx({ aircraftClass: 'T', aircraftType: 'SF34' }),
      { kind: 'sid', sid: sid('GAPP7') },
      scenario({ aircraftType: 'SF34' }),
      airport,
    );
    expect(result).toEqual({ element: 'A.phrase', reason: expect.stringContaining('class T') });
  });

  it('blocks the altitude element when no row is keyed to the flight', () => {
    const result = resolveAltitude(
      ctx({ plan: 'SFOX' }),
      { kind: 'sid', sid: sid('TRUKN2') },
      scenario({}),
      ksfo,
    );
    expect(result).toEqual({ element: 'A.phrase', reason: expect.stringContaining('SFOX') });
  });
});

describe('a row keyed to non-DP headings', () => {
  /** An interim row written for the jets cleared off the 01s on heading 315 and no one else. */
  const HEADING_ROW: AltitudeRule = {
    ...CLIMB_VIA_ROW,
    id: 'TEST-315',
    nonDpHeadings: [315],
    outcome: { kind: 'interim', feet: 4000 },
  };

  /** An interim row keyed to neither SID families nor headings, so it answers every procedure. */
  const ANY_PROCEDURE_ROW: AltitudeRule = {
    ...CLIMB_VIA_ROW,
    id: 'TEST-ANY',
    outcome: { kind: 'interim', feet: 5000 },
  };

  function onHeading(heading: NonDpHeading, rules: AltitudeRule[]) {
    return resolveAltitude(ctx({}), { kind: 'heading', heading, turn: undefined }, scenario({}), {
      ...ksfo,
      altitudeRules: rules,
    });
  }

  it('answers a flight cleared on a heading it lists', () => {
    const result = onHeading(315, [HEADING_ROW]);
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.altitude.value).toEqual({ phrase: 'maintain', feet: 4000 });
    expect(result.altitude.citations.map((citation) => citation.id)).toEqual([
      'A-MAINTAIN',
      'TEST-315',
    ]);
  });

  it('passes over a flight cleared on a heading it does not list', () => {
    expect(onHeading('runway heading', [HEADING_ROW])).toEqual({
      element: 'A.phrase',
      reason: expect.stringContaining('no altitude rule'),
    });
  });

  it('passes over a flight flying a SID', () => {
    const result = resolveAltitude(ctx({}), { kind: 'sid', sid: sid('TRUKN2') }, scenario({}), {
      ...ksfo,
      altitudeRules: [HEADING_ROW],
    });
    expect(result).toEqual({ element: 'A.phrase', reason: expect.stringContaining('TRUKN') });
  });

  it('leaves a row keyed to neither answering the heading clearances it always answered', () => {
    const result = onHeading(120, [ANY_PROCEDURE_ROW]);
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.altitude.value).toEqual({ phrase: 'maintain', feet: 5000 });
  });
});

describe('the expect clause', () => {
  function withExpectAltitude(mode: AirportData['phraseology']['expectAltitude']): AirportData {
    return { ...ksfo, phraseology: { ...ksfo.phraseology, expectAltitude: mode } };
  }

  /** The SID as it would be published by a chart that carries no expect note of its own. */
  function withoutChartNote(id: string): Sid {
    return { ...sid(id), chartExpectFiledAltitudeMinutes: null };
  }

  it('is spoken under always while the filed altitude is above the altitude cleared to', () => {
    const result = resolve(ctx({}), sid('TRUKN2'), scenario({}), withExpectAltitude('always'));
    expect(result.expect.value).toEqual({ kind: 'filed', feet: 34000, minutes: 10 });
    expect(result.expect.citations.map((citation) => citation.id)).toEqual(['A-EXPECT']);
    expect(result.redundantExpect.value).toBeNull();
  });

  it('is never spoken while the toggle says never', () => {
    const result = resolve(ctx({}), sid('SEGUL1'), scenario({}), withExpectAltitude('never'));
    expect(result.expect.value).toBeNull();
  });

  it('always still drops the clause when filed equals the altitude cleared to', () => {
    const airport = withDeferringRow(withExpectAltitude('always'));
    const result = resolve(ctx({}), sid('TRUKN2'), scenario({ filedAltitude: 19000 }), airport);
    expect(result.altitude.value).toEqual({ phrase: 'climb_via' });
    expect(result.expect.value).toBeNull();
  });

  it('drops the expect clause when the interim altitude equals the filed altitude', () => {
    const airport = withExpectAltitude('always');
    const result = resolve(ctx({}), sid('SEGUL1'), scenario({ filedAltitude: 10000 }), airport);
    expect(result.altitude.value).toEqual({ phrase: 'climb_via_except', feet: 10000 });
    expect(result.expect.value).toBeNull();
  });

  it('keeps the expect clause when the interim altitude is below the filed altitude', () => {
    const airport = withExpectAltitude('always');
    expect(resolve(ctx({}), sid('SEGUL1'), scenario({}), airport).expect.value).toEqual({
      kind: 'filed',
      feet: 34000,
      minutes: 10,
    });
  });

  it('speaks the clause under always when the SID publishes no top altitude to compare with', () => {
    const airport: AirportData = {
      ...withExpectAltitude('always'),
      altitudeRules: [CLIMB_VIA_ROW],
    };
    const result = resolve(ctx({}), sid('GAPP7'), scenario({}), airport);
    expect(result.altitude.value).toEqual({ phrase: 'climb_via' });
    expect(result.expect.value).toEqual({ kind: 'filed', feet: 34000, minutes: 10 });
  });

  it('speaks the clause when the chart publishes no expect note', () => {
    const airport = withExpectAltitude('unless_chart_publishes_it');
    const result = resolve(ctx({}), withoutChartNote('TRUKN2'), scenario({}), airport);
    expect(result.expect.value).toEqual({ kind: 'filed', feet: 34000, minutes: 10 });
  });

  it('drops the clause when the chart publishes the note', () => {
    expect(sid('TRUKN2').chartExpectFiledAltitudeMinutes).toBe(10);
    const airport = withExpectAltitude('unless_chart_publishes_it');
    expect(resolve(ctx({}), sid('TRUKN2'), scenario({}), airport).expect.value).toBeNull();
  });

  it('reports the clause the chart publishes as the redundant one, at the chart delay', () => {
    const airport = withExpectAltitude('unless_chart_publishes_it');
    const result = resolve(ctx({}), sid('TRUKN2'), scenario({}), airport);
    expect(result.expect.value).toBeNull();
    expect(result.redundantExpect.value).toEqual({ feet: 34000, minutes: 10 });
    expect(result.redundantExpect.citations.map((citation) => citation.id)).toEqual([
      'A-EXPECT-REDUNDANT',
    ]);
  });

  it('reports nothing redundant under always, where the clause is spoken', () => {
    const result = resolve(ctx({}), sid('TRUKN2'), scenario({}), withExpectAltitude('always'));
    expect(result.expect.value).not.toBeNull();
    expect(result.redundantExpect.value).toBeNull();
    expect(result.redundantExpect.citations).toEqual([]);
  });

  it('reports nothing redundant under never, where no clause is ever spoken', () => {
    const result = resolve(ctx({}), sid('TRUKN2'), scenario({}), withExpectAltitude('never'));
    expect(result.expect.value).toBeNull();
    expect(result.redundantExpect.value).toBeNull();
  });

  it('reports nothing redundant when the flight is cleared to the altitude it filed', () => {
    const airport = withExpectAltitude('unless_chart_publishes_it');
    const result = resolve(ctx({}), sid('TRUKN2'), scenario({ filedAltitude: 10000 }), airport);
    expect(result.altitude.value).toEqual({ phrase: 'climb_via_except', feet: 10000 });
    expect(result.expect.value).toBeNull();
    expect(result.redundantExpect.value).toBeNull();
  });

  it('reports nothing redundant for a flight filed at the published top altitude', () => {
    const airport = withDeferringRow(withExpectAltitude('unless_chart_publishes_it'));
    const result = resolve(ctx({}), sid('TRUKN2'), scenario({ filedAltitude: 19000 }), airport);
    expect(result.altitude.value).toEqual({ phrase: 'climb_via' });
    expect(result.expect.value).toBeNull();
    expect(result.redundantExpect.value).toBeNull();
  });
});

/** The flight the TEC rows below are keyed to: a jet in SFOW off the 01s, filed to Sacramento. */
const TEC_FLIGHT: Partial<Scenario> = { destination: 'KSMF', filedRoute: 'TRUKN2 TRUKN FEVTA' };

/** A TEC row keyed to that flight, which the airport data carries ahead of its own rows. */
function withTecRow(row: Partial<TecRoute>, airport: AirportData = ksfo): AirportData {
  const base: TecRoute = {
    id: 'TEC-TEST',
    source: 'test',
    kind: 'tec',
    destination: 'KSMF',
    plan: 'SFOW',
    runwayFamilies: [],
    classes: ['J'],
    route: 'TRUKN# TRUKN FEVTA FEVTA1',
  };
  return { ...airport, tecRoutes: [{ ...base, ...row }, ...airport.tecRoutes] };
}

/** Resolves the altitude for a flight cleared on a heading rather than on a procedure. */
function resolveOnHeading(heading: NonDpHeading, flight: Scenario, airport: AirportData) {
  const result = resolveAltitude(
    ctx({}),
    { kind: 'heading', heading, turn: undefined },
    flight,
    airport,
  );
  if (isUnresolved(result)) throw new Error(result.reason);
  return result;
}

describe('resolveAltitude with a TEC initial altitude', () => {
  it('maintains the initial altitude of a row issued on an initial heading', () => {
    const airport = withTecRow({
      route: 'H270 FEVTA FEVTA1',
      initialAltitudeFeet: 3000,
      finalAltitudeFeet: 10000,
    });
    const result = resolveOnHeading(
      270,
      scenario({ ...TEC_FLIGHT, filedAltitude: 10000 }),
      airport,
    );
    expect(result.altitude.value).toEqual({ phrase: 'maintain', feet: 3000 });
    expect(result.altitude.citations.map((citation) => citation.id)).toEqual([
      'A-MAINTAIN',
      'TEC-TEST',
    ]);
  });

  it('speaks the expect clause at the phraseology delay, which the TEC row states none of', () => {
    const airport = withTecRow({
      route: 'H270 FEVTA FEVTA1',
      initialAltitudeFeet: 3000,
      finalAltitudeFeet: 10000,
    });
    const result = resolveOnHeading(
      270,
      scenario({ ...TEC_FLIGHT, filedAltitude: 10000 }),
      airport,
    );
    expect(result.expect.value).toEqual({ kind: 'filed', feet: 10000, minutes: 3 });
  });

  it('says nothing to expect when the initial altitude is the altitude filed', () => {
    const airport = withTecRow({ initialAltitudeFeet: 10000, finalAltitudeFeet: 10000 });
    const result = resolveOnHeading(
      270,
      scenario({ ...TEC_FLIGHT, filedAltitude: 10000 }),
      airport,
    );
    expect(result.expect.value).toBeNull();
  });

  it('issues an initial altitude below the published top as climb via SID except maintain', () => {
    const airport = withTecRow({ initialAltitudeFeet: 3000, finalAltitudeFeet: 10000 });
    const result = resolve(ctx({}), sid('TRUKN2'), scenario(TEC_FLIGHT), airport);
    expect(result.altitude.value).toEqual({ phrase: 'climb_via_except', feet: 3000 });
    expect(result.altitude.citations.map((citation) => citation.id)).toEqual([
      'A-CLIMB-VIA-EXCEPT',
      'TEC-TEST',
    ]);
  });

  it('issues an initial altitude at the published top as a plain climb via SID', () => {
    const airport = withTecRow({ initialAltitudeFeet: 19000, finalAltitudeFeet: 19000 });
    const result = resolve(ctx({}), sid('TRUKN2'), scenario(TEC_FLIGHT), airport);
    expect(result.altitude.value).toEqual({ phrase: 'climb_via' });
    expect(result.altitude.citations.map((citation) => citation.id)).toEqual([
      'A-CLIMB-VIA',
      'TEC-TEST',
    ]);
  });

  it('does not cap the initial altitude at the altitude the pilot filed', () => {
    const airport = withTecRow({ initialAltitudeFeet: 10000, finalAltitudeFeet: 10000 });
    const result = resolve(
      ctx({}),
      sid('TRUKN2'),
      scenario({ ...TEC_FLIGHT, filedAltitude: 5000 }),
      airport,
    );
    expect(result.altitude.value).toEqual({ phrase: 'climb_via_except', feet: 10000 });
  });

  it('reads the SOP rows when the row begins on a departure this clearance does not issue', () => {
    const airport = withTecRow({
      route: 'GAPP# OAK V6 SAC',
      initialAltitudeFeet: 3000,
      finalAltitudeFeet: 10000,
    });
    const result = resolve(ctx({}), sid('TRUKN2'), scenario(TEC_FLIGHT), airport);
    expect(result.altitude.value).toEqual({ phrase: 'climb_via' });
    expect(result.altitude.citations.map((citation) => citation.id)).toEqual([
      'A-CLIMB-VIA',
      'SFOW-J-10000',
    ]);
  });

  it('reads the SOP rows when the row that routes the flight states no initial altitude', () => {
    const airport = withTecRow({ finalAltitudeFeet: 10000 });
    const result = resolve(ctx({}), sid('TRUKN2'), scenario(TEC_FLIGHT), airport);
    expect(result.altitude.value).toEqual({ phrase: 'climb_via' });
    expect(result.altitude.citations.map((citation) => citation.id)).toEqual([
      'A-CLIMB-VIA',
      'SFOW-J-10000',
    ]);
  });
});
