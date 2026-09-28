import { describe, expect, it } from 'vitest';
import type { Grade, Verdict } from '@/rules/types.ts';
import type { Mode, SessionSettings } from '@/scenario/filter.ts';
import { ANY_SCENARIO, hashFor, setFromHash } from '@/scenario/filter.ts';
import { seedFromString } from '@/scenario/rng.ts';
import { buildScenario, loadAirportData } from '@/ui/session.ts';
import type { Attempt } from '@/ui/solved.ts';
import type { SetState } from '@/ui/state.ts';
import { newSession } from '@/ui/state.ts';
import type { SetRecord } from '@/ui/testSet.ts';
import {
  clockReading,
  createSetStore,
  endedSet,
  formatClock,
  isTimeUp,
  nextOpenIndex,
  openedSet,
  setSummary,
  setTotals,
  squareOf,
  stripResult,
  stripSeed,
  timeUsed,
  withStripAnswered,
  withStripSkipped,
} from '@/ui/testSet.ts';

const MINUTE = 60_000;
const START = 1_000_000;

/** The attempt a strip is answered with where only its being answered counts. */
const ATTEMPT: Attempt = { kind: 'clearance', input: 'text', text: 'as filed' };

/** A set of `n` strips on its first, started at `START`, timed or not. */
function aSet(n: number, minutes: number, overrides: Partial<SetState> = {}): SetState {
  return {
    seed: 42,
    n,
    minutes,
    index: 0,
    startedAt: START,
    answered: [],
    skipped: [],
    attempts: {},
    ended: false,
    endedAt: undefined,
    ...overrides,
  };
}

/** One verdict on the runway, which is all a total needs. */
function verdict(value: Verdict): Grade {
  return { element: 'RWY', verdict: value, expectedLabel: '', actualLabel: '', citations: [] };
}

const SETTINGS: SessionSettings = {
  filter: ANY_SCENARIO,
  mode: 'clearance',
  input: 'dropdowns',
  fullRoute: false,
};

describe('stripSeed', () => {
  it('derives each strip from the set seed and its index', () => {
    expect(stripSeed(42, 3, () => true)).toEqual({
      seed: seedFromString('42:3'),
      resolved: true,
    });
  });

  it('draws again from :r1, :r2 where the strip seed does not resolve', () => {
    const refused = new Set([seedFromString('42:3'), seedFromString('42:3:r1')]);
    const drawn = stripSeed(42, 3, (seed) => !refused.has(seed));
    expect(drawn).toEqual({ seed: seedFromString('42:3:r2'), resolved: true });
    expect(stripSeed(42, 3, (seed) => !refused.has(seed))).toEqual(drawn);
  });

  it('gives up unresolved after 20 tries', () => {
    let tries = 0;
    const drawn = stripSeed(42, 0, () => {
      tries += 1;
      return false;
    });
    expect(tries).toBe(20);
    expect(drawn).toEqual({ seed: seedFromString('42:0:r19'), resolved: false });
  });
});

describe('the x= part of the hash', () => {
  const set = { seed: 123_456_789, n: 10, minutes: 20, index: 4 };

  it('round-trips through hashFor', () => {
    const hash = hashFor('KSFO', 7, { ...SETTINGS, set });
    expect(hash).toBe(`#s=7&a=KSFO&x=${(123_456_789).toString(36)}.10.20.4`);
    expect(setFromHash(hash)).toEqual(set);
  });

  it('reads an untimed set, a count off the menu, and the summary index', () => {
    expect(setFromHash('#s=1&x=a.7.0.7')).toEqual({ seed: 10, n: 7, minutes: 0, index: 7 });
  });

  it.each([
    ['no x= part', '#s=1&a=KSFO'],
    ['three pieces', '#x=a.10.20'],
    ['five pieces', '#x=a.10.20.1.1'],
    ['a count of zero', '#x=a.0.20.0'],
    ['a count over 50', '#x=a.51.20.0'],
    ['minutes over 180', '#x=a.10.181.0'],
    ['an index past the count', '#x=a.10.20.11'],
    ['a seed that is not base 36', '#x=A!.10.20.0'],
    ['a seed past 32 bits', '#x=zzzzzzz.10.20.0'],
    ['a negative index', '#x=a.10.20.-1'],
    ['an empty piece', '#x=a..20.0'],
  ])('reads %s as no set', (_, hash) => {
    expect(setFromHash(hash)).toBeUndefined();
  });
});

