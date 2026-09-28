import { z } from 'zod';
import type { AirportData } from '@/data/schema.ts';
import type { Grade } from '@/rules/types.ts';
import type { ScenarioFilter, SessionSettings, SetParams } from '@/scenario/filter.ts';
import { hashFor } from '@/scenario/filter.ts';
import { seedFromString } from '@/scenario/rng.ts';
import { amendmentGrades } from '@/ui/amendPanels.ts';
import { clearanceOutcome } from '@/ui/clearanceGrading.ts';
import { creditOf, sessionScoreLine } from '@/ui/results.ts';
import { buildScenario, clearedPlan } from '@/ui/session.ts';
import type { Attempt } from '@/ui/solved.ts';
import type { AmendmentPicks, AppState, SetState } from '@/ui/state.ts';
import { newSession } from '@/ui/state.ts';

/** How many seeds one strip of a set tries before it is left unanswerable. */
const SEED_TRIES = 20;

/** Milliseconds in a minute and in a second. */
const MINUTE_MS = 60_000;
const SECOND_MS = 1000;

/** The seed a strip of a set draws, and whether the engine clears the scenario it draws. */
export type StripSeed = { seed: number; resolved: boolean };

/**
 * The seed strip `index` of a set draws.
 *
 * The strip's own seed is `seedFromString("<setSeed>:<index>")`. Where the engine cannot clear the
 * scenario it draws, the strip draws again from `"<setSeed>:<index>:r1"`, `:r2` and on, so a reload
 * or a shared link lands on the same scenario; after 20 tries the last one is kept, unresolved.
 *
 * @param setSeed The seed of the set.
 * @param index The strip, 0-based.
 * @param resolves Whether the engine clears the scenario a seed draws.
 * @returns The seed the strip draws, and whether it resolved.
 */
export function stripSeed(
  setSeed: number,
  index: number,
  resolves: (seed: number) => boolean,
): StripSeed {
  let seed = seedFromString(`${setSeed}:${index}`);
  for (let retry = 0; retry < SEED_TRIES; retry += 1) {
    if (retry > 0) seed = seedFromString(`${setSeed}:${index}:r${retry}`);
    if (resolves(seed)) return { seed, resolved: true };
  }
  return { seed, resolved: false };
}

/** The moment a timed set runs out, or `undefined` for an untimed one. */
function deadlineOf(set: SetState): number | undefined {
  return set.minutes === 0 ? undefined : set.startedAt + set.minutes * MINUTE_MS;
}

/**
 * Whether a timed set has run out of time; an untimed one never does.
 *
 * @param set The set.
 * @param now The time now, in epoch milliseconds.
 * @returns True once the clock of a timed set reads zero.
 */
export function isTimeUp(set: SetState, now: number): boolean {
  const deadline = deadlineOf(set);
  return deadline !== undefined && now >= deadline;
}

/**
 * How long the set took, or has taken so far: up to its end, and never past its time limit.
 *
 * @param set The set.
 * @param now The time now, in epoch milliseconds, which counts for a set not yet ended.
 * @returns Milliseconds, never negative.
 */
export function timeUsed(set: SetState, now: number): number {
  const end = set.endedAt ?? now;
  const deadline = deadlineOf(set) ?? end;
  return Math.max(0, Math.min(end, deadline) - set.startedAt);
}

/**
 * Writes a span of time as minutes and seconds, e.g. `04:07`, or `125:00` past an hour.
 *
 * @param ms The span, in milliseconds; a part of a second is dropped.
 * @returns The span as `mm:ss`.
 */
export function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / SECOND_MS));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** What the set's clock reads, and what a screen reader calls it. */
export type ClockReading = { text: string; label: 'Time left' | 'Time used' };

/**
 * What the clock of the test bar reads: the time left of a timed set, counted down and rounded up
 * to the second so it reads `00:00` only when time is up, or the time used of an untimed one.
 *
 * @param set The set.
 * @param now The time now, in epoch milliseconds.
 * @returns The reading and its accessible name.
 */
