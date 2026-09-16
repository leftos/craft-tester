import { z } from 'zod';
import { AltitudePhraseSchema, RouteTemplateSchema } from '@/data/schema.ts';
import type { BoxAnswers } from '@/rules/amend/grade.ts';
import type { PlayerPicks } from '@/rules/types.ts';
import type { Mode } from '@/scenario/filter.ts';
import type { AmendmentPicks } from '@/ui/state.ts';

/**
 * The shape a remembered attempt has to have to be loaded back.
 *
 * A value this browser stored under an older version of the form is missing the picks the form has
 * gained since, or carries one it has dropped, so it is rejected rather than replayed as it stands.
 */
export const PlayerPicksSchema = z.strictObject({
  routeTemplate: RouteTemplateSchema,
  routeFix: z.string().optional(),
  altitudePhrase: AltitudePhraseSchema,
  altitudeFeet: z.number().optional(),
  expect: z.enum(['ten_minutes', 'five_minutes', 'three_minutes', 'none']),
  frequency: z.string(),
  runway: z.string(),
});

/** The picks an amendment attempt stores: the ordinary ones and the procedure it picked. */
const AmendmentPicksSchema = PlayerPicksSchema.extend({ procedure: z.string() });

/** What the student did with one box, as the store writes it. */
const BoxAnswerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('as_filed') }),
  z.strictObject({ kind: z.literal('amended'), value: z.string() }),
]);

/** What an amendment attempt stores: the answers to the three boxes, and the clearance after them. */
const AmendmentAttemptSchema = z.strictObject({
  boxes: z.strictObject({
    type: BoxAnswerSchema,
    altitude: BoxAnswerSchema,
    route: BoxAnswerSchema,
  }),
  picks: AmendmentPicksSchema,
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

/** Rebuilds an amendment attempt from a parsed value. */
function toAmendment(parsed: z.infer<typeof AmendmentAttemptSchema>): Attempt {
  const { procedure, ...rest } = parsed.picks;
  const picks: AmendmentPicks = { ...toPicks(rest), procedure };
  return { kind: 'amendment', boxes: parsed.boxes, picks };
}

/**
 * What one attempt at a scenario answered, which is what a revisit shows back.
 *
 * A clearance attempt is the CRAFT form alone; an amendment attempt carries the strip answers that
 * came before the form, and the procedure the form picked on the corrected plan.
 */
export type Attempt =
  | { kind: 'clearance'; picks: PlayerPicks }
  | { kind: 'amendment'; boxes: BoxAnswers; picks: AmendmentPicks };

/** Remembers the attempt a viewer already submitted for a scenario, in this browser only. */
export type SolvedStore = {
  load(icao: string, seed: number, mode: Mode): Attempt | undefined;
  save(icao: string, seed: number, attempt: Attempt): void;
};

/** The storage members the store touches, so a test can stand a Map in for the browser's. */
type PicksStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The storage key one airport's seed is remembered under, in one mode.
 *
 * Clearance mode keeps the key it always had, so a scenario a browser solved before the trainer
 * gained a second mode is still remembered.
 */
function keyFor(icao: string, seed: number, mode: Mode): string {
  const scope = mode === 'amendment' ? ':amend' : '';
  return `craft-tester:solved:${icao}${scope}:${seed}`;
}

/** Reads one stored value as the attempt its mode stores, or `undefined` where it does not parse. */
function parseAttempt(raw: string, mode: Mode): Attempt | undefined {
  const value: unknown = JSON.parse(raw);
  if (mode === 'amendment') {
    const parsed = AmendmentAttemptSchema.safeParse(value);
    return parsed.success ? toAmendment(parsed.data) : undefined;
  }
  const parsed = PlayerPicksSchema.safeParse(value);
  return parsed.success ? { kind: 'clearance', picks: toPicks(parsed.data) } : undefined;
}

/** What one attempt is written as: the bare picks for a clearance, both halves for an amendment. */
function storedValue(attempt: Attempt): string {
  return JSON.stringify(
    attempt.kind === 'clearance' ? attempt.picks : { boxes: attempt.boxes, picks: attempt.picks },
  );
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
    load: (icao, seed, mode) => {
      try {
        const raw = storage.getItem(keyFor(icao, seed, mode));
        return raw === null ? undefined : parseAttempt(raw, mode);
      } catch {
        return undefined;
      }
    },
    save: (icao, seed, attempt) => {
      try {
        storage.setItem(keyFor(icao, seed, attempt.kind), storedValue(attempt));
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
