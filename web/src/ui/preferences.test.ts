import { describe, expect, it } from 'vitest';
import type { ScenarioFilter } from '@/scenario/filter.ts';
import { ANY_SCENARIO } from '@/scenario/filter.ts';
import { createFilterStore } from '@/ui/preferences.ts';

const filter: ScenarioFilter = { time: 'night', config: { kind: 'id', id: '28/01' } };

/** A storage backed by a Map, which is how the browser's behaves when nothing goes wrong. */
function mapStorage(entries = new Map<string, string>()): Pick<Storage, 'getItem' | 'setItem'> {
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

describe('createFilterStore', () => {
  it('loads back the filter it saved for the same airport', () => {
    const store = createFilterStore(mapStorage());
    store.save('KSFO', filter);
    expect(store.load('KSFO')).toStrictEqual(filter);
  });

  it('remembers each member of the filter as it was saved', () => {
    const store = createFilterStore(mapStorage());
    for (const saved of [
      ANY_SCENARIO,
      { time: 'day', config: { kind: 'any' } },
      { time: 'either', config: { kind: 'plan', plan: 'SFOE' } },
    ] satisfies ScenarioFilter[]) {
      store.save('KSFO', saved);
      expect(store.load('KSFO')).toStrictEqual(saved);
    }
  });

  it('leaves a forced destination out of what it stores', () => {
    const entries = new Map<string, string>();
    const store = createFilterStore(mapStorage(entries));
    store.save('KSFO', { ...filter, destination: 'KLVK' });
    expect(JSON.parse(entries.get('craft-tester:filter:KSFO') ?? 'null')).toStrictEqual(filter);
    expect(store.load('KSFO')).toStrictEqual(filter);
  });

  it('remembers nothing about an airport nobody has filtered', () => {
    const store = createFilterStore(mapStorage());
    store.save('KSFO', filter);
    expect(store.load('KOAK')).toBeUndefined();
  });

  it('survives a storage that refuses both operations', () => {
    const store = createFilterStore({
      getItem: () => {
        throw new Error('reads denied');
      },
      setItem: () => {
        throw new Error('quota exceeded');
      },
    });
    expect(() => {
      store.save('KSFO', filter);
    }).not.toThrow();
    expect(store.load('KSFO')).toBeUndefined();
  });

  it('ignores a stored value that is not the JSON of a filter', () => {
    const entries = new Map<string, string>([
      ['craft-tester:filter:KSFO', '{not json'],
      ['craft-tester:filter:KOAK', '"a string"'],
      ['craft-tester:filter:KSJC', 'null'],
    ]);
    const store = createFilterStore(mapStorage(entries));
    expect(store.load('KSFO')).toBeUndefined();
    expect(store.load('KOAK')).toBeUndefined();
    expect(store.load('KSJC')).toBeUndefined();
  });

  it('ignores a filter whose members this app does not know', () => {
    const entries = new Map<string, string>([
      ['craft-tester:filter:KSFO', JSON.stringify({ time: 'dusk', config: { kind: 'any' } })],
      ['craft-tester:filter:KOAK', JSON.stringify({ time: 'day', config: { kind: 'runway' } })],
      ['craft-tester:filter:KSJC', JSON.stringify({ time: 'day' })],
      ['craft-tester:filter:KHWD', JSON.stringify({ ...filter, mode: 'clearance' })],
    ]);
    const store = createFilterStore(mapStorage(entries));
    expect(store.load('KSFO')).toBeUndefined();
    expect(store.load('KOAK')).toBeUndefined();
    expect(store.load('KSJC')).toBeUndefined();
    expect(store.load('KHWD')).toBeUndefined();
  });

  it('remembers nothing at all without a storage', () => {
    const store = createFilterStore(undefined);
    expect(() => {
      store.save('KSFO', filter);
    }).not.toThrow();
    expect(store.load('KSFO')).toBeUndefined();
  });
});