export function clockReading(set: SetState, now: number): ClockReading {
  const deadline = deadlineOf(set);
  if (deadline === undefined) return { text: formatClock(timeUsed(set, now)), label: 'Time used' };
  const left = Math.max(0, deadline - now);
  return { text: formatClock(Math.ceil(left / SECOND_MS) * SECOND_MS), label: 'Time left' };
}

/** How one progress square of the test bar reads. */
export type SquareState = 'done' | 'now' | 'skipped' | 'open';

/**
 * How the progress square of one strip reads: answered, on screen, skipped, or not reached yet.
 *
 * @param set The set.
 * @param index The strip, 0-based.
 * @returns The square's state; the strip on screen reads `now` even where it was skipped before.
 */
export function squareOf(set: SetState, index: number): SquareState {
  if (set.answered.includes(index)) return 'done';
  if (index === set.index) return 'now';
  return set.skipped.includes(index) ? 'skipped' : 'open';
}

/** Whether a strip has been neither answered nor skipped. */
function untouched(set: SetState, index: number): boolean {
  return !set.answered.includes(index) && !set.skipped.includes(index);
}

/**
 * The strip a set moves to after the one on screen: the next one not yet reached, then (past the
 * last strip) the first one skipped and still unanswered, and the summary (`n`) once none is left.
 *
 * @param set The set, with the strip on screen already marked answered or skipped.
 * @returns The index of the strip to open, or `n` for the summary.
 */
export function nextOpenIndex(set: SetState): number {
  const order = [
    ...Array.from({ length: set.n - set.index - 1 }, (_, step) => set.index + 1 + step),
    ...Array.from({ length: set.index + 1 }, (_, step) => step),
  ];
  const fresh = order.find((index) => untouched(set, index));
  if (fresh !== undefined) return fresh;
  const skipped = [...set.skipped];
  skipped.sort((a, b) => a - b);
  return skipped.find((index) => !set.answered.includes(index)) ?? set.n;
}

/** The set moved on to the strip after the one on screen, ended where none is left open. */
function movedOn(set: SetState, now: number): SetState {
  const index = nextOpenIndex(set);
  return index >= set.n ? endedSet(set, now) : { ...set, index };
}

/**
 * The set once the strip on screen is answered: marked done, its attempt kept, and moved on.
 *
 * @param set The set.
 * @param now The time now, which ends the set where no strip is left open.
 * @param attempt The attempt submitted at the strip, which the summary grades.
 * @returns The set on its next open strip, or on its summary.
 */
export function withStripAnswered(set: SetState, now: number, attempt: Attempt): SetState {
  const answered = [...set.answered.filter((index) => index !== set.index), set.index];
  const skipped = set.skipped.filter((index) => index !== set.index);
  const attempts = { ...set.attempts, [set.index]: attempt };
  return movedOn({ ...set, answered, skipped, attempts }, now);
}

/**
 * The set once the strip on screen is skipped: marked skipped, and moved on.
 *
 * @param set The set.
 * @param now The time now, which ends the set where no strip is left open.
 * @returns The set on its next open strip, which may be the one just skipped where it is the last.
 */
export function withStripSkipped(set: SetState, now: number): SetState {
  const skipped = set.skipped.includes(set.index) ? set.skipped : [...set.skipped, set.index];
  return movedOn({ ...set, skipped }, now);
}

/**
 * The set ended: on its summary, with the end time kept, which a timed set caps at its time limit.
 *
 * @param set The set.
 * @param now The time now.
 * @returns The set on its summary; a set already ended keeps the time it ended at.
 */
export function endedSet(set: SetState, now: number): SetState {
  const deadline = deadlineOf(set) ?? now;
  const endedAt = set.endedAt ?? Math.min(now, deadline);
  return { ...set, index: set.n, ended: true, endedAt };
}

/** A strip of the summary: its verdicts where it was answered, and how many elements it grades. */
export type StripResult = { grades: readonly Grade[] | undefined; count: number };

/** The two totals of a summary: how many strips were fully correct, and the percent of credit. */
export type SetTotals = { fullyCorrect: number; percent: number };

/** Whether every verdict of an answered strip earned full credit. */
function fullyCorrect(grades: readonly Grade[] | undefined): boolean {
  if (grades === undefined || grades.length === 0) return false;
  return grades.every((grade) => grade.verdict === 'correct' || grade.verdict === 'acceptable');
}

