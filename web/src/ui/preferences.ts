import { z } from 'zod';
import type { InputKind, Mode, ScenarioFilter } from '@/scenario/filter.ts';
import { MAX_SET_MINUTES, MAX_SET_STRIPS } from '@/scenario/filter.ts';

/**
 * The shape a remembered filter has to have to be loaded back.
 *
 * A filter this browser stored under an older version of the app may name a member the app no
 * longer has, so it is rejected rather than replayed into a draw that cannot honour it.
 */
export const ScenarioFilterSchema = z.strictObject({
  time: z.enum(['either', 'day', 'night']),
  config: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('any') }),
    z.strictObject({ kind: z.literal('plan'), plan: z.string() }),
    z.strictObject({ kind: z.literal('id'), id: z.string() }),
  ]),
});

/** Remembers the filter a viewer last drew under, per airport and in this browser only. */
export type FilterStore = {
  load(icao: string): ScenarioFilter | undefined;
  save(icao: string, filter: ScenarioFilter): void;
};

/** The storage members the stores touch, so a test can stand a Map in for the browser's. */
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The storage key one airport's filter is remembered under. */
function keyFor(icao: string): string {
  return `craft-tester:filter:${icao}`;
}

/**
 * Builds a store over one storage.
 *
 * Remembering the filter is a convenience, so every failure the storage can raise — a refused read,
 * a full quota, a value another version wrote — reads as "nothing remembered", and the caller falls
 * back to the unfiltered draw. Only the members the dropdowns offer are written: a destination
 * forced by the hash is a testing aid for one session, not a preference to carry into the next.
 *
 * @param storage The storage to read and write, or `undefined` where the browser offers none.
 * @returns A store that loads `undefined` and saves nothing when the storage is missing or fails.
 */