describe('the set store', () => {
  const record: SetRecord = {
    startedAt: START,
    minutes: 20,
    n: 10,
    icao: 'KSFO',
    mode: 'amendment',
    input: 'text',
    fullRoute: true,
    filter: { time: 'night', config: { kind: 'plan', plan: 'West' }, destination: 'KLAX' },
    answered: [0, 2],
    skipped: [1],
    ended: false,
    endedAt: undefined,
  };

  it('round-trips a record under the set seed in base 36', () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, value),
    };
    const store = createSetStore(storage);
    store.save(42, record);
    expect([...map.keys()]).toEqual(['craft-tester:set:16']);
    expect(store.load(42)).toEqual(record);
    expect(store.load(43)).toBeUndefined();
  });

  it('reads corrupted JSON and a record of another shape as nothing', () => {
    const values: Record<string, string> = {
      'craft-tester:set:1': '{not json',
      'craft-tester:set:2': JSON.stringify({ ...record, n: 'ten' }),
    };
    const store = createSetStore({ getItem: (key) => values[key] ?? null, setItem: () => {} });
    expect(store.load(1)).toBeUndefined();
    expect(store.load(2)).toBeUndefined();
  });

  it('survives a storage that throws, and one that is missing', () => {
    const throwing = {
      getItem: (): string | null => {
        throw new Error('denied');
      },
      setItem: (): void => {
        throw new Error('quota');
      },
    };
    for (const store of [createSetStore(throwing), createSetStore(undefined)]) {
      expect(() => store.save(1, record)).not.toThrow();
      expect(store.load(1)).toBeUndefined();
    }
  });
});

describe('the clock', () => {
  it('counts a timed set down, rounding up to the second', () => {
    const set = aSet(10, 20);
    expect(clockReading(set, START)).toEqual({ text: '20:00', label: 'Time left' });
    expect(clockReading(set, START + 7 * MINUTE + 18_500)).toEqual({
      text: '12:42',
      label: 'Time left',
    });
    expect(isTimeUp(set, START + 20 * MINUTE - 1)).toBe(false);
  });

  it('reads 00:00 and time up at the limit and after it', () => {
    const set = aSet(10, 10);
    expect(isTimeUp(set, START + 10 * MINUTE)).toBe(true);
    expect(clockReading(set, START + 11 * MINUTE).text).toBe('00:00');
    expect(timeUsed(set, START + 11 * MINUTE)).toBe(10 * MINUTE);
  });

  it('counts an untimed set up and never runs out', () => {
    const set = aSet(5, 0);
    expect(clockReading(set, START + 65_900)).toEqual({ text: '01:05', label: 'Time used' });
    expect(isTimeUp(set, START + 1000 * MINUTE)).toBe(false);
  });

  it('stops the time used where the set ended', () => {
    const ended = endedSet(aSet(5, 0), START + 3 * MINUTE);
    expect(timeUsed(ended, START + 9 * MINUTE)).toBe(3 * MINUTE);
    expect(endedSet(aSet(5, 10), START + 20 * MINUTE).endedAt).toBe(START + 10 * MINUTE);
  });

  it('writes minutes past an hour whole', () => {
    expect(formatClock(125 * MINUTE + 3000)).toBe('125:03');
  });
});

describe('moving through a set', () => {
  it('moves to the next strip not yet reached', () => {
    const set = withStripAnswered(aSet(5, 20), START, ATTEMPT);
    expect(set.index).toBe(1);
    expect(set.answered).toEqual([0]);
  });

  it('passes skipped strips, then returns to the first skipped after the last', () => {
    let set = aSet(4, 20);
    set = withStripSkipped(set, START);
    set = withStripAnswered(set, START, ATTEMPT);
    set = withStripSkipped(set, START);
    expect(set.index).toBe(3);
    set = withStripAnswered(set, START, ATTEMPT);
    expect(set.index).toBe(0);
    expect(set.skipped).toEqual([0, 2]);
    set = withStripAnswered(set, START, ATTEMPT);
    expect(set.index).toBe(2);
    expect(set.skipped).toEqual([2]);
  });

  it('stays on the only strip left open when it is skipped', () => {
    const set = withStripSkipped(aSet(3, 20, { index: 1, answered: [0, 2] }), START);
    expect(set.index).toBe(1);
    expect(set.ended).toBe(false);
  });

  it('ends on the summary once no strip is left open', () => {
    const set = withStripAnswered(
      aSet(2, 20, { index: 1, answered: [0] }),
      START + MINUTE,
      ATTEMPT,
    );
    expect(set).toMatchObject({ index: 2, ended: true, endedAt: START + MINUTE });
  });

  it('reaches strips before the one on screen that were never opened', () => {
    expect(nextOpenIndex(aSet(4, 20, { index: 3, answered: [1, 2, 3] }))).toBe(0);
  });

  it('reads each square as done, now, skipped or open', () => {
    const set = aSet(4, 20, { index: 2, answered: [0], skipped: [1, 2] });
    expect([0, 1, 2, 3].map((index) => squareOf(set, index))).toEqual([
      'done',
      'skipped',
      'now',
      'open',
    ]);
  });
});

