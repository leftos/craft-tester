import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type {
  AirportData,
  AssignmentRule,
  NonDpHeading,
  Notice,
  RunwayConfig,
  Scenario,
  Sid,
} from '@/data/schema.ts';
import type { Classification } from '@/rules/classify.ts';
import type { SidSelection } from '@/rules/sidSelection.ts';
import { selectSid, unservedSids } from '@/rules/sidSelection.ts';
import type { Unresolved } from '@/rules/types.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

const ksfo = ksfoJson as unknown as AirportData;

function sid(id: string): Sid {
  const found = ksfo.sids.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`${id} is not in the data`);
  return found;
}

/** The SID a selection put the flight on; a selection that clears it on a heading has none. */
function sidOf(selection: SidSelection): Sid {
  const { procedure } = selection;
  if (procedure.kind !== 'sid') throw new Error('the row cleared the flight without a procedure');
  return procedure.sid;
}

const config: RunwayConfig = {
  id: '28/01',
  source: 'SFO ATCT SOP 1-7',
  name: 'Landing runways 28, departing runways 01',
  plan: 'SFOW',
  trainingWeight: 55,
  arrivalRunways: ['28L', '28R'],
  departureRunways: [
    { runway: '01R', classes: ['P', 'T', 'J'], defaultForClasses: [], onRequestFor: [] },
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

const BASE_RULE: AssignmentRule = {
  id: 'R1',
  source: 'test',
  text: 'test row',
  plan: 'SFOW',
  direction: 'north',
  runwayFamilies: ['01'],
  classes: ['T', 'J'],
  sidFamily: 'TRUKN',
  sector: 'richmond',
};

function ctx(overrides: Partial<Classification>): Classification {
  return Object.assign({ ...BASE_CTX }, overrides);
}

function scenario(overrides: Partial<Scenario>): Scenario {
  return Object.assign({ ...BASE_SCENARIO }, overrides);
}

function rule(overrides: Partial<AssignmentRule>): AssignmentRule {
  return Object.assign({ ...BASE_RULE }, overrides);
}

function airportWith(rules: AssignmentRule[], notices: Notice[] = []): AirportData {
  return { ...ksfo, assignmentRules: rules, notices };
}

const segulOff: Notice = {
  id: 'SEGUL-OFF',
  source: 'test notice',
  dated: '2026-09-15',
  text: 'SEGUL SID: OFF',
  plan: 'SFOW',
  effect: { kind: 'sid_off', sidFamily: 'SEGUL' },
  defaultActive: true,
};

describe('selectSid', () => {
  it('takes the first applicable row whose SID the flight can fly', () => {
    const result = selectSid(
      ctx({}),
      'DEDHD',
      'north',
      scenario({}),
      airportWith([rule({ id: 'FIRST' }), rule({ id: 'SECOND', sidFamily: 'NIITE' })]),
    );
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.row.id).toBe('FIRST');
    expect(sidOf(result).id).toBe('TRUKN2');
    expect(result.sector).toBe('richmond');
    expect(result.notices).toEqual([]);
  });

  it.each([
    ['plan', rule({ plan: 'SFOE' })],
    ['direction', rule({ direction: 'south' })],
    ['runway family', rule({ runwayFamilies: ['28'] })],
    ['class', rule({ classes: ['P'] })],
    ['configs', rule({ when: { configs: ['28 RT'] } })],
    ['notConfigs', rule({ when: { notConfigs: ['28/01'] } })],
    ['noise window', rule({ when: { noiseWindow: 'night' } })],
    ['RNAV capability', rule({ when: { rnav: false } })],
    ['exit fixes', rule({ when: { exitFixes: ['YYUNG'] } })],
  ])('skips a row whose %s does not match', (_label, skipped) => {
    const result = selectSid(
      ctx({}),
      'DEDHD',
      'north',
      scenario({}),
      airportWith([skipped, rule({ id: 'FALLBACK', sidFamily: 'NIITE' })]),
    );
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.row.id).toBe('FALLBACK');
  });

  it('passes over a pilot-nav SID when the flight leaves on an airway', () => {
    const result = selectSid(
      ctx({}),
      'V6',
      'north',
      scenario({ filedRoute: 'SFO4 V6 SAC' }),
      airportWith([
        rule({ id: 'PILOT-NAV' }),
        rule({ id: 'VECTORS', sidFamily: 'SFO', classes: ['P', 'T', 'J'] }),
      ]),
    );
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.row.id).toBe('VECTORS');
    expect(sidOf(result).kind).toBe('radar_vectors');
  });

  it('has no SID at all when only pilot-nav rows apply to an airway', () => {
    const result = selectSid(
      ctx({}),
      'V6',
      'north',
      scenario({ filedRoute: 'SFO4 V6 SAC' }),
      airportWith([rule({ id: 'PILOT-NAV' })]),
    );
    expect(isUnresolved(result)).toBe(true);
  });

  it('applies a row whose conditions all hold', () => {
    const result = selectSid(
      ctx({ activeNoiseWindows: ['night'] }),
      'DEDHD',
      'north',
      scenario({}),
      airportWith([
        rule({
          id: 'CONDITIONS',
          sidFamily: 'NIITE',
          when: { configs: ['28/01'], noiseWindow: 'night', rnav: true, exitFixes: ['DEDHD'] },
        }),
      ]),
    );
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.row.id).toBe('CONDITIONS');
  });

  it('matches an "any" direction row when the exit fix is not a gate', () => {
    const result = selectSid(
      ctx({}),
      'NOTAGATE',
      undefined,
      scenario({}),
      airportWith([rule({ id: 'ANY', direction: 'any', sidFamily: 'SFO' })]),
    );
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(sidOf(result).id).toBe('SFO5');
  });

  it('skips a SID an active notice took out of use and cites the notice', () => {
    const result = selectSid(
      ctx({ activeNotices: ['SEGUL-OFF'] }),
      'YYUNG',
      'south',
      scenario({ departureRunway: '01L' }),
      airportWith(
        [
          rule({ id: 'SEGUL-ROW', direction: 'south', sidFamily: 'SEGUL', classes: ['J'] }),
          rule({ id: 'SSTIK-ROW', direction: 'south', sidFamily: 'SSTIK', classes: ['J'] }),
        ],
        [segulOff],
      ),
    );
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.row.id).toBe('SSTIK-ROW');
    expect(result.notices.map((notice) => notice.id)).toEqual(['SEGUL-OFF']);
  });

  it('ignores a notice that is not active', () => {
    const result = selectSid(
      ctx({ activeNotices: [] }),
      'YYUNG',
      'south',
      scenario({ departureRunway: '01L' }),
      airportWith(
        [rule({ id: 'SEGUL-ROW', direction: 'south', sidFamily: 'SEGUL', classes: ['J'] })],
        [segulOff],
      ),
    );
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(sidOf(result).id).toBe('SEGUL1');
    expect(result.notices).toEqual([]);
  });

  it('ignores a notice that names another operating plan', () => {
    const result = selectSid(
      ctx({ plan: 'SFOE', activeNotices: ['SEGUL-OFF'] }),
      'YYUNG',
      'south',
      scenario({ departureRunway: '01L' }),
      airportWith(
        [
          rule({
            id: 'SEGUL-ROW',
            plan: 'SFOE',
            direction: 'south',
            sidFamily: 'SEGUL',
            classes: ['J'],
          }),
        ],
        [segulOff],
      ),
    );
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(sidOf(result).id).toBe('SEGUL1');
  });

  it('clears the flight on the runway heading on a row that assigns no procedure', () => {
    const noDp = rule({
      id: 'NO-DP',
      text: 'Noise abatement: runway 01, non-RNAV props -> runway heading (no DP)',
      sidFamily: null,
      nonDpHeading: 'runway heading',
    });
    const result = selectSid(ctx({}), 'DEDHD', 'north', scenario({}), airportWith([noDp]));
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.procedure).toEqual({
      kind: 'heading',
      heading: 'runway heading',
      turn: undefined,
    });
    expect(result.row.id).toBe('NO-DP');
    expect(result.sector).toBe('richmond');
  });

  /** The selection for a row that clears a flight off the 28s on the heading it names. */
  function offThe28s(
    nonDpHeading: NonDpHeading,
    departureRunway = '28L',
  ): SidSelection | Unresolved {
    const row = rule({ id: 'NO-DP-28', sidFamily: null, nonDpHeading, runwayFamilies: ['28'] });
    return selectSid(
      ctx({ runwayFamily: '28' }),
      'DEDHD',
      'north',
      scenario({ departureRunway }),
      airportWith([row]),
    );
  }

  it('turns the shorter way onto a numbered heading left of the runway bearing', () => {
    const result = offThe28s(270);
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.procedure).toEqual({ kind: 'heading', heading: 270, turn: 'left' });
  });

  it('turns the shorter way onto a numbered heading right of the runway bearing', () => {
    const result = offThe28s(315);
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.procedure).toEqual({ kind: 'heading', heading: 315, turn: 'right' });
  });

  it('issues no turn where the heading is the runway bearing itself', () => {
    const result = offThe28s(284);
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.procedure).toEqual({ kind: 'heading', heading: 284, turn: undefined });
  });

  it('blocks the SID element on a heading opposite the departure runway', () => {
    expect(offThe28s(104)).toEqual({
      element: 'R.sid',
      reason: expect.stringContaining('NO-DP-28'),
    });
  });

  it('blocks the SID element where the runway has no bearing on file', () => {
    expect(offThe28s(270, '28C')).toEqual({
      element: 'R.sid',
      reason: expect.stringContaining('28C'),
    });
  });

  it('lists the rows that applied but whose SID does not fit the runway', () => {
    const result = selectSid(
      ctx({}),
      'DEDHD',
      'north',
      scenario({ departureRunway: '01L' }),
      airportWith([rule({ id: 'TRUKN-ROW' })]),
    );
    expect(result).toEqual({
      element: 'R.sid',
      reason: expect.stringContaining('TRUKN-ROW'),
    });
  });

  it('rejects an RNAV SID for a flight without RNAV', () => {
    const result = selectSid(
      ctx({ rnavCapable: false }),
      'DEDHD',
      'north',
      scenario({ equipmentSuffix: '/A' }),
      airportWith([rule({ id: 'TRUKN-ROW' })]),
    );
    expect(result).toMatchObject({ element: 'R.sid' });
  });

  it('rejects a pilot-nav SID that does not reach the exit fix', () => {
    const result = selectSid(
      ctx({}),
      'GOBBS',
      'north',
      scenario({}),
      airportWith([rule({ id: 'TRUKN-ROW' })]),
    );
    expect(result).toMatchObject({ element: 'R.sid' });
  });

  it('accepts a pilot-nav SID whose base fix is the exit fix', () => {
    const withBaseFix = { ...ksfo, sids: [{ ...sid('TRUKN2'), baseFix: 'TRUKN' }] };
    const result = selectSid(ctx({}), 'TRUKN', 'north', scenario({}), {
      ...withBaseFix,
      assignmentRules: [rule({})],
    });
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(sidOf(result).id).toBe('TRUKN2');
  });

  it('names the flight when no row applies at all', () => {
    const result = selectSid(
      ctx({ aircraftClass: 'P' }),
      'DEDHD',
      'north',
      scenario({}),
      airportWith([rule({})]),
    );
    expect(result).toEqual({
      element: 'R.sid',
      reason: 'no assignment rule applies to SFOW north runway 01 class P',
    });
  });

  it('takes a row for a type its group adds outside the classes the row lists', () => {
    const airport: AirportData = {
      ...airportWith([rule({ id: 'JETS-AND-DH8D', classes: ['J'], groups: ['jets_and_dh8d'] })]),
      aircraftGroups: { jets_and_dh8d: { classes: ['J'], types: ['DH8D'] } },
    };
    const result = selectSid(
      ctx({ aircraftClass: 'T', aircraftType: 'DH8D' }),
      'DEDHD',
      'north',
      scenario({ aircraftType: 'DH8D' }),
      airport,
    );
    if (isUnresolved(result)) throw new Error(result.reason);
    expect(result.row.id).toBe('JETS-AND-DH8D');
  });

  it('walks past that row for a turboprop the group does not name', () => {
    const airport: AirportData = {
      ...airportWith([rule({ id: 'JETS-AND-DH8D', classes: ['J'], groups: ['jets_and_dh8d'] })]),
      aircraftGroups: { jets_and_dh8d: { classes: ['J'], types: ['DH8D'] } },
    };
    const result = selectSid(
      ctx({ aircraftClass: 'T', aircraftType: 'SF34' }),
      'DEDHD',
      'north',
      scenario({ aircraftType: 'SF34' }),
      airport,
    );
    expect(result).toEqual({
      element: 'R.sid',
      reason: 'no assignment rule applies to SFOW north runway 01 class T',
    });
  });
});

describe('unservedSids', () => {
  const swa984 = scenario({
    callsign: 'SWA984',
    aircraftType: 'B737',
    destination: 'KLAX',
    filedRoute: 'SSTIK5 EBAYE AVE SADDE8',
    departureRunway: '01L',
  });

  it('lists the SOP SID of a row above the one selectSid takes, with that row', () => {
    const result = unservedSids(ctx({}), 'EBAYE', 'south', swa984, ksfo);
    expect(result.map((candidate) => [candidate.sid.id, candidate.row.id])).toEqual([
      ['SSTIK5', 'SFOW-S-SSTIK-01'],
    ]);
  });

  it('is empty when the first applicable row already reaches the exit element', () => {
    const filed = { ...swa984, filedRoute: 'SSTIK5 SUSEY EBAYE AVE SADDE8' };
    expect(unservedSids(ctx({}), 'SUSEY', 'south', filed, ksfo)).toEqual([]);
  });
});
