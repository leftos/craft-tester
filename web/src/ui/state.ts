import type { AirportData, AltitudePhrase, RouteTemplate } from '@/data/schema.ts';
import { AltitudePhraseSchema, RouteTemplateSchema } from '@/data/schema.ts';
import type { Box, BoxAnswer, BoxAnswers } from '@/rules/amend/grade.ts';
import type { PlayerPicks } from '@/rules/types.ts';
import type { Mode, ScenarioFilter } from '@/scenario/filter.ts';
import { hashFor } from '@/scenario/filter.ts';
import { buildScenario } from '@/ui/session.ts';
import type { ScenarioView } from '@/ui/session.ts';
import type { Attempt } from '@/ui/solved.ts';

/** Every expect clause the form offers, in the order it offers them. */
const EXPECT_CHOICES: readonly PlayerPicks['expect'][] = ['ten_minutes', 'three_minutes', 'none'];

/** One dropdown of the CRAFT form, named by the pick it sets. */
export type PickKey =
  | 'procedure'
  | 'routeTemplate'
  | 'routeFix'
  | 'altitudePhrase'
  | 'altitudeFeet'
  | 'expect'
  | 'frequency'
  | 'runway';

/**
 * What the player has picked so far; a dropdown nobody has touched is `undefined`.
 *
 * `procedure` is the identifier of a published SID, e.g. `TRUKN2`. Clearance mode is given the
 * procedure rather than picking it, so only amendment mode fills that pick in.
 */
export type DraftPicks = {
  procedure: string | undefined;
  routeTemplate: RouteTemplate | undefined;
  routeFix: string | undefined;
  altitudePhrase: AltitudePhrase | undefined;
  altitudeFeet: number | undefined;
  expect: PlayerPicks['expect'] | undefined;
  frequency: string | undefined;
  runway: string | undefined;
};

/** A form nobody has touched yet. */
export const EMPTY_PICKS: DraftPicks = {
  procedure: undefined,
  routeTemplate: undefined,
  routeFix: undefined,
  altitudePhrase: undefined,
  altitudeFeet: undefined,
  expect: undefined,
  frequency: undefined,
  runway: undefined,
};

/** The picks an amendment-mode clearance is graded on: the CRAFT picks and the procedure. */
export type AmendmentPicks = PlayerPicks & { procedure: string };

/** What the student has answered for each box of the strip; a box nobody answered is `undefined`. */
export type DraftBoxes = Record<Box, BoxAnswer | undefined>;

/** A strip nobody has answered yet. */
export const EMPTY_BOXES: DraftBoxes = {
  type: undefined,
  altitude: undefined,
  route: undefined,
};

/** Everything the page holds between renders. */
export type AppState = {
  airport: AirportData;
  seed: number;
  /** What the player has narrowed the draw to; the URL hash carries it beside the seed. */
  filter: ScenarioFilter;
  /** Which half the session trains; the URL hash carries it beside the seed and the filter. */
  mode: Mode;
  view: ScenarioView;
  picks: DraftPicks;
  /** What the student has answered for the strip boxes, which amendment mode grades first. */
  boxes: DraftBoxes;
  /** Whether the box answers are in; the CRAFT form clears the corrected plan once they are. */
  boxesSubmitted: boolean;
  submitted: boolean;
  /** The attempt an earlier answer at this seed and mode submitted, where the browser remembers one. */
  revisit: Attempt | undefined;
};

/** The empty option of a dropdown reads back as the empty string, which is no pick at all. */
function text(raw: string): string | undefined {
  return raw.length === 0 ? undefined : raw;
}