describe('opening a set from a link', () => {
  const settings: SessionSettings = { ...SETTINGS, input: 'text' };

  it('opens a summary index with no stored record as an ended set', async () => {
    const airport = await loadAirportData('KSFO');
    const state = newSession(airport, 1, undefined, settings);
    const opened = openedSet(state, { seed: 1, n: 10, minutes: 0, index: 10 }, undefined, START);
    expect(opened.set).toMatchObject({ index: 10, ended: true, endedAt: START });
  });

  it('a stale link to an answered strip resumes at the next open strip', async () => {
    const airport = await loadAirportData('KSFO');
    const state = newSession(airport, 1, undefined, settings);
    const record: SetRecord = {
      startedAt: START,
      minutes: 10,
      n: 5,
      icao: 'KSFO',
      mode: 'clearance',
      input: 'text',
      fullRoute: false,
      filter: ANY_SCENARIO,
      answered: [0, 1],
      skipped: [],
      ended: false,
      endedAt: undefined,
    };
    const params = { seed: 1, n: 10, minutes: 20, index: 1 };
    const opened = openedSet(state, params, record, START + MINUTE);
    expect(opened.set).toMatchObject({ n: 5, minutes: 10, index: 2, ended: false });
  });
});

describe('the summary totals', () => {
  it('reads a strip that could not be drawn as such and counts it in neither total', async () => {
    const airport = await loadAirportData('KSFO');
    const filter = { ...ANY_SCENARIO, destination: 'ZZZZ' };
    const state = newSession(airport, 1, undefined, { ...SETTINGS, filter });
    const set = endedSet(aSet(2, 20), START + MINUTE);
    const summary = setSummary(state, set, () => undefined, START + MINUTE);
    expect(summary.rows.map((row) => row.line)).toEqual([
      'Could not be drawn',
      'Could not be drawn',
    ]);
    expect(summary.n).toBe(0);
    expect(summary.totals).toEqual({ fullyCorrect: 0, percent: 0 });
  });

  it('counts fully correct strips and the percent of credit, half counting half', () => {
    const totals = setTotals([
      { grades: [verdict('correct'), verdict('acceptable')], count: 2 },
      { grades: [verdict('correct'), verdict('half')], count: 2 },
      { grades: [verdict('wrong'), verdict('correct')], count: 2 },
      { grades: undefined, count: 2 },
    ]);
    expect(totals).toEqual({ fullyCorrect: 1, percent: 56 });
  });

  it('reads an empty set as none correct and 0%', () => {
    expect(setTotals([])).toEqual({ fullyCorrect: 0, percent: 0 });
  });

  it('counts an unanswered strip by the elements an empty answer is graded on', async () => {
    const airport = await loadAirportData('KSFO');
    const seedIn = (mode: Mode): number =>
      stripSeed(
        42,
        0,
        (seed) => buildScenario(airport, seed, ANY_SCENARIO, mode).kind !== 'unresolved',
      ).seed;
    const seed = seedIn('clearance');
    const picked = stripResult(airport, seed, SETTINGS, undefined);
    expect(picked.grades).toBeUndefined();
    expect(picked.count).toBeGreaterThanOrEqual(5);
    const typed = stripResult(airport, seed, { ...SETTINGS, input: 'text' }, undefined);
    expect(typed.count).toBeGreaterThan(0);
    const amendment = { ...SETTINGS, mode: 'amendment' as const };
    const amended = stripResult(airport, seedIn('amendment'), amendment, undefined);
    expect(amended.count).toBe(3 + 1 + 5);
  });
});
