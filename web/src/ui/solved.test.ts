import { describe, expect, it } from 'vitest';
import type { BoxAnswers } from '@/rules/amend/grade.ts';
import type { PlayerPicks } from '@/rules/types.ts';
import type { InputKind, Mode } from '@/scenario/filter.ts';
import type { Attempt, SolvedScope } from '@/ui/solved.ts';
import { createSolvedStore } from '@/ui/solved.ts';
import type { AmendmentPicks } from '@/ui/state.ts';

/** The scope an attempt is remembered under: its mode, how it was answered, and the reading. */
function at(mode: Mode, input: InputKind, fullRoute: boolean): SolvedScope {
  return { mode, input, fullRoute };
}

const picks: PlayerPicks = {
  routeTemplate: 'transition',
  routeFix: 'DEDHD',
  altitudePhrase: 'maintain',
  altitudeFeet: 10_000,
  expect: 'ten_minutes',
  frequency: '120.9',
  runway: '01R',
};

const clearance: Attempt = { kind: 'clearance', input: 'dropdowns', picks };

const boxes: BoxAnswers = {
  type: { kind: 'as_filed' },
  altitude: { kind: 'amended', value: 'FL270' },
  route: { kind: 'as_filed' },
};

const amendmentPicks: AmendmentPicks = { ...picks, procedure: 'TRUKN2' };

const amendment: Attempt = {
  kind: 'amendment',
  boxes,
  input: 'dropdowns',
  picks: amendmentPicks,
};

const TYPED =
  'Cleared to Portland airport via the TRUKN2 departure, DEDHD transition, then as filed.';

const typedClearance: Attempt = { kind: 'clearance', input: 'text', text: TYPED };

