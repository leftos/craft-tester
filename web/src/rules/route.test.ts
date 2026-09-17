import { describe, expect, it } from 'vitest';
import koakJson from '@data/koak.json';
import ksfoJson from '@data/ksfo.json';
import type { AirportData, Scenario } from '@/data/schema.ts';
import {
  directionOf,
  isAirwayToken,
  isMalformedToken,
  isSidToken,
  parseFiledRoute,
  rnavElements,
  routeFromExitFix,
} from '@/rules/route.ts';

const ksfo = ksfoJson as unknown as AirportData;
const koak = koakJson as unknown as AirportData;

/** A filed plan whose route box is the only thing these tests read. */
function plan(filedRoute: string): Scenario {
  return {
    callsign: 'UAL1',
    aircraftType: 'B738',
    equipmentSuffix: '/L',
    destination: 'KSEA',
    filedRoute,
    filedAltitude: 34000,
    runwayConfigId: '28/01',
    departureRunway: '01R',
    localTime: '1400',
    dayOfWeek: 'tuesday',
    squawk: '1234',
  };
}

describe('isSidToken', () => {
  it.each([
    ['TRUKN2', true],
    ['SFO5', true],
    ['GAPP7', true],
    ['WAATS5', true],
    ['IRNMN2', true],
    ['TRUKN', false],
    ['J501', false],
    ['V244', false],
    ['V6', false],
    ['Q124', false],
    ['Q158', false],
    ['T257', false],
    ['R463', false],
    ['R464', false],
    ['A220', false],
  ])('classifies %s', (token, expected) => {
    expect(isSidToken(token)).toBe(expected);
  });
});

describe('isAirwayToken', () => {
  it.each([
    ['V6', true],
    ['J501', true],
    ['Q124', true],
    ['Q158', true],
    ['T257', true],
    ['R463', true],
    ['R464', true],
    ['A220', true],
    ['SAC', false],
    ['DEDHD', false],
    ['TRUKN2', false],
    ['WAATS5', false],
  ])('classifies %s', (token, expected) => {
    expect(isAirwayToken(token)).toBe(expected);
  });
});

describe('isMalformedToken', () => {
  it.each([
    ['BVLQ124', true],
    ['SFOWESLA', true],
    ['MOGEE', false],
    ['BVL', false],
    ['Q124', false],
    ['R464', false],
    ['WAATS5', false],
    ['TRUKN2', false],
    ['(continued)', false],
    ['ANN…', false],
  ])('classifies %s', (token, expected) => {
    expect(isMalformedToken(token)).toBe(expected);
  });
});

describe('routeFromExitFix', () => {
  it.each([
    ['TRUKN2 DEDHD RBL LMT HAWKZ7', ['DEDHD', 'RBL', 'LMT', 'HAWKZ7']],
    ['WESLA5 SFO SUSEY EBAYE', ['SUSEY', 'EBAYE']],
    ['DEDHD RBL LMT', ['DEDHD', 'RBL', 'LMT']],
    ['  TRUKN2   DEDHD  ', ['DEDHD']],
    ['TRUKN2', []],
    ['   ', []],
  ])('takes %s from its exit fix', (filedRoute, expected) => {
    expect(routeFromExitFix(filedRoute, 'SFO')).toEqual(expected);
  });
});

describe('parseFiledRoute', () => {
  it('strips the filed procedure and takes the next fix as the exit fix', () => {
    expect(parseFiledRoute('TRUKN2 DEDHD RBL LMT HAWKZ7', ksfo)).toEqual({
      filedSidToken: 'TRUKN2',
      exitElement: 'DEDHD',
      exitFix: 'DEDHD',
      tokens: ['DEDHD', 'RBL', 'LMT', 'HAWKZ7'],
    });
  });

  it('keeps a route that was filed without a procedure', () => {
    expect(parseFiledRoute('DEDHD RBL LMT', ksfo)).toEqual({
      exitElement: 'DEDHD',
      exitFix: 'DEDHD',
      tokens: ['DEDHD', 'RBL', 'LMT'],
    });
  });

  it('leaves on the airway a route joins straight off the procedure', () => {
    expect(parseFiledRoute('SFO4 V6 SAC DEDHD', ksfo)).toEqual({
      filedSidToken: 'SFO4',
      exitElement: 'V6',
      exitFix: 'SAC',
      tokens: ['V6', 'SAC', 'DEDHD'],
    });
  });

  it('takes the gate fix from after the airports own navaid and the airway alike', () => {
    expect(parseFiledRoute('GAPP7 SFO V6 SAC', ksfo)).toMatchObject({
      exitElement: 'V6',
      exitFix: 'SAC',
    });
  });

  it('strips a stale procedure version the same way', () => {
    const parsed = parseFiledRoute('WESLA4 SUSEY EBAYE', ksfo);
    expect(parsed).toMatchObject({ filedSidToken: 'WESLA4', exitFix: 'SUSEY' });
  });

  it('skips the airport navaid filed between the procedure and the exit fix', () => {
    expect(parseFiledRoute('WESLA5 SFO SUSEY EBAYE', ksfo)).toEqual({
      filedSidToken: 'WESLA5',
      exitElement: 'SUSEY',
      exitFix: 'SUSEY',
      tokens: ['SUSEY', 'EBAYE'],
    });
  });

  it('tolerates extra whitespace', () => {
    expect(parseFiledRoute('  TRUKN2   DEDHD  ', ksfo)).toMatchObject({ exitFix: 'DEDHD' });
  });

  it('blocks the route element when the procedure is all that was filed', () => {
    expect(parseFiledRoute('TRUKN2', ksfo)).toEqual({
      element: 'R.route',
      reason: expect.stringContaining('no fix after the procedure'),
    });
  });

  it('blocks the route element on an empty route', () => {
    expect(parseFiledRoute('   ', ksfo)).toMatchObject({ element: 'R.route' });
  });

  it('blocks the route element when an airway is filed with no fix after it', () => {
    expect(parseFiledRoute('TRUKN2 J501', ksfo)).toEqual({
      element: 'R.route',
      reason: expect.stringContaining('J501'),
    });
  });
});