export function createFilterStore(storage: PreferenceStorage | undefined): FilterStore {
  if (storage === undefined) {
    return {
      load: () => undefined,
      save: () => {
        // Without a storage there is nowhere to remember the filter.
      },
    };
  }
  return {
    load: (icao) => {
      try {
        const raw = storage.getItem(keyFor(icao));
        if (raw === null) return undefined;
        const parsed = ScenarioFilterSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
    save: (icao, filter) => {
      try {
        const { time, config } = filter;
        storage.setItem(keyFor(icao), JSON.stringify({ time, config }));
      } catch {
        // A storage that refuses the write costs the viewer the remembered filter, nothing more.
      }
    },
  };
}

/**
 * Builds the store the page runs on.
 *
 * @returns A store over `localStorage`, or one that remembers nothing where reaching it throws.
 */
export function browserFilterStore(): FilterStore {
  try {
    return createFilterStore(globalThis.localStorage);
  } catch {
    return createFilterStore(undefined);
  }
}

/** The shape a remembered input kind has to have to be loaded back. */
const InputKindSchema = z.enum(['dropdowns', 'text']);

/** The storage key the input kind is remembered under: one per browser, whatever the airport. */
const INPUT_KEY = 'craft-tester:input';

/** Remembers how a viewer last chose to answer the clearance, in this browser only. */
export type InputKindStore = { load(): InputKind | undefined; save(input: InputKind): void };

/**
 * Builds an input-kind store over one storage.
 *
 * Remembering the input kind is a convenience, as the filter is, so every failure the storage can
 * raise — a refused read, a full quota, a value another version wrote — reads as "nothing
 * remembered", and the caller falls back to the dropdowns.
 *
 * @param storage The storage to read and write, or `undefined` where the browser offers none.
 * @returns A store that loads `undefined` and saves nothing when the storage is missing or fails.
 */
export function createInputKindStore(storage: PreferenceStorage | undefined): InputKindStore {
  if (storage === undefined) {
    return {
      load: () => undefined,
      save: () => {
        // Without a storage there is nowhere to remember the input kind.
      },
    };
  }
  return {
    load: () => {
      try {
        const raw = storage.getItem(INPUT_KEY);
        if (raw === null) return undefined;
        const parsed = InputKindSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
    save: (input) => {
      try {
        storage.setItem(INPUT_KEY, JSON.stringify(input));
      } catch {
        // A storage that refuses the write costs the viewer the remembered input kind, nothing more.
      }
    },
  };
}

/**
 * Builds the input-kind store the page runs on.
 *
 * @returns A store over `localStorage`, or one that remembers nothing where reaching it throws.
 */
export function browserInputKindStore(): InputKindStore {
  try {
    return createInputKindStore(globalThis.localStorage);
  } catch {
    return createInputKindStore(undefined);
  }
}

/** The shape a remembered full route choice has to have to be loaded back. */
const FullRouteSchema = z.boolean();

/** The storage key the full route choice is remembered under: one per browser, as the input is. */
const FULL_ROUTE_KEY = 'craft-tester:full-route';

/** Remembers whether a viewer last held themselves to the full route, in this browser only. */
export type FullRouteStore = { load(): boolean | undefined; save(fullRoute: boolean): void };

/**
 * Builds a full-route store over one storage.
 *
 * Remembering the choice is a convenience, as the input kind is, so every failure the storage can
 * raise — a refused read, a full quota, a value another version wrote — reads as "nothing
 * remembered", and the caller falls back to the reading spoken on frequency.
 *
 * @param storage The storage to read and write, or `undefined` where the browser offers none.
 * @returns A store that loads `undefined` and saves nothing when the storage is missing or fails.
 */
export function createFullRouteStore(storage: PreferenceStorage | undefined): FullRouteStore {
  if (storage === undefined) {
    return {
      load: () => undefined,
      save: () => {
        // Without a storage there is nowhere to remember the full route choice.
      },
    };
  }
  return {
    load: () => {
      try {
        const raw = storage.getItem(FULL_ROUTE_KEY);
        if (raw === null) return undefined;
        const parsed = FullRouteSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
    save: (fullRoute) => {
      try {
        storage.setItem(FULL_ROUTE_KEY, JSON.stringify(fullRoute));
      } catch {
        // A storage that refuses the write costs the viewer the remembered choice, nothing more.
      }
    },
  };
}

/**
 * Builds the full-route store the page runs on.
 *
 * @returns A store over `localStorage`, or one that remembers nothing where reaching it throws.
 */
export function browserFullRouteStore(): FullRouteStore {
  try {
    return createFullRouteStore(globalThis.localStorage);
  } catch {
    return createFullRouteStore(undefined);
  }
}

/** What home opens on: the airport, the mode, practice or a test, and the test's size and time. */
export type HomeChoices = {
  icao: string;
  mode: Mode;
  format: 'practice' | 'test';
  n: number;
  minutes: number;
};

/** The shape remembered home choices have to have to be loaded back. */
const HomeChoicesSchema = z.strictObject({
  icao: z.string().regex(/^[A-Z]{4}$/),
  mode: z.enum(['clearance', 'amendment']),
  format: z.enum(['practice', 'test']),
  n: z.number().int().min(1).max(MAX_SET_STRIPS),
  minutes: z.number().int().min(0).max(MAX_SET_MINUTES),
});

/** The storage key home's choices are remembered under: one per browser. */
const HOME_KEY = 'craft-tester:home';

/** Remembers what a viewer last chose on home, in this browser only. */
export type HomeStore = { load(): HomeChoices | undefined; save(choices: HomeChoices): void };

/**
 * Builds a home store over one storage.
 *
 * Remembering the choices is a convenience, as the filter is, so every failure the storage can
 * raise — a refused read, a full quota, a value another version wrote — reads as "nothing
 * remembered", and home falls back to its defaults.
 *
 * @param storage The storage to read and write, or `undefined` where the browser offers none.
 * @returns A store that loads `undefined` and saves nothing when the storage is missing or fails.
 */
export function createHomeStore(storage: PreferenceStorage | undefined): HomeStore {
  if (storage === undefined) {
    return {
      load: () => undefined,
      save: () => {
        // Without a storage there is nowhere to remember the choices.
      },
    };
  }
  return {
    load: () => {
      try {
        const raw = storage.getItem(HOME_KEY);
        if (raw === null) return undefined;
        const parsed = HomeChoicesSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
    save: (choices) => {
      try {
        storage.setItem(HOME_KEY, JSON.stringify(choices));
      } catch {
        // A storage that refuses the write costs the viewer the remembered choices, nothing more.
      }
    },
  };
}

/**
 * Builds the home store the page runs on.
 *
 * @returns A store over `localStorage`, or one that remembers nothing where reaching it throws.
 */
export function browserHomeStore(): HomeStore {
  try {
    return createHomeStore(globalThis.localStorage);
  } catch {
    return createHomeStore(undefined);
  }
}
