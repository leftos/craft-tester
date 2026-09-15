import { z } from 'zod';
import type { ScenarioFilter } from '@/scenario/filter.ts';

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

/** The storage members the store touches, so a test can stand a Map in for the browser's. */
type FilterStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The storage key one airport's filter is remembered under. */
function keyFor(icao: string): string {
  return `craft-tester:filter:${icao}`;
}

/**
 * Builds a store over one storage.
 *
 * Remembering the filter is a convenience, so every failure the storage can raise — a refused read,
 * a full quota, a value another version wrote — reads as "nothing remembered", and the caller falls
 * back to the unfiltered draw.
 *
 * @param storage The storage to read and write, or `undefined` where the browser offers none.
 * @returns A store that loads `undefined` and saves nothing when the storage is missing or fails.
 */
export function createFilterStore(storage: FilterStorage | undefined): FilterStore {
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
        storage.setItem(keyFor(icao), JSON.stringify(filter));
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