/**
 * The totals of a finished set.
 *
 * A strip is fully correct when every one of its verdicts earned full credit. The percent is the
 * credit of every strip (half credit counting half) over the elements of every strip, an unanswered
 * one counting its elements with no credit, rounded to a whole percent.
 *
 * @param strips Each strip's verdicts, or `undefined` where it was not answered, and its count.
 * @returns The two totals.
 */
export function setTotals(strips: readonly StripResult[]): SetTotals {
  const credit = strips.reduce((sum, strip) => sum + creditOf(strip.grades ?? []), 0);
  const count = strips.reduce((sum, strip) => sum + strip.count, 0);
  return {
    fullyCorrect: strips.filter((strip) => fullyCorrect(strip.grades)).length,
    percent: count === 0 ? 0 : Math.round((credit / count) * 100),
  };
}

/** The picks an unanswered dropdown strip is graded with, only to count its elements. */
const PLACEHOLDER_PICKS: AmendmentPicks = {
  procedure: '',
  routeTemplate: 'transition',
  altitudePhrase: 'maintain',
  expect: 'none',
  frequency: '',
  runway: '',
};

/**
 * The answer an unanswered strip is graded as to count its elements: nothing typed, or blank
 * dropdowns, with every strip box left as filed.
 */
function emptyAttempt(settings: SessionSettings): Attempt {
  const answer =
    settings.input === 'text'
      ? { input: 'text' as const, text: '' }
      : { input: 'dropdowns' as const, picks: PLACEHOLDER_PICKS };
  if (settings.mode === 'clearance') return { kind: 'clearance', ...answer };
  const asFiled = { kind: 'as_filed' as const };
  return {
    kind: 'amendment',
    boxes: { type: asFiled, altitude: asFiled, route: asFiled },
    ...answer,
  };
}

/**
 * Grades one strip of a set: the attempt the student saved at its seed, or, where they left it
 * unanswered, an empty answer, whose verdicts only count its elements.
 *
 * @param airport The airport the set runs at.
 * @param seed The strip's seed.
 * @param settings The filter, mode, input kind and reading the set runs under.
 * @param attempt The saved attempt, or `undefined` for an unanswered strip.
 * @returns The strip's verdicts where it was answered, and how many elements it grades.
 */
export function stripResult(
  airport: AirportData,
  seed: number,
  settings: SessionSettings,
  attempt: Attempt | undefined,
): StripResult {
  const view = buildScenario(airport, seed, settings.filter, settings.mode);
  const graded = attempt ?? emptyAttempt(settings);
  const routeReading = settings.fullRoute ? 'full' : 'abbreviated';
  let grades: Grade[] = [];
  if (view.kind === 'clearance' && graded.kind === 'clearance') {
    grades = clearanceOutcome(graded, view.generated, view.clearance, airport, routeReading).grades;
  } else if (view.kind === 'amendment' && graded.kind === 'amendment') {
    const cleared = clearedPlan(view, graded.boxes, airport);
    grades = amendmentGrades({ drawn: view.drawn, cleared, airport, answer: graded, routeReading });
  }
  return { grades: attempt === undefined ? undefined : grades, count: grades.length };
}

/**
 * The seed strip `index` of a set draws at one airport, under the settings the set runs with.
 *
 * @param airport The airport the set runs at.
 * @param setSeed The seed of the set.
 * @param index The strip, 0-based.
 * @param settings The filter and mode the set draws under.
 * @returns The strip's seed, and whether the engine clears the scenario it draws.
 */
export function setStripSeed(
  airport: AirportData,
  setSeed: number,
  index: number,
  settings: SessionSettings,
): StripSeed {
  const resolves = (seed: number): boolean =>
    buildScenario(airport, seed, settings.filter, settings.mode).kind !== 'unresolved';
  return stripSeed(setSeed, index, resolves);
}

/**
 * The page on a set's strip: a fresh session at the strip's seed, never shown as a revisit, or the
 * summary once the set's index reaches its count.
 *
 * @param state The state the set is started or moved on from; its airport and settings stay.
 * @param set The set, on the strip to open.
 * @returns The state on that strip.
 */
