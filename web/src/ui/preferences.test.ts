import { describe, expect, it } from 'vitest';
import type { ScenarioFilter } from '@/scenario/filter.ts';
import { ANY_SCENARIO } from '@/scenario/filter.ts';
import type { HomeChoices } from '@/ui/preferences.ts';
import {
  createFilterStore,
  createFullRouteStore,
  createHomeStore,
  createInputKindStore,
  createRunwayGradingStore,
  createTourProgressStore,
  createTourSeenStore,
} from '@/ui/preferences.ts';

const filter: ScenarioFilter = { time: 'night', config: { kind: 'id', id: '28/01' } };

/** A storage backed by a Map, which is how the browser's behaves when nothing goes wrong. */
function mapStorage(
  entries = new Map<string, string>(),
): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

/** A storage that refuses every operation, as a browser with storage blocked does. */
function refusingStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  return {
    getItem: () => {
      throw new Error('reads denied');
    },
    setItem: () => {
      throw new Error('quota exceeded');
    },
    removeItem: () => {
      throw new Error('writes denied');
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

describe('createInputKindStore', () => {
  it('loads back each input kind it saved, under one key for the whole browser', () => {
    const entries = new Map<string, string>();
    const store = createInputKindStore(mapStorage(entries));
    expect(store.load()).toBeUndefined();
    store.save('text');
    expect(store.load()).toBe('text');
    expect(entries.get('craft-tester:input')).toBe('"text"');
    store.save('dropdowns');
    expect(store.load()).toBe('dropdowns');
    expect([...entries.keys()]).toStrictEqual(['craft-tester:input']);
  });

  it('ignores a stored input kind this app does not know', () => {
    const entries = new Map([['craft-tester:input', '"bogus"']]);
    expect(createInputKindStore(mapStorage(entries)).load()).toBeUndefined();
  });

  it('ignores a stored value that is not JSON', () => {
    const entries = new Map([['craft-tester:input', '{not json']]);
    expect(createInputKindStore(mapStorage(entries)).load()).toBeUndefined();
  });

  it('survives a storage that refuses both operations', () => {
    const store = createInputKindStore({
      getItem: () => {
        throw new Error('reads denied');
      },
      setItem: () => {
        throw new Error('quota exceeded');
      },
    });
    expect(() => {
      store.save('text');
    }).not.toThrow();
    expect(store.load()).toBeUndefined();
  });

  it('remembers nothing at all without a storage', () => {
    const store = createInputKindStore(undefined);
    expect(() => {
      store.save('text');
    }).not.toThrow();
    expect(store.load()).toBeUndefined();
  });
});

describe('createFullRouteStore', () => {
  it('remembers the full route choice', () => {
    const entries = new Map<string, string>();
    const store = createFullRouteStore(mapStorage(entries));
    expect(store.load()).toBeUndefined();
    store.save(true);
    expect(store.load()).toBe(true);
    expect(entries.get('craft-tester:full-route')).toBe('true');
    store.save(false);
    expect(store.load()).toBe(false);
    expect([...entries.keys()]).toStrictEqual(['craft-tester:full-route']);
  });

  it('reads a malformed full route value as nothing remembered', () => {
    for (const raw of ['"true"', '1', '{not json', 'null']) {
      const entries = new Map([['craft-tester:full-route', raw]]);
      expect(createFullRouteStore(mapStorage(entries)).load()).toBeUndefined();
    }
    const refused = createFullRouteStore({
      getItem: () => {
        throw new Error('reads denied');
      },
      setItem: () => {
        throw new Error('quota exceeded');
      },
    });
    expect(() => {
      refused.save(true);
    }).not.toThrow();
    expect(refused.load()).toBeUndefined();
    const none = createFullRouteStore(undefined);
    expect(() => {
      none.save(true);
    }).not.toThrow();
    expect(none.load()).toBeUndefined();
  });
});

describe('createRunwayGradingStore', () => {
  it('remembers whether the runway is graded', () => {
    const entries = new Map<string, string>();
    const store = createRunwayGradingStore(mapStorage(entries));
    expect(store.load()).toBeUndefined();
    store.save(false);
    expect(store.load()).toBe(false);
    expect(entries.get('craft-tester:runway-grading')).toBe('false');
    store.save(true);
    expect(store.load()).toBe(true);
    expect([...entries.keys()]).toStrictEqual(['craft-tester:runway-grading']);
  });

  it('reads a malformed or unreachable value as nothing remembered', () => {
    for (const raw of ['"false"', '0', '{not json', 'null']) {
      const entries = new Map([['craft-tester:runway-grading', raw]]);
      expect(createRunwayGradingStore(mapStorage(entries)).load()).toBeUndefined();
    }
    const refused = createRunwayGradingStore(refusingStorage());
    expect(() => {
      refused.save(false);
    }).not.toThrow();
    expect(refused.load()).toBeUndefined();
    const none = createRunwayGradingStore(undefined);
    expect(() => {
      none.save(false);
    }).not.toThrow();
    expect(none.load()).toBeUndefined();
  });
});

describe('createTourSeenStore', () => {
  it('remembers that the tour was seen, under one key for the whole browser', () => {
    const entries = new Map<string, string>();
    const store = createTourSeenStore(mapStorage(entries));
    expect(store.load()).toBeUndefined();
    store.save(true);
    expect(store.load()).toBe(true);
    expect([...entries]).toStrictEqual([['craft-tester:tour-seen', 'true']]);
  });

  it('reads a malformed value as nothing remembered', () => {
    for (const raw of ['"true"', '1', '{not json', 'null']) {
      const entries = new Map([['craft-tester:tour-seen', raw]]);
      expect(createTourSeenStore(mapStorage(entries)).load()).toBeUndefined();
    }
  });

  it('survives a storage that refuses both operations, and no storage at all', () => {
    for (const store of [createTourSeenStore(refusingStorage()), createTourSeenStore(undefined)]) {
      expect(() => {
        store.save(true);
      }).not.toThrow();
      expect(store.load()).toBeUndefined();
    }
  });
});

describe('createTourProgressStore', () => {
  const progress = { version: 3, part: 'amend', step: 4 } as const;

  it('loads back the progress it saved, under one key, and forgets it once cleared', () => {
    const entries = new Map<string, string>();
    const store = createTourProgressStore(mapStorage(entries));
    expect(store.load()).toBeUndefined();
    store.save(progress);
    expect(store.load()).toStrictEqual(progress);
    expect([...entries.keys()]).toStrictEqual(['craft-tester:tour-progress']);
    store.clear();
    expect(store.load()).toBeUndefined();
    expect(entries.size).toBe(0);
  });

  it('reads garbage as no progress', () => {
    for (const raw of [
      '{not json',
      'null',
      '"amend"',
      JSON.stringify({ ...progress, part: 'home' }),
      JSON.stringify({ ...progress, step: -1 }),
      JSON.stringify({ ...progress, step: 1.5 }),
      JSON.stringify({ part: 'clearance', step: 2 }),
      JSON.stringify({ ...progress, extra: true }),
    ]) {
      const entries = new Map([['craft-tester:tour-progress', raw]]);
      expect(createTourProgressStore(mapStorage(entries)).load()).toBeUndefined();
    }
  });

  it('survives a storage that refuses every operation, and no storage at all', () => {
    for (const store of [
      createTourProgressStore(refusingStorage()),
      createTourProgressStore(undefined),
    ]) {
      expect(() => {
        store.save(progress);
        store.clear();
      }).not.toThrow();
      expect(store.load()).toBeUndefined();
    }
  });
});

describe('createHomeStore', () => {
  const choices: HomeChoices = {
    icao: 'KOAK',
    mode: 'amendment',
    format: 'test',
    n: 10,
    minutes: 20,
  };

  it('loads back the choices it saved, under one key for the whole browser', () => {
    const entries = new Map<string, string>();
    const store = createHomeStore(mapStorage(entries));
    store.save(choices);
    expect(store.load()).toStrictEqual(choices);
    expect([...entries.keys()]).toStrictEqual(['craft-tester:home']);
  });

  it('remembers nothing before anything is saved', () => {
    expect(createHomeStore(mapStorage()).load()).toBeUndefined();
  });

  it('ignores choices with a test of no strips', () => {
    const entries = new Map([['craft-tester:home', JSON.stringify({ ...choices, n: 0 })]]);
    expect(createHomeStore(mapStorage(entries)).load()).toBeUndefined();
  });

  it('ignores choices with a member this app does not know', () => {
    const entries = new Map([['craft-tester:home', JSON.stringify({ ...choices, input: 'text' })]]);
    expect(createHomeStore(mapStorage(entries)).load()).toBeUndefined();
  });

  it('survives a storage that refuses both operations', () => {
    const store = createHomeStore({
      getItem: () => {
        throw new Error('reads denied');
      },
      setItem: () => {
        throw new Error('quota exceeded');
      },
    });
    expect(() => {
      store.save(choices);
    }).not.toThrow();
    expect(store.load()).toBeUndefined();
  });
});
