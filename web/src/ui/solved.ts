import type { PlayerPicks } from '@/rules/types.ts';

/** Remembers the clearance a viewer already submitted for a scenario, in this browser only. */
export type SolvedStore = {
  load(icao: string, seed: number): PlayerPicks | undefined;
  save(icao: string, seed: number, picks: PlayerPicks): void;
};

/** The storage members the store touches, so a test can stand a Map in for the browser's. */
type PicksStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The storage key one airport's seed is remembered under. */
function keyFor(icao: string, seed: number): string {
  return `craft-tester:solved:${icao}:${seed}`;
}

/**
 * Builds a store over one storage.
 *
 * Remembering a solved scenario is a convenience, so every failure the storage can raise — a
 * refused read, a full quota, a value another version wrote — reads as "nothing remembered".
 *
 * @param storage The storage to read and write, or `undefined` where the browser offers none.
 * @returns A store that loads `undefined` and saves nothing when the storage is missing or fails.
 */
export function createSolvedStore(storage: PicksStorage | undefined): SolvedStore {
  if (storage === undefined) {
    return {
      load: () => undefined,
      save: () => {
        // Without a storage there is nowhere to remember the attempt.
      },
    };
  }
  return {
    load: (icao, seed) => {
      try {
        const raw = storage.getItem(keyFor(icao, seed));
        if (raw === null) return undefined;
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null ? (parsed as PlayerPicks) : undefined;
      } catch {
        return undefined;
      }
    },
    save: (icao, seed, picks) => {
      try {
        storage.setItem(keyFor(icao, seed), JSON.stringify(picks));
      } catch {
        // A storage that refuses the write costs the viewer the reminder, nothing more.
      }
    },
  };
}

/**
 * Builds the store the page runs on.
 *
 * @returns A store over `localStorage`, or one that remembers nothing where reaching it throws.
 */
export function browserSolvedStore(): SolvedStore {
  try {
    return createSolvedStore(globalThis.localStorage);
  } catch {
    return createSolvedStore(undefined);
  }
}