export function onSetStrip(state: AppState, set: SetState): AppState {
  if (set.index >= set.n) return { ...state, set };
  const { seed } = setStripSeed(state.airport, set.seed, set.index, state);
  return { ...newSession(state.airport, seed, undefined, state), set };
}

/**
 * Opens a set a link names: resumed where this browser stored it, with its start time and its
 * answered and skipped strips, or started fresh, its clock from now, where it did not. A set whose
 * time ran out while the page was closed opens on its summary.
 *
 * @param state The session the page would open on without the set.
 * @param params The set the hash names, on the strip the hash names.
 * @param record What this browser stored for the set, or `undefined`.
 * @param now The time now.
 * @returns The state on the set's strip, or on its summary.
 */
export function openedSet(
  state: AppState,
  params: SetParams,
  record: SetRecord | undefined,
  now: number,
): AppState {
  const progress =
    record === undefined
      ? { startedAt: now, answered: [], skipped: [], ended: false, endedAt: undefined }
      : {
          startedAt: record.startedAt,
          answered: record.answered,
          skipped: record.skipped,
          ended: record.ended,
          endedAt: record.endedAt,
        };
  const shape = record === undefined ? params : { ...params, n: record.n, minutes: record.minutes };
  const set: SetState = { ...shape, ...progress, attempts: {} };
  if (set.ended || set.index >= set.n || isTimeUp(set, now)) {
    return { ...state, set: endedSet(set, now) };
  }
  if (!set.answered.includes(set.index)) return onSetStrip(state, set);
  const index = nextOpenIndex(set);
  const moved = index >= set.n ? endedSet(set, now) : { ...set, index };
  return onSetStrip(state, moved);
}

/**
 * What a set stores for its resume: the set itself and the settings it runs under.
 *
 * @param state The state on one of the set's strips or on its summary.
 * @param set The set.
 * @returns The record to store.
 */
export function recordOf(state: AppState, set: SetState): SetRecord {
  return {
    startedAt: set.startedAt,
    minutes: set.minutes,
    n: set.n,
    icao: state.airport.airport.icao,
    mode: state.mode,
    input: state.input,
    fullRoute: state.fullRoute,
    filter: state.filter,
    answered: [...set.answered],
    skipped: [...set.skipped],
    ended: set.ended,
    endedAt: set.endedAt,
  };
}

/**
 * One row of the summary: the strip's number, its score line (or "Unanswered", or "Could not be
 * drawn" for a strip no seed resolved), whether it was answered, and its link.
 */
export type SummaryRow = { number: number; line: string; answered: boolean; hash: string };

/** What a summary row says of its strip. */
function summaryLine(resolved: boolean, result: StripResult): string {
  if (!resolved) return 'Could not be drawn';
  return result.grades === undefined ? 'Unanswered' : sessionScoreLine(result.grades);
}

/** Everything the summary shows: the two totals, the time used, and a row per strip. */
export type SetSummary = { totals: SetTotals; n: number; timeUsed: string; rows: SummaryRow[] };

/**
 * The summary of a finished set: every strip the set counts answered graded from the attempt the set
 * kept in memory, or else the one saved at its seed (a set resumed after a reload), and every other
 * strip counted as unanswered.
 *
 * @param state The state on the set's summary.
 * @param set The set.
 * @param load Reads the attempt saved at one seed under the set's settings.
 * @param now The time now, which counts only where the set has no end time.
 * @returns The totals, the time used and one row per strip, each linking to the strip's plain hash.
 */
export function setSummary(
  state: AppState,
  set: SetState,
  load: (seed: number) => Attempt | undefined,
  now: number,
): SetSummary {
  const settings = { filter: state.filter, mode: state.mode, input: state.input };
  const plain: SessionSettings = { ...settings, fullRoute: state.fullRoute };
  const strips = Array.from({ length: set.n }, (_, index) => {
    const { seed, resolved } = setStripSeed(state.airport, set.seed, index, plain);
    const attempt = set.answered.includes(index) ? (set.attempts[index] ?? load(seed)) : undefined;
    return { seed, resolved, result: stripResult(state.airport, seed, plain, attempt) };
  });
  const rows = strips.map(({ seed, resolved, result }, index) => ({
    number: index + 1,
    line: summaryLine(resolved, result),
    answered: result.grades !== undefined,
    hash: hashFor(state.airport.airport.icao, seed, plain),
  }));
  const drawn = strips.filter((strip) => strip.resolved);
  return {
    totals: setTotals(drawn.map((strip) => strip.result)),
    n: drawn.length,
    timeUsed: formatClock(timeUsed(set, now)),
    rows,
  };
}