const typedAmendment: Attempt = { kind: 'amendment', boxes, input: 'text', text: TYPED };

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
    store.save('KSFO', 42, clearance, false);
    expect(store.load('KSFO', 42, at('clearance', 'dropdowns', false))).toStrictEqual(clearance);
  });

  it('loads back a clearance whose expect pick is the five-minute distractor', () => {
    const store = createSolvedStore(mapStorage());
    const fiveMinutes: Attempt = {
      kind: 'clearance',
      input: 'dropdowns',
      picks: { ...picks, expect: 'five_minutes' },
    };
    store.save('KSFO', 42, fiveMinutes, false);
    expect(store.load('KSFO', 42, at('clearance', 'dropdowns', false))).toStrictEqual(fiveMinutes);
  });

  it('loads back the amendment it saved, boxes and all', () => {
    const store = createSolvedStore(mapStorage());
    store.save('KSFO', 42, amendment, false);
    expect(store.load('KSFO', 42, at('amendment', 'dropdowns', false))).toStrictEqual(amendment);
  });

  it('remembers nothing about a seed nobody has solved', () => {
    const store = createSolvedStore(mapStorage());
    store.save('KSFO', 42, clearance, false);
    expect(store.load('KSFO', 43, at('clearance', 'dropdowns', false))).toBeUndefined();
    expect(store.load('KOAK', 42, at('clearance', 'dropdowns', false))).toBeUndefined();
  });

  it('keeps the two modes apart, seed for seed', () => {
    const store = createSolvedStore(mapStorage());
    store.save('KSFO', 42, clearance, false);
    expect(store.load('KSFO', 42, at('amendment', 'dropdowns', false))).toBeUndefined();
    store.save('KSFO', 7, amendment, false);
    expect(store.load('KSFO', 7, at('clearance', 'dropdowns', false))).toBeUndefined();
    expect(store.load('KSFO', 42, at('clearance', 'dropdowns', false))).toStrictEqual(clearance);
    expect(store.load('KSFO', 7, at('amendment', 'dropdowns', false))).toStrictEqual(amendment);
  });

  it('writes each mode under its own key', () => {
    const entries = new Map<string, string>();
    const store = createSolvedStore(mapStorage(entries));
    store.save('KSFO', 42, clearance, false);
    store.save('KSFO', 42, amendment, false);
    expect([...entries.keys()]).toStrictEqual([
      'craft-tester:solved:KSFO:42',
      'craft-tester:solved:KSFO:amend:42',
    ]);
  });

  it('loads a clearance a browser stored before the trainer had a second mode', () => {
    const entries = new Map<string, string>([
      ['craft-tester:solved:KSFO:42', JSON.stringify(picks)],
    ]);
    expect(
      createSolvedStore(mapStorage(entries)).load('KSFO', 42, at('clearance', 'dropdowns', false)),
    ).toStrictEqual(clearance);
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
      store.save('KSFO', 42, clearance, false);
    }).not.toThrow();
    expect(store.load('KSFO', 42, at('clearance', 'dropdowns', false))).toBeUndefined();
  });

  it('ignores a stored value that is not the JSON of an object', () => {
    const entries = new Map<string, string>([
      ['craft-tester:solved:KSFO:42', '{not json'],
      ['craft-tester:solved:KSFO:43', '"a string"'],
      ['craft-tester:solved:KSFO:44', 'null'],
      ['craft-tester:solved:KSFO:amend:42', '{not json'],
    ]);
    const store = createSolvedStore(mapStorage(entries));
    expect(store.load('KSFO', 42, at('clearance', 'dropdowns', false))).toBeUndefined();
    expect(store.load('KSFO', 43, at('clearance', 'dropdowns', false))).toBeUndefined();
    expect(store.load('KSFO', 44, at('clearance', 'dropdowns', false))).toBeUndefined();
    expect(store.load('KSFO', 42, at('amendment', 'dropdowns', false))).toBeUndefined();
  });

  it('ignores an attempt an older form stored without the runway pick', () => {
    const { runway: _runway, ...withoutRunway } = picks;
    const entries = new Map<string, string>([
      ['craft-tester:solved:KSFO:42', JSON.stringify(withoutRunway)],
    ]);
    expect(
      createSolvedStore(mapStorage(entries)).load('KSFO', 42, at('clearance', 'dropdowns', false)),
    ).toBeUndefined();
  });

  it('ignores an attempt an older form stored with a pick the form has dropped', () => {
    const entries = new Map<string, string>([
      ['craft-tester:solved:KSFO:42', JSON.stringify({ ...picks, clearedTo: 'KLAX' })],
      ['craft-tester:solved:KSFO:43', JSON.stringify({ ...picks, sidId: 'TRUKN2' })],
    ]);
    const store = createSolvedStore(mapStorage(entries));
    expect(store.load('KSFO', 42, at('clearance', 'dropdowns', false))).toBeUndefined();
    expect(store.load('KSFO', 43, at('clearance', 'dropdowns', false))).toBeUndefined();
  });

  it('ignores an amendment stored without the procedure the form picked', () => {
    const entries = new Map<string, string>([
      ['craft-tester:solved:KSFO:amend:42', JSON.stringify({ boxes, picks })],
    ]);
    expect(
      createSolvedStore(mapStorage(entries)).load('KSFO', 42, at('amendment', 'dropdowns', false)),
    ).toBeUndefined();
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
    expect(store.load('KSFO', 42, at('amendment', 'dropdowns', false))).toBeUndefined();
    expect(store.load('KSFO', 43, at('amendment', 'dropdowns', false))).toBeUndefined();
  });

  it('remembers nothing at all without a storage', () => {
    const store = createSolvedStore(undefined);
    expect(() => {
      store.save('KSFO', 42, clearance, false);
    }).not.toThrow();
    expect(store.load('KSFO', 42, at('clearance', 'dropdowns', false))).toBeUndefined();
  });
});

