import { describe, expect, it } from 'vitest';
import ksfoJson from '@data/ksfo.json';
import type { AirportData } from '@/data/schema.ts';
import {
  directionOf,
  isAirwayToken,
  isSidToken,
  parseFiledRoute,
  routeFromExitFix,
} from '@/rules/route.ts';

const ksfo = ksfoJson as unknown as AirportData;

describe('isSidToken', () => {
  it.each([
    ['TRUKN2', true],
    ['SFO5', true],
    ['GAPP7', true],
    ['TRUKN', false],
    ['J501', false],
    ['V244', false],
    ['Q158', false],
    ['T257', false],
  ])('classifies %s', (token, expected) => {
    expect(isSidToken(token)).toBe(expected);
  });
});

describe('isAirwayToken', () => {
  it.each([
    ['V6', true],
    ['J501', true],
    ['Q158', true],
    ['T257', true],
    ['SAC', false],
    ['DEDHD', false],
    ['TRUKN2', false],
  ])('classifies %s', (token, expected) => {
    expect(isAirwayToken(token)).toBe(expected);
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