/** The filter a set record stores, as the store writes it. */
const FilterSchema = z.strictObject({
  time: z.enum(['either', 'day', 'night']),
  config: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('any') }),
    z.strictObject({ kind: z.literal('plan'), plan: z.string() }),
    z.strictObject({ kind: z.literal('id'), id: z.string() }),
  ]),
  destination: z.string().optional(),
});

/** The shape a stored set has to have to be resumed. */
const SetRecordSchema = z.strictObject({
  startedAt: z.number(),
  minutes: z.number().int().nonnegative(),
  n: z.number().int().positive(),
  icao: z.string(),
  mode: z.enum(['clearance', 'amendment']),
  input: z.enum(['dropdowns', 'text']),
  fullRoute: z.boolean(),
  filter: FilterSchema,
  answered: z.array(z.number().int().nonnegative()),
  skipped: z.array(z.number().int().nonnegative()),
  ended: z.boolean(),
  endedAt: z.number().nullable(),
});

/** What one set stores: when it started, what it runs under, and how far it got. */
export type SetRecord = Omit<SessionSettings, 'set'> & {
  startedAt: number;
  minutes: number;
  n: number;
  icao: string;
  answered: number[];
  skipped: number[];
  ended: boolean;
  endedAt: number | undefined;
};

/** Remembers the sets this browser started, so a reload resumes one. */
export type SetStore = {
  load(setSeed: number): SetRecord | undefined;
  save(setSeed: number, record: SetRecord): void;
};

/** The storage members the store touches, so a test can stand a Map in for the browser's. */
type SetStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The storage key one set is remembered under. */
function setKey(setSeed: number): string {
  return `craft-tester:set:${(setSeed >>> 0).toString(36)}`;
}

/** Rebuilds a filter from a parsed value, leaving out a destination it stored none of. */
function toFilter(parsed: z.infer<typeof FilterSchema>): ScenarioFilter {
  const { time, config, destination } = parsed;
  return { time, config, ...(destination === undefined ? {} : { destination }) };
}

/** Reads one stored value as a set record, or `undefined` where it does not parse. */
function parseRecord(raw: string): SetRecord | undefined {
  const parsed = SetRecordSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) return undefined;
  const { filter, endedAt, ...rest } = parsed.data;
  return { ...rest, filter: toFilter(filter), endedAt: endedAt ?? undefined };
}

/**
 * Builds a set store over one storage.
 *
 * Resuming a set is a convenience, so every failure the storage can raise reads as "nothing
 * remembered", and a set whose record cannot be written still runs, only without resume.
 *
 * @param storage The storage to read and write, or `undefined` where the browser offers none.
 * @returns A store that loads `undefined` and saves nothing when the storage is missing or fails.
 */
export function createSetStore(storage: SetStorage | undefined): SetStore {
  return {
    load: (setSeed) => {
      try {
        const raw = storage?.getItem(setKey(setSeed)) ?? null;
        return raw === null ? undefined : parseRecord(raw);
      } catch {
        return undefined;
      }
    },
    save: (setSeed, record) => {
      try {
        const stored = { ...record, endedAt: record.endedAt ?? null };
        storage?.setItem(setKey(setSeed), JSON.stringify(stored));
      } catch {
        // A storage that refuses the write costs the set its resume, nothing more.
      }
    },
  };
}

/**
 * Builds the set store the page runs on.
 *
 * @returns A store over `localStorage`, or one that remembers nothing where reaching it throws.
 */
export function browserSetStore(): SetStore {
  try {
    return createSetStore(globalThis.localStorage);
  } catch {
    return createSetStore(undefined);
  }
}
