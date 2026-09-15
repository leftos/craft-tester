import { describe, expect, it } from 'vitest';
import type { PlayerPicks } from '@/rules/types.ts';
import { createSolvedStore } from '@/ui/solved.ts';

const picks: PlayerPicks = {
  clearedTo: 'KLAX',
  sidId: 'TRUKN2',
  routeTemplate: 'transition',
  routeFix: 'DEDHD',
  altitudePhrase: 'maintain',
  altitudeFeet: 10_000,
  expect: 'ten_minutes',
  frequency: '120.9',
};

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
  it('loads back the picks it saved for the same airport and seed', () => {
    const store = createSolvedStore(mapStorage());
    store.save('KSFO', 42, picks);
    expect(store.load('KSFO', 42)).toStrictEqual(picks);
  });

  it('remembers nothing about a seed nobody has solved', () => {
    const store = createSolvedStore(mapStorage());
    store.save('KSFO', 42, picks);
    expect(store.load('KSFO', 43)).toBeUndefined();
    expect(store.load('KOAK', 42)).toBeUndefined();
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
      store.save('KSFO', 42, picks);
    }).not.toThrow();
    expect(store.load('KSFO', 42)).toBeUndefined();
  });

  it('ignores a stored value that is not the JSON of an object', () => {
    const entries = new Map<string, string>([
      ['craft-tester:solved:KSFO:42', '{not json'],
      ['craft-tester:solved:KSFO:43', '"a string"'],
      ['craft-tester:solved:KSFO:44', 'null'],
    ]);
    const store = createSolvedStore(mapStorage(entries));
    expect(store.load('KSFO', 42)).toBeUndefined();
    expect(store.load('KSFO', 43)).toBeUndefined();
    expect(store.load('KSFO', 44)).toBeUndefined();
  });

  it('remembers nothing at all without a storage', () => {
    const store = createSolvedStore(undefined);
    expect(() => {
      store.save('KSFO', 42, picks);
    }).not.toThrow();
    expect(store.load('KSFO', 42)).toBeUndefined();
  });
});
