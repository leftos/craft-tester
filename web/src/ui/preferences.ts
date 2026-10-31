import { z } from 'zod';
import type { InputKind, Mode, ScenarioFilter } from '@/scenario/filter.ts';
import { MAX_SET_MINUTES, MAX_SET_STRIPS } from '@/scenario/filter.ts';
import type { TutorialPart } from '@/ui/router.ts';
import { TUTORIAL_PART_NAMES } from '@/ui/router.ts';

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

/** The shape a remembered runway grading choice has to have to be loaded back. */
const RunwayGradingSchema = z.boolean();

/** The storage key the runway grading choice is remembered under: one per browser, as the input is. */
const RUNWAY_GRADING_KEY = 'craft-tester:runway-grading';

/** Remembers whether a viewer last chose to have the runway graded, in this browser only. */
export type RunwayGradingStore = { load(): boolean | undefined; save(graded: boolean): void };

/**
 * Builds a runway-grading store over one storage.
 *
 * Remembering the choice is a convenience, as the full route choice is, so every failure the storage
 * can raise — a refused read, a full quota, a value another version wrote — reads as "nothing
 * remembered", and the caller falls back to grading the runway.
 *
 * @param storage The storage to read and write, or `undefined` where the browser offers none.
 * @returns A store that loads `undefined` and saves nothing when the storage is missing or fails.
 */
export function createRunwayGradingStore(
  storage: PreferenceStorage | undefined,
): RunwayGradingStore {
  if (storage === undefined) {
    return {
      load: () => undefined,
      save: () => {
        // Without a storage there is nowhere to remember the runway grading choice.
      },
    };
  }
  return {
    load: () => {
      try {
        const raw = storage.getItem(RUNWAY_GRADING_KEY);
        if (raw === null) return undefined;
        const parsed = RunwayGradingSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
    save: (graded) => {
      try {
        storage.setItem(RUNWAY_GRADING_KEY, JSON.stringify(graded));
      } catch {
        // A storage that refuses the write costs the viewer the remembered choice, nothing more.
      }
    },
  };
}

/**
 * Builds the runway-grading store the page runs on.
 *
 * @returns A store over `localStorage`, or one that remembers nothing where reaching it throws.
 */
export function browserRunwayGradingStore(): RunwayGradingStore {
  try {
    return createRunwayGradingStore(globalThis.localStorage);
  } catch {
    return createRunwayGradingStore(undefined);
  }
}

/** The shape a remembered "tour seen" mark has to have to be loaded back. */
const TourSeenSchema = z.boolean();

/** The storage key the tour being seen is remembered under: one per browser. */
const TOUR_SEEN_KEY = 'craft-tester:tour-seen';

/** Remembers whether a viewer finished or skipped the tour, in this browser only. */
export type TourSeenStore = { load(): boolean | undefined; save(seen: boolean): void };

/**
 * Builds a tour-seen store over one storage.
 *
 * Remembering the mark is a convenience, as the input kind is, so every failure the storage can
 * raise — a refused read, a full quota, a value another version wrote — reads as "nothing
 * remembered", and the caller treats the tour as not yet seen.
 *
 * @param storage The storage to read and write, or `undefined` where the browser offers none.
 * @returns A store that loads `undefined` and saves nothing when the storage is missing or fails.
 */
export function createTourSeenStore(storage: PreferenceStorage | undefined): TourSeenStore {
  if (storage === undefined) {
    return {
      load: () => undefined,
      save: () => {
        // Without a storage there is nowhere to remember the tour was seen.
      },
    };
  }
  return {
    load: () => {
      try {
        const raw = storage.getItem(TOUR_SEEN_KEY);
        if (raw === null) return undefined;
        const parsed = TourSeenSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
    save: (seen) => {
      try {
        storage.setItem(TOUR_SEEN_KEY, JSON.stringify(seen));
      } catch {
        // A storage that refuses the write costs the viewer the mark, so the tour may open again.
      }
    },
  };
}

/**
 * Builds the tour-seen store the page runs on.
 *
 * @returns A store over `localStorage`, or one that remembers nothing where reaching it throws.
 */
export function browserTourSeenStore(): TourSeenStore {
  try {
    return createTourSeenStore(globalThis.localStorage);
  } catch {
    return createTourSeenStore(undefined);
  }
}

/**
 * How far a viewer got through one part of the tour.
 *
 * @property version The version of the step lists the step counts in, so a changed list is not
 *   resumed part way.
 * @property part The part of the tour.
 * @property step The index of the step the part was on.
 */
export type TourProgress = { version: number; part: TutorialPart; step: number };

/** The shape stored tour progress has to have to be loaded back. */
const TourProgressSchema = z.strictObject({
  version: z.number().int(),
  part: z.enum(TUTORIAL_PART_NAMES),
  step: z.number().int().min(0),
});

/** The storage key tour progress is stored under: one per browser, whichever part it is. */
const TOUR_PROGRESS_KEY = 'craft-tester:tour-progress';

/** Remembers the step a viewer left the tour on, in this browser only, until it ends. */
export type TourProgressStore = {
  load(): TourProgress | undefined;
  save(progress: TourProgress): void;
  clear(): void;
};

/** The storage members the progress store touches, which forgets as well as remembers. */
type ClearableStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Builds a tour-progress store over one storage.
 *
 * Resuming the tour is a convenience, as the filter is, so every failure the storage can raise — a
 * refused read, a full quota, a value another version wrote — reads as "no progress", and the part
 * starts from its first step.
 *
 * @param storage The storage to read and write, or `undefined` where the browser offers none.
 * @returns A store that loads `undefined` and saves nothing when the storage is missing or fails.
 */
export function createTourProgressStore(storage: ClearableStorage | undefined): TourProgressStore {
  if (storage === undefined) {
    return {
      load: () => undefined,
      save: () => {
        // Without a storage there is nowhere to remember the step.
      },
      clear: () => {
        // Without a storage there is nothing to forget.
      },
    };
  }
  return {
    load: () => {
      try {
        const raw = storage.getItem(TOUR_PROGRESS_KEY);
        if (raw === null) return undefined;
        const parsed = TourProgressSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },
    save: (progress) => {
      try {
        storage.setItem(TOUR_PROGRESS_KEY, JSON.stringify(progress));
      } catch {
        // A storage that refuses the write costs the viewer the resume, nothing more.
      }
    },
    clear: () => {
      try {
        storage.removeItem(TOUR_PROGRESS_KEY);
      } catch {
        // A storage that refuses the removal leaves progress that a later part start overrides.
      }
    },
  };
}

/**
 * Builds the tour-progress store the page runs on.
 *
 * @returns A store over `localStorage`, or one that remembers nothing where reaching it throws.
 */
export function browserTourProgressStore(): TourProgressStore {
  try {
    return createTourProgressStore(globalThis.localStorage);
  } catch {
    return createTourProgressStore(undefined);
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