/** Reads an altitude dropdown, whose options are feet written without a separator. */
function feet(raw: string): number | undefined {
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** Reads a route-shape dropdown, ignoring a value the schema does not know. */
function routeTemplate(raw: string): RouteTemplate | undefined {
  const parsed = RouteTemplateSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Reads an altitude-phrase dropdown, ignoring a value the schema does not know. */
function altitudePhrase(raw: string): AltitudePhrase | undefined {
  const parsed = AltitudePhraseSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Reads an expect-clause dropdown, ignoring a value the form does not offer. */
function expect(raw: string): PlayerPicks['expect'] | undefined {
  return EXPECT_CHOICES.find((choice) => choice === raw);
}

/**
 * How each dropdown changes the picks, including the picks its change invalidates.
 *
 * Picking "climb via SID" clears the feet, because that phrase speaks none.
 */
const SETTERS: Record<PickKey, (picks: DraftPicks, raw: string) => DraftPicks> = {
  procedure: (picks, raw) => ({ ...picks, procedure: text(raw) }),
  routeTemplate: (picks, raw) => ({ ...picks, routeTemplate: routeTemplate(raw) }),
  routeFix: (picks, raw) => ({ ...picks, routeFix: text(raw) }),
  altitudePhrase: (picks, raw) => {
    const phrase = altitudePhrase(raw);
    return {
      ...picks,
      altitudePhrase: phrase,
      altitudeFeet: phrase === 'climb_via' ? undefined : picks.altitudeFeet,
    };
  },
  altitudeFeet: (picks, raw) => ({ ...picks, altitudeFeet: feet(raw) }),
  expect: (picks, raw) => ({ ...picks, expect: expect(raw) }),
  frequency: (picks, raw) => ({ ...picks, frequency: text(raw) }),
  runway: (picks, raw) => ({ ...picks, runway: text(raw) }),
};

/**
 * Applies one dropdown change.
 *
 * @param picks The picks before the change.
 * @param key The dropdown that changed.
 * @param raw The value the dropdown now reads, empty when the player chose its blank option.
 * @returns The picks after the change, with any pick the change invalidated cleared.
 */
export function applyPick(picks: DraftPicks, key: PickKey, raw: string): DraftPicks {
  return SETTERS[key](picks, raw);
}

/** The dropdowns every clearance needs, whatever the route shape and the altitude phrase. */
const ALWAYS_REQUIRED = [
  'routeTemplate',
  'routeFix',
  'altitudePhrase',
  'expect',
  'frequency',
  'runway',
] as const;

/** The picks once every dropdown but the feet has a value. */
type FilledPicks = DraftPicks & {
  [K in (typeof ALWAYS_REQUIRED)[number]]: NonNullable<DraftPicks[K]>;
};

/** Whether every dropdown but the feet has a value; the feet depend on the phrase. */
function isFilled(picks: DraftPicks): picks is FilledPicks {
  return ALWAYS_REQUIRED.every((key) => picks[key] !== undefined);
}

/**
 * Turns the form's picks into a gradable clearance, once the player has made every pick it needs.
 *
 * Every route shape names the element the flight leaves the terminal on, so the route element is
 * always required; the feet are required by every altitude phrase except "climb via SID".
 *
 * @param picks What the player has picked so far.
 * @returns The picks to grade, or `undefined` while a required dropdown is still blank.
 */
export function toPlayerPicks(picks: DraftPicks): PlayerPicks | undefined {
  if (!isFilled(picks)) return undefined;
  const altitudeFeet = picks.altitudePhrase === 'climb_via' ? undefined : picks.altitudeFeet;
  if (picks.altitudePhrase !== 'climb_via' && altitudeFeet === undefined) return undefined;
  return {
    routeTemplate: picks.routeTemplate,
    routeFix: picks.routeFix,
    altitudePhrase: picks.altitudePhrase,
    expect: picks.expect,
    frequency: picks.frequency,
    runway: picks.runway,
    ...(altitudeFeet === undefined ? {} : { altitudeFeet }),
  };
}

/**
 * Turns the form's picks into a gradable amendment-mode clearance.
 *
 * Amendment mode clears a plan the student corrected, so the procedure is picked rather than given
 * and is required on top of everything an ordinary clearance needs.
 *
 * @param picks What the player has picked so far.
 * @returns The picks to grade, or `undefined` while a required dropdown is still blank.
 */
export function toAmendmentPicks(picks: DraftPicks): AmendmentPicks | undefined {
  const player = toPlayerPicks(picks);
  if (player === undefined || picks.procedure === undefined) return undefined;
  return { ...player, procedure: picks.procedure };
}

/**
 * Applies one box answer.
 *
 * @param boxes The answers before the change.
 * @param box The box the student answered.
 * @param answer What the student did with it: left it as filed, or wrote a new value in it.
 * @returns The answers after the change.
 */
export function applyBoxAnswer(boxes: DraftBoxes, box: Box, answer: BoxAnswer): DraftBoxes {
  return { ...boxes, [box]: answer };
}

/** Whether one box is answered: left as filed, or amended to something more than whitespace. */
function answered(answer: BoxAnswer | undefined): answer is BoxAnswer {
  if (answer === undefined) return false;
  return answer.kind === 'as_filed' || answer.value.trim().length > 0;
}

/**
 * Turns the strip's answers into gradable ones, once the student has answered every box.
 *
 * @param boxes What the student has answered so far.
 * @returns The answers to grade, or `undefined` while a box is unanswered or amended to nothing.
 */
export function toBoxAnswers(boxes: DraftBoxes): BoxAnswers | undefined {
  const { type, altitude, route } = boxes;
  if (!answered(type) || !answered(altitude) || !answered(route)) return undefined;
  return { type, altitude, route };
}

/**
 * Starts a session on one airport and seed, with an untouched strip and form.
 *
 * @param airport The airport data.
 * @param seed The scenario seed.
 * @param previous The attempt an earlier answer at this seed and mode submitted, or `undefined`.
 * @param filter The time of day and runway configurations the draw is narrowed to.
 * @param mode Which half the session trains.
 * @returns The state the page renders from.
 */
export function newSession(
  airport: AirportData,
  seed: number,
  previous: Attempt | undefined,
  filter: ScenarioFilter,
  mode: Mode,
): AppState {
  return {
    airport,
    seed,
    filter,
    mode,
    view: buildScenario(airport, seed, filter),
    picks: EMPTY_PICKS,
    boxes: EMPTY_BOXES,
    boxesSubmitted: false,
    submitted: false,
    revisit: previous,
  };
}

/**
 * Draws a fresh scenario on the same airport under a filter the player just changed.
 *
 * The filter narrows which scenarios exist, so the seed on screen means something else under it;
 * the caller draws a new one rather than showing the same seed under two filters.
 *
 * @param state The state before the change.
 * @param filter The filter the player now asks for.
 * @param seed The seed of the fresh scenario, which the caller draws.
 * @param previous The attempt an earlier answer at that seed and mode submitted, or `undefined`.
 * @returns A new session on the same airport and in the same mode, with an untouched form.
 */
export function withFilter(
  state: AppState,
  filter: ScenarioFilter,
  seed: number,
  previous: Attempt | undefined,
): AppState {
  return newSession(state.airport, seed, previous, filter, state.mode);
}

/**
 * Starts a session in the other half of the trainer, on a fresh scenario.
 *
 * A mode trains a different plan — clearance mode draws one that is already correct — so the seed
 * on screen means something else under the other mode; the caller draws a new one, as it does for
 * a change of filter.
 *
 * @param state The state before the change.
 * @param mode The half the player now asks for.
 * @param seed The seed of the fresh scenario, which the caller draws.
 * @param previous The attempt an earlier answer at that seed and mode submitted, or `undefined`.
 * @returns A new session on the same airport under the same filter, with an untouched form.
 */
export function withMode(
  state: AppState,
  mode: Mode,
  seed: number,
  previous: Attempt | undefined,
): AppState {
  return newSession(state.airport, seed, previous, state.filter, mode);
}

/**
 * Answers this scenario again, from a revisit or from the results of the attempt just submitted.
 *
 * @param state The state before the retry.
 * @returns The same scenario with an untouched strip and form, and nothing revealed.
 */
export function withRetry(state: AppState): AppState {
  return {
    ...state,
    revisit: undefined,
    picks: EMPTY_PICKS,
    boxes: EMPTY_BOXES,
    boxesSubmitted: false,
    submitted: false,
  };
}

/**
 * Applies one dropdown change to the session.
 *
 * @param state The state before the change.
 * @param key The dropdown that changed.
 * @param raw The value the dropdown now reads.
 * @returns The state after the change; a submitted form takes no further picks.
 */
export function withPick(state: AppState, key: PickKey, raw: string): AppState {
  if (state.submitted) return state;
  return { ...state, picks: applyPick(state.picks, key, raw) };
}

/**
 * Answers one box of the strip.
 *
 * @param state The state before the answer.
 * @param box The box the student answered.
 * @param answer What the student did with it.
 * @returns The state after the answer; a submitted strip takes no further answers.
 */
export function withBox(state: AppState, box: Box, answer: BoxAnswer): AppState {
  if (state.boxesSubmitted) return state;
  return { ...state, boxes: applyBoxAnswer(state.boxes, box, answer) };
}

/**
 * Submits the strip, which is refused while a box is unanswered or amended to nothing.
 *
 * The corrected plan settles which procedure the clearance now carries, so the caller resolves it
 * and hands the identifier over; the form opens on that pick rather than on a blank one.
 *
 * @param state The state before the submission.
 * @param procedure The SID the corrected plan files, or `undefined` where it files none.
 * @returns The state with the strip submitted, or the same state when a box is still open.
 */
export function withBoxesSubmitted(state: AppState, procedure: string | undefined): AppState {
  if (toBoxAnswers(state.boxes) === undefined) return state;
  return { ...state, boxesSubmitted: true, picks: { ...state.picks, procedure } };
}

/**
 * Submits the form, which is refused while a required dropdown is still blank.
 *
 * Amendment mode grades the picked procedure too, and clears a plan the student has already
 * corrected, so it is refused while the procedure is blank or the strip is still open.
 *
 * @param state The state before the submission.
 * @returns The state with the form submitted, or the same state when the form is incomplete.
 */
export function withSubmitted(state: AppState): AppState {
  if (state.mode === 'amendment') {
    if (!state.boxesSubmitted || toAmendmentPicks(state.picks) === undefined) return state;
    return { ...state, submitted: true };
  }
  if (toPlayerPicks(state.picks) === undefined) return state;
  return { ...state, submitted: true };
}

/**
 * Renders the link that shares the scenario on screen.
 *
 * @param href The page's current URL.
 * @param seed The seed the link restores.
 * @param filter The filter the link restores with it, so the seed draws the same scenario.
 * @param mode The half of the trainer the link opens in.
 * @returns The same URL with the seed, the filter and the mode in its hash.
 */
export function shareLink(href: string, seed: number, filter: ScenarioFilter, mode: Mode): string {
  const url = new URL(href);
  url.hash = hashFor(seed, filter, mode);
  return url.toString();
}
