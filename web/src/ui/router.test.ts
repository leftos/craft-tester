import { describe, expect, it, vi } from 'vitest';
import type { PageRoute, Route } from '@/ui/router.ts';
import { hrefOf, newSetSeed, routeOf } from '@/ui/router.ts';

describe('routeOf', () => {
  it.each(['', '#', '#/', '/'])('reads %j as home', (hash) => {
    expect(routeOf(hash)).toEqual({ kind: 'home' });
  });

  it.each(['#s=1&a=KOAK', '#a=KOAK', '#x=1.2.3.4', 's=1&a=KOAK'])('reads %s as a strip', (hash) => {
    expect(routeOf(hash)).toEqual({ kind: 'strip' });
  });

  it.each<[string, Route]>([
    ['#/KOAK/clearance/practice', { kind: 'practice', icao: 'KOAK', mode: 'clearance', query: '' }],
    ['#/koak/clearance/practice', { kind: 'practice', icao: 'KOAK', mode: 'clearance', query: '' }],
    ['/KSFO/amend/practice', { kind: 'practice', icao: 'KSFO', mode: 'amendment', query: '' }],
    [
      '#/KSFO/amend/practice?t=night&i=text',
      { kind: 'practice', icao: 'KSFO', mode: 'amendment', query: 't=night&i=text' },
    ],
    [
      '#/KOAK/amend/test/10x20',
      { kind: 'newTest', icao: 'KOAK', mode: 'amendment', n: 10, minutes: 20, query: '' },
    ],
    [
      '#/KOAK/clearance/test/5x0?i=text',
      { kind: 'newTest', icao: 'KOAK', mode: 'clearance', n: 5, minutes: 0, query: 'i=text' },
    ],
    [
      '#/KOAK/amend/test/10X20',
      { kind: 'newTest', icao: 'KOAK', mode: 'amendment', n: 10, minutes: 20, query: '' },
    ],
    [
      '#/KOAK/amend/test/50x180',
      { kind: 'newTest', icao: 'KOAK', mode: 'amendment', n: 50, minutes: 180, query: '' },
    ],
    [
      '#/KOAK/amend/test/k3f9',
      {
        kind: 'continueTest',
        icao: 'KOAK',
        mode: 'amendment',
        setSeed: Number.parseInt('k3f9', 36),
      },
    ],
    [
      '#/KOAK/amend/test/K3F9',
      {
        kind: 'continueTest',
        icao: 'KOAK',
        mode: 'amendment',
        setSeed: Number.parseInt('k3f9', 36),
      },
    ],
    ['#/tutorial', { kind: 'tutorial', part: 'clearance' }],
    ['#/tutorial/amend', { kind: 'tutorial', part: 'amend' }],
  ])('reads %s', (hash, route) => {
    expect(routeOf(hash)).toEqual(route);
  });

  it.each([
    '#/KOAK/amend/test/0x20',
    '#/KOAK/amend/test/51x20',
    '#/KOAK/amend/test/10x181',
    '#/KOAK/amend/test/zzzzzzzz',
    '#/KOAK/amend/test/k-3',
    '#/KOAK',
    '#/KOAK/amend',
    '#/KOAK/amend/practice/',
    '#/KOA/amend/practice',
    '#/tutorial/x',
    '#/tutorial/amend/x',
    '#/KOAK/amend/test',
    '#/KOAK/amend/quiz',
    '#/KOAK/amendment/practice',
  ])('reads %s as home', (hash) => {
    expect(routeOf(hash)).toEqual({ kind: 'home' });
  });
});

describe('hrefOf', () => {
  it.each<[PageRoute, string]>([
    [{ kind: 'home' }, '#/'],
    [{ kind: 'practice', icao: 'KOAK', mode: 'clearance', query: '' }, '#/KOAK/clearance/practice'],
    [
      { kind: 'practice', icao: 'KSFO', mode: 'amendment', query: 't=night' },
      '#/KSFO/amend/practice?t=night',
    ],
    [
      { kind: 'newTest', icao: 'KOAK', mode: 'amendment', n: 10, minutes: 20, query: '' },
      '#/KOAK/amend/test/10x20',
    ],
    [
      {
        kind: 'continueTest',
        icao: 'KOAK',
        mode: 'clearance',
        setSeed: Number.parseInt('k3f9', 36),
      },
      '#/KOAK/clearance/test/k3f9',
    ],
    [{ kind: 'tutorial', part: 'clearance' }, '#/tutorial'],
    [{ kind: 'tutorial', part: 'amend' }, '#/tutorial/amend'],
  ])('writes %o as %s', (route, href) => {
    expect(hrefOf(route)).toBe(href);
  });

  it.each<PageRoute>([
    { kind: 'practice', icao: 'KOAK', mode: 'clearance', query: '' },
    { kind: 'practice', icao: 'KSFO', mode: 'amendment', query: 't=night&c=plan:SFOW&i=text' },
    { kind: 'newTest', icao: 'KOAK', mode: 'amendment', n: 10, minutes: 20, query: 'i=text' },
    { kind: 'newTest', icao: 'KSFO', mode: 'clearance', n: 5, minutes: 0, query: '' },
    { kind: 'continueTest', icao: 'KOAK', mode: 'amendment', setSeed: 123_456_789 },
    { kind: 'tutorial', part: 'clearance' },
    { kind: 'tutorial', part: 'amend' },
  ])('reads back %o', (route) => {
    expect(routeOf(hrefOf(route))).toEqual(route);
  });
});

describe('newSetSeed', () => {
  it('draws again while the seed reads as a new test spec', () => {
    const draw = vi
      .fn<() => number>()
      .mockReturnValueOnce(Number.parseInt('10x20', 36))
      .mockReturnValueOnce(12_345);
    expect(newSetSeed(draw)).toBe(12_345);
    expect(draw).toHaveBeenCalledTimes(2);
  });
});
