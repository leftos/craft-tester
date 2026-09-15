import { z } from 'zod';
import { AltitudePhraseSchema, RouteTemplateSchema } from '@/data/schema.ts';
import type { PlayerPicks } from '@/rules/types.ts';

/**
 * The shape a remembered attempt has to have to be loaded back.
 *
 * A value this browser stored under an older version of the form is missing the picks the form has
 * gained since, so it is rejected rather than replayed with holes in it.
 */
export const PlayerPicksSchema = z.strictObject({
  clearedTo: z.string(),
  sidId: z.string(),
  routeTemplate: RouteTemplateSchema,
  routeFix: z.string().optional(),
  altitudePhrase: AltitudePhraseSchema,
  altitudeFeet: z.number().optional(),
  expect: z.enum(['ten_minutes', 'three_minutes', 'none']),
  frequency: z.string(),
  runway: z.string(),
});

/**
 * Rebuilds the picks from a parsed value, leaving out the optional picks the attempt spoke none of.
 *
 * @param parsed The stored value, once the schema has accepted it.
 * @returns The same picks with no key holding an explicit `undefined`.
 */
function toPicks(parsed: z.infer<typeof PlayerPicksSchema>): PlayerPicks {
  const { routeFix, altitudeFeet, ...rest } = parsed;
  return {
    ...rest,
    ...(routeFix === undefined ? {} : { routeFix }),
    ...(altitudeFeet === undefined ? {} : { altitudeFeet }),
  };
}

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
        const parsed = PlayerPicksSchema.safeParse(JSON.parse(raw));
        return parsed.success ? toPicks(parsed.data) : undefined;
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
