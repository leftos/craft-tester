import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type {
  AirportData,
  AssignmentRule,
  Notice,
  RunwayConfig,
  Scenario,
  Sid,
} from '@/data/schema.ts';
import type { Classification } from '@/rules/classify.ts';
import { selectSid } from '@/rules/sidSelection.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

const ksfo = ksfoJson as unknown as AirportData;

function sid(id: string): Sid {
  const found = ksfo.sids.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`${id} is not in the data`);
  return found;
}

const config: RunwayConfig = {
  id: '28/01',
  name: 'Landing runways 28, departing runways 01',
  plan: 'SFOW',
  arrivalRunways: ['28L', '28R'],
  departureRunways: [{ runway: '01R', classes: ['P', 'T', 'J'], defaultForClasses: [] }],
};

const BASE_CTX: Classification = {
  aircraftClass: 'J',
  plan: 'SFOW',
  runwayFamily: '01',
  config,
  activeNoiseWindows: [],
  activeNotices: [],
};

const BASE_SCENARIO: Scenario = {
  callsign: 'UAL1',
  aircraftType: 'B738',
  rnavCapable: true,
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
    expect(result.sid.id).toBe('TRUKN2');
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
    expect(result.sid.id).toBe('SFO5');
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
    expect(result.sid.id).toBe('SEGUL1');
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
    expect(result.sid.id).toBe('SEGUL1');
  });

  it('blocks the SID element on a row that clears the flight without a procedure', () => {
    const noDp = rule({
      id: 'NO-DP',
      text: 'Noise abatement: runway 01, non-RNAV props -> runway heading (no DP)',
      sidFamily: null,
      nonDpHeading: 'runway heading',
    });
    expect(selectSid(ctx({}), 'DEDHD', 'north', scenario({}), airportWith([noDp]))).toEqual({
      element: 'R.sid',
      reason: noDp.text,
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
      ctx({}),
      'DEDHD',
      'north',
      scenario({ rnavCapable: false }),
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
    expect(result.sid.id).toBe('TRUKN2');
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
});