describe('parseFiledRoute past the departure structure', () => {
  it('drops a base fix the SID flies over when the route files a transition of that SID', () => {
    expect(parseFiledRoute('PORTE8 PORTE SUSEY EBAYE BURGL', ksfo)).toEqual({
      filedSidToken: 'PORTE8',
      droppedStructureTokens: ['PORTE'],
      exitElement: 'SUSEY',
      exitFix: 'SUSEY',
      tokens: ['SUSEY', 'EBAYE', 'BURGL'],
    });
  });

  it('drops a procedure name and its base fix filed as plain route elements', () => {
    expect(parseFiledRoute('CNDEL PORTE SUSEY EBAYE BURGL', koak)).toEqual({
      droppedStructureTokens: ['CNDEL', 'PORTE'],
      exitElement: 'SUSEY',
      exitFix: 'SUSEY',
      tokens: ['SUSEY', 'EBAYE', 'BURGL'],
    });
  });

  it('keeps a base fix the route files no transition of that SID after', () => {
    expect(parseFiledRoute('TRUKN2 TRUKN CCR CCR2', ksfo)).toEqual({
      filedSidToken: 'TRUKN2',
      exitElement: 'TRUKN',
      exitFix: 'TRUKN',
      tokens: ['TRUKN', 'CCR', 'CCR2'],
    });
  });

  it('keeps the base fix of a SID that publishes no transitions at all', () => {
    expect(parseFiledRoute('SUNNE1 SUNNE KAYEX LOSHN PMD V137 PSP', koak)).toEqual({
      filedSidToken: 'SUNNE1',
      exitElement: 'SUNNE',
      exitFix: 'SUNNE',
      tokens: ['SUNNE', 'KAYEX', 'LOSHN', 'PMD', 'V137', 'PSP'],
    });
  });

  it('keeps a fix the SID flies over when what follows is no transition of it', () => {
    expect(parseFiledRoute('COAST9 MCKEY LAX COMIX2', koak)).toEqual({
      filedSidToken: 'COAST9',
      exitElement: 'MCKEY',
      exitFix: 'MCKEY',
      tokens: ['MCKEY', 'LAX', 'COMIX2'],
    });
  });
});

describe('rnavElements', () => {
  it.each([
    ['SFO4 OAK V6 SAC', []],
    ['TRUKN2 DEDHD RBL LMT HAWKZ7', []],
    ['TRUKN2 TRUKN CCR', []],
    ['DEDHD RBL LMT HAWKZ7', ['DEDHD']],
    ['MOGEE Q174 FLCHR', ['MOGEE', 'Q174', 'FLCHR']],
  ] as const)('reads %s as needing %s', (filedRoute, expected) => {
    expect(rnavElements(plan(filedRoute), ksfo).map((element) => element.token)).toEqual(expected);
  });

  it('says what each element is and what it takes to fly', () => {
    expect(rnavElements(plan('DEDHD T257 RBL'), ksfo)).toEqual([
      { token: 'DEDHD', needs: 'rnav', kind: 'waypoint' },
      { token: 'T257', needs: 'gnss', kind: 'airway' },
    ]);
  });

  it('names a fix filed twice once', () => {
    expect(rnavElements(plan('DEDHD RBL DEDHD'), ksfo).map((element) => element.token)).toEqual([
      'DEDHD',
    ]);
  });
});

describe('directionOf', () => {
  it.each([
    ['DEDHD', 'north'],
    ['SUSEY', 'south'],
    ['BEBOP', 'oceanic'],
  ] as const)('places %s in the %s gate', (fix, direction) => {
    expect(directionOf(fix, ksfo.gates)).toBe(direction);
  });

  it('returns undefined for a fix that is not a gate', () => {
    expect(directionOf('HAWKZ', ksfo.gates)).toBeUndefined();
  });
});
