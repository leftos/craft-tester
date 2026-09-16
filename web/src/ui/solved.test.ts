import { describe, expect, it } from 'vitest';
import type { BoxAnswers } from '@/rules/amend/grade.ts';
import type { PlayerPicks } from '@/rules/types.ts';
import type { Attempt } from '@/ui/solved.ts';
import { createSolvedStore } from '@/ui/solved.ts';
import type { AmendmentPicks } from '@/ui/state.ts';

const picks: PlayerPicks = {
  routeTemplate: 'transition',
  routeFix: 'DEDHD',
  altitudePhrase: 'maintain',
  altitudeFeet: 10_000,
  expect: 'ten_minutes',
  frequency: '120.9',
  runway: '01R',
};

const clearance: Attempt = { kind: 'clearance', picks };

const boxes: BoxAnswers = {
  type: { kind: 'as_filed' },
  altitude: { kind: 'amended', value: 'FL270' },
  route: { kind: 'as_filed' },
};

const amendmentPicks: AmendmentPicks = { ...picks, procedure: 'TRUKN2' };

const amendment: Attempt = { kind: 'amendment', boxes, picks: amendmentPicks };

/** A storage backed by a Map, which is how the browser's behaves when nothing goes wrong. */
function mapStorage(entries = new Map<string, string>()): Pick<Storage, 'getItem' | 'setItem'> {
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

describe('createSolvedStore', () => {
  it('loads back the clearance it saved for the same airport and seed', () => {
    const store = createSolvedStore(mapStorage());
    store.save('KSFO', 42, clearance);
    expect(store.load('KSFO', 42, 'clearance')).toStrictEqual(clearance);
  });

  it('loads back the amendment it saved, boxes and all', () => {
    const store = createSolvedStore(mapStorage());
    store.save('KSFO', 42, amendment);
    expect(store.load('KSFO', 42, 'amendment')).toStrictEqual(amendment);
  });

  it('remembers nothing about a seed nobody has solved', () => {
    const store = createSolvedStore(mapStorage());
    store.save('KSFO', 42, clearance);
    expect(store.load('KSFO', 43, 'clearance')).toBeUndefined();
    expect(store.load('KOAK', 42, 'clearance')).toBeUndefined();
  });

  it('keeps the two modes apart, seed for seed', () => {
    const store = createSolvedStore(mapStorage());
    store.save('KSFO', 42, clearance);
    expect(store.load('KSFO', 42, 'amendment')).toBeUndefined();
    store.save('KSFO', 7, amendment);
    expect(store.load('KSFO', 7, 'clearance')).toBeUndefined();
    expect(store.load('KSFO', 42, 'clearance')).toStrictEqual(clearance);
    expect(store.load('KSFO', 7, 'amendment')).toStrictEqual(amendment);
  });

  it('writes each mode under its own key', () => {
    const entries = new Map<string, string>();
    const store = createSolvedStore(mapStorage(entries));
    store.save('KSFO', 42, clearance);
    store.save('KSFO', 42, amendment);
    expect([...entries.keys()]).toStrictEqual([
      'craft-tester:solved:KSFO:42',
      'craft-tester:solved:KSFO:amend:42',
    ]);
  });

  it('loads a clearance a browser stored before the trainer had a second mode', () => {
    const entries = new Map<string, string>([
      ['craft-tester:solved:KSFO:42', JSON.stringify(picks)],
    ]);
    expect(createSolvedStore(mapStorage(entries)).load('KSFO', 42, 'clearance')).toStrictEqual(
      clearance,
    );
  });

  it('survives a storage that refuses both operations', () => {
    const store = createSolvedStore({
      getItem: () => {
        throw new Error('reads denied');
      },
      setItem: () => {
        throw new Error('quota exceeded');
      },
    });
    expect(() => {
      store.save('KSFO', 42, clearance);
    }).not.toThrow();
    expect(store.load('KSFO', 42, 'clearance')).toBeUndefined();
  });

  it('ignores a stored value that is not the JSON of an object', () => {
    const entries = new Map<string, string>([
      ['craft-tester:solved:KSFO:42', '{not json'],
      ['craft-tester:solved:KSFO:43', '"a string"'],
      ['craft-tester:solved:KSFO:44', 'null'],
      ['craft-tester:solved:KSFO:amend:42', '{not json'],
    ]);
    const store = createSolvedStore(mapStorage(entries));
    expect(store.load('KSFO', 42, 'clearance')).toBeUndefined();
    expect(store.load('KSFO', 43, 'clearance')).toBeUndefined();
    expect(store.load('KSFO', 44, 'clearance')).toBeUndefined();
    expect(store.load('KSFO', 42, 'amendment')).toBeUndefined();
  });

  it('ignores an attempt an older form stored without the runway pick', () => {
    const { runway: _runway, ...withoutRunway } = picks;
    const entries = new Map<string, string>([
      ['craft-tester:solved:KSFO:42', JSON.stringify(withoutRunway)],
    ]);
    expect(createSolvedStore(mapStorage(entries)).load('KSFO', 42, 'clearance')).toBeUndefined();
  });

  it('ignores an attempt an older form stored with a pick the form has dropped', () => {
    const entries = new Map<string, string>([
      ['craft-tester:solved:KSFO:42', JSON.stringify({ ...picks, clearedTo: 'KLAX' })],
      ['craft-tester:solved:KSFO:43', JSON.stringify({ ...picks, sidId: 'TRUKN2' })],
    ]);
    const store = createSolvedStore(mapStorage(entries));
    expect(store.load('KSFO', 42, 'clearance')).toBeUndefined();
    expect(store.load('KSFO', 43, 'clearance')).toBeUndefined();
  });

  it('ignores an amendment stored without the procedure the form picked', () => {
    const entries = new Map<string, string>([
      ['craft-tester:solved:KSFO:amend:42', JSON.stringify({ boxes, picks })],
    ]);
    expect(createSolvedStore(mapStorage(entries)).load('KSFO', 42, 'amendment')).toBeUndefined();
  });

  it('ignores an amendment whose boxes are not the three of the strip', () => {
    const { route: _route, ...withoutRoute } = boxes;
    const entries = new Map<string, string>([
      [
        'craft-tester:solved:KSFO:amend:42',
        JSON.stringify({ boxes: withoutRoute, picks: amendmentPicks }),
      ],
      [
        'craft-tester:solved:KSFO:amend:43',
        JSON.stringify({ boxes: { ...boxes, route: { kind: 'erased' } }, picks: amendmentPicks }),
      ],
    ]);
    const store = createSolvedStore(mapStorage(entries));
    expect(store.load('KSFO', 42, 'amendment')).toBeUndefined();
    expect(store.load('KSFO', 43, 'amendment')).toBeUndefined();
  });

  it('remembers nothing at all without a storage', () => {
    const store = createSolvedStore(undefined);
    expect(() => {
      store.save('KSFO', 42, clearance);
    }).not.toThrow();
    expect(store.load('KSFO', 42, 'clearance')).toBeUndefined();
  });
});