describe('typed attempts in the solved store', () => {
  it('loads back a typed clearance exactly as it was typed', () => {
    const store = createSolvedStore(mapStorage());
    store.save('KSFO', 42, typedClearance, false);
    expect(store.load('KSFO', 42, at('clearance', 'text', false))).toStrictEqual(typedClearance);
  });

  it('loads back a typed amendment, boxes and all', () => {
    const store = createSolvedStore(mapStorage());
    store.save('KSFO', 42, typedAmendment, false);
    expect(store.load('KSFO', 42, at('amendment', 'text', false))).toStrictEqual(typedAmendment);
  });

  it('keeps a picked and a typed attempt at one seed and mode apart', () => {
    const store = createSolvedStore(mapStorage());
    store.save('KSFO', 42, clearance, false);
    expect(store.load('KSFO', 42, at('clearance', 'text', false))).toBeUndefined();
    store.save('KSFO', 42, typedClearance, false);
    store.save('KSFO', 7, typedAmendment, false);
    expect(store.load('KSFO', 7, at('amendment', 'dropdowns', false))).toBeUndefined();
    store.save('KSFO', 7, amendment, false);
    expect(store.load('KSFO', 42, at('clearance', 'dropdowns', false))).toStrictEqual(clearance);
    expect(store.load('KSFO', 42, at('clearance', 'text', false))).toStrictEqual(typedClearance);
    expect(store.load('KSFO', 7, at('amendment', 'dropdowns', false))).toStrictEqual(amendment);
    expect(store.load('KSFO', 7, at('amendment', 'text', false))).toStrictEqual(typedAmendment);
  });

  it('writes each input kind under its own key, the dropdowns under the key they always had', () => {
    const entries = new Map<string, string>();
    const store = createSolvedStore(mapStorage(entries));
    store.save('KSFO', 123, clearance, false);
    store.save('KSFO', 123, typedClearance, false);
    store.save('KSFO', 123, typedAmendment, false);
    expect(Object.fromEntries(entries)).toStrictEqual({
      'craft-tester:solved:KSFO:123': JSON.stringify(picks),
      'craft-tester:solved:KSFO:text:123': JSON.stringify({ text: TYPED }),
      'craft-tester:solved:KSFO:amend:text:123': JSON.stringify({ boxes, text: TYPED }),
    });
  });

  it('remembers a full route attempt apart from a typed one at the same seed', () => {
    const store = createSolvedStore(mapStorage());
    const fullRouteText: Attempt = {
      kind: 'clearance',
      input: 'text',
      text: `${TYPED} read to its end.`,
    };
    store.save('KSFO', 42, typedClearance, false);
    expect(store.load('KSFO', 42, at('clearance', 'text', true))).toBeUndefined();
    store.save('KSFO', 42, fullRouteText, true);
    expect(store.load('KSFO', 42, at('clearance', 'text', true))).toStrictEqual(fullRouteText);
    expect(store.load('KSFO', 42, at('clearance', 'text', false))).toStrictEqual(typedClearance);
    store.save('KSFO', 7, typedAmendment, true);
    expect(store.load('KSFO', 7, at('amendment', 'text', false))).toBeUndefined();
    expect(store.load('KSFO', 7, at('amendment', 'text', true))).toStrictEqual(typedAmendment);
  });

  it('leaves the keys of picked and typed attempts where they were', () => {
    const entries = new Map<string, string>();
    const store = createSolvedStore(mapStorage(entries));
    store.save('KSFO', 123, clearance, false);
    store.save('KSFO', 123, typedClearance, false);
    store.save('KSFO', 123, typedAmendment, false);
    store.save('KSFO', 123, typedClearance, true);
    store.save('KSFO', 123, typedAmendment, true);
    expect(Object.fromEntries(entries)).toStrictEqual({
      'craft-tester:solved:KSFO:123': JSON.stringify(picks),
      'craft-tester:solved:KSFO:text:123': JSON.stringify({ text: TYPED }),
      'craft-tester:solved:KSFO:amend:text:123': JSON.stringify({ boxes, text: TYPED }),
      'craft-tester:solved:KSFO:text:frc:123': JSON.stringify({ text: TYPED }),
      'craft-tester:solved:KSFO:amend:text:frc:123': JSON.stringify({ boxes, text: TYPED }),
    });
  });

  it('ignores a typed value that is not the shape its mode stores', () => {
    const entries = new Map<string, string>([
      ['craft-tester:solved:KSFO:text:42', JSON.stringify({ text: 7 })],
      ['craft-tester:solved:KSFO:text:43', JSON.stringify({ text: TYPED, picks })],
      ['craft-tester:solved:KSFO:text:44', JSON.stringify(picks)],
      ['craft-tester:solved:KSFO:text:45', '{not json'],
      ['craft-tester:solved:KSFO:amend:text:42', JSON.stringify({ text: TYPED })],
      ['craft-tester:solved:KSFO:amend:text:43', JSON.stringify({ boxes, picks: amendmentPicks })],
    ]);
    const store = createSolvedStore(mapStorage(entries));
    expect(store.load('KSFO', 42, at('clearance', 'text', false))).toBeUndefined();
    expect(store.load('KSFO', 43, at('clearance', 'text', false))).toBeUndefined();
    expect(store.load('KSFO', 44, at('clearance', 'text', false))).toBeUndefined();
    expect(store.load('KSFO', 45, at('clearance', 'text', false))).toBeUndefined();
    expect(store.load('KSFO', 42, at('amendment', 'text', false))).toBeUndefined();
    expect(store.load('KSFO', 43, at('amendment', 'text', false))).toBeUndefined();
  });
});
