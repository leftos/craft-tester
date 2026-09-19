import type { AirportData, AltitudePhrase, RouteTemplate } from '@/data/schema.ts';
import { AltitudePhraseSchema, RouteTemplateSchema } from '@/data/schema.ts';
import type { Box, BoxAnswer, BoxAnswers } from '@/rules/amend/grade.ts';
import { EXPECT_CHOICES } from '@/rules/options.ts';
import type { RouteReading } from '@/rules/text/grade.ts';
import type { PlayerPicks } from '@/rules/types.ts';
import type { InputKind, Mode, ScenarioFilter, SessionSettings } from '@/scenario/filter.ts';
import { hashFor } from '@/scenario/filter.ts';
import { buildScenario } from '@/ui/session.ts';
import type { ScenarioView } from '@/ui/session.ts';
import type { Attempt } from '@/ui/solved.ts';

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
 * `procedure` is the identifier of a published SID, e.g. `TRUKN2`, or what `headingPick` writes,
 * e.g. `heading:runway`, where the plan is one the SOP sends off on a heading with no procedure at
 * all. Clearance mode is given the procedure rather than picking it, so only amendment mode fills
 * that pick in.
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
  /** How the student answers the clearance; the URL hash carries it beside the mode. */
  input: InputKind;
  /**
   * Whether the student is held to the route read to its end, as a full route clearance takes; the
   * URL hash carries it beside the input kind. Only a typed answer can be held to it.
   */
  fullRoute: boolean;
  view: ScenarioView;
  picks: DraftPicks;
  /** The clearance typed so far, exactly as typed; only typed answers read it. */
  text: string;
  /** What the student has answered for the strip boxes, which amendment mode grades first. */
  boxes: DraftBoxes;
  /** Whether the box answers are in; the CRAFT form clears the corrected plan once they are. */
  boxesSubmitted: boolean;
  submitted: boolean;
  /**
   * The attempt an earlier answer at this seed, mode and input kind submitted, where the browser
   * remembers one.
   */
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
 * Whether a route shape names the fix or airway the flight leaves the terminal on.
 *
 * Every shape does but "radar vectors direct", which vectors the flight straight to the destination.
 *
 * @param template The route shape picked, or `undefined` while none is.
 * @returns False for the vectors-direct shape, true for every other shape and for no pick at all.
 */
export function templateNamesFix(template: RouteTemplate | undefined): boolean {
  return template !== 'radar_vectors_direct';
}

/**
 * How each dropdown changes the picks, including the picks its change invalidates.
 *
 * Picking "climb via SID" clears the feet, because that phrase speaks none, and picking "radar
 * vectors direct" clears the fix, because that shape names none.
 */
const SETTERS: Record<PickKey, (picks: DraftPicks, raw: string) => DraftPicks> = {
  procedure: (picks, raw) => ({ ...picks, procedure: text(raw) }),
  routeTemplate: (picks, raw) => {
    const template = routeTemplate(raw);
    return {
      ...picks,
      routeTemplate: template,
      routeFix: templateNamesFix(template) ? picks.routeFix : undefined,
    };
  },
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
  'altitudePhrase',
  'expect',
  'frequency',
  'runway',
] as const;

/** The picks once every dropdown but the route element and the feet has a value. */
type FilledPicks = DraftPicks & {
  [K in (typeof ALWAYS_REQUIRED)[number]]: NonNullable<DraftPicks[K]>;
};

/** Whether every dropdown but the route element and the feet has a value; those depend on a shape. */
function isFilled(picks: DraftPicks): picks is FilledPicks {
  return ALWAYS_REQUIRED.every((key) => picks[key] !== undefined);
}

/**
 * Turns the form's picks into a gradable clearance, once the player has made every pick it needs.
 *
 * Every route shape but "radar vectors direct" names the element the flight leaves the terminal on,
 * so the route element is required by all of them; the feet are required by every altitude phrase
 * except "climb via SID".
 *
 * @param picks What the player has picked so far.
 * @returns The picks to grade, or `undefined` while a required dropdown is still blank.
 */
export function toPlayerPicks(picks: DraftPicks): PlayerPicks | undefined {
  if (!isFilled(picks)) return undefined;
  const routeFix = templateNamesFix(picks.routeTemplate) ? picks.routeFix : undefined;
  if (templateNamesFix(picks.routeTemplate) && routeFix === undefined) return undefined;
  const altitudeFeet = picks.altitudePhrase === 'climb_via' ? undefined : picks.altitudeFeet;
  if (picks.altitudePhrase !== 'climb_via' && altitudeFeet === undefined) return undefined;
  return {
    routeTemplate: picks.routeTemplate,
    ...(routeFix === undefined ? {} : { routeFix }),
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

/** How the CRAFT half of an attempt was answered: the dropdown picks, or the clearance typed out. */
export type ClearanceAnswer<P> = { input: 'dropdowns'; picks: P } | { input: 'text'; text: string };

/** The typed answer, once there is more than whitespace to grade. */
function typedAnswer(text: string): { input: 'text'; text: string } | undefined {
  return text.trim().length === 0 ? undefined : { input: 'text', text };
}

/**
 * Turns a clearance session's answer into a gradable one, whichever way the student gives it.
 *
 * @param state The session so far.
 * @returns The dropdown picks once every required one is made, or the typed clearance exactly as
 *   typed once it is more than whitespace; `undefined` until then.
 */
export function toClearanceAnswer(state: AppState): ClearanceAnswer<PlayerPicks> | undefined {
  if (state.input === 'text') return typedAnswer(state.text);
  const picks = toPlayerPicks(state.picks);
  return picks === undefined ? undefined : { input: 'dropdowns', picks };
}

/**
 * Turns an amendment session's clearance into a gradable one, whichever way the student gives it.
 *
 * A typed clearance speaks the procedure itself, so it needs no procedure pick.
 *
 * @param state The session so far.
 * @returns The dropdown picks once every required one is made, the procedure among them, or the
 *   typed clearance exactly as typed once it is more than whitespace; `undefined` until then.
 */
export function toAmendmentAnswer(state: AppState): ClearanceAnswer<AmendmentPicks> | undefined {
  if (state.input === 'text') return typedAnswer(state.text);
  const picks = toAmendmentPicks(state.picks);
  return picks === undefined ? undefined : { input: 'dropdowns', picks };
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
 * @param previous The attempt an earlier answer at this seed, mode and input kind submitted, or
 *   `undefined`.
 * @param settings The time of day and runway configurations the draw is narrowed to, the half the
 *   session trains, how the student answers the clearance, and the reading they are held to.
 * @returns The state the page renders from.
 */
export function newSession(
  airport: AirportData,
  seed: number,
  previous: Attempt | undefined,
  settings: SessionSettings,
): AppState {
  const { filter, mode, input, fullRoute } = settings;
  return {
    airport,
    seed,
    filter,
    mode,
    input,
    fullRoute,
    view: buildScenario(airport, seed, filter, mode),
    picks: EMPTY_PICKS,
    text: '',
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
 * @param previous The attempt an earlier answer at that seed, mode and input kind submitted, or
 *   `undefined`.
 * @returns A new session on the same airport, in the same mode and answered the same way, with an
 *   untouched form.
 */
export function withFilter(
  state: AppState,
  filter: ScenarioFilter,
  seed: number,
  previous: Attempt | undefined,
): AppState {
  return newSession(state.airport, seed, previous, {
    filter,
    mode: state.mode,
    input: state.input,
    fullRoute: state.fullRoute,
  });
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
 * @param previous The attempt an earlier answer at that seed, mode and input kind submitted, or
 *   `undefined`.
 * @returns A new session on the same airport under the same filter and answered the same way, with
 *   an untouched form.
 */
export function withMode(
  state: AppState,
  mode: Mode,
  seed: number,
  previous: Attempt | undefined,
): AppState {
  return newSession(state.airport, seed, previous, {
    filter: state.filter,
    mode,
    input: state.input,
    fullRoute: state.fullRoute,
  });
}

/**
 * Answers the scenario on screen the other way: typed out instead of picked, or the reverse.
 *
 * The input kind changes how the clearance is answered, not which scenario is drawn, so the seed and
 * the scenario stay; only the clearance answer starts again. Where the browser remembers no attempt
 * at this seed in the new input kind, the strip answers carry over, so a student who has answered
 * the strip can switch how they read the clearance, and so does the procedure the submitted strip
 * opened the form on, so switching back to the dropdowns finds it picked again. Where it remembers
 * one, the strip and every pick start again too and the earlier attempt is shown back, as it is on
 * any seed that was answered before.
 *
 * @param state The state before the switch.
 * @param input How the student now answers the clearance.
 * @param previous The attempt an earlier answer at this seed and mode submitted in the new input
 *   kind, or `undefined`.
 * @returns The same scenario answered the new way, with an untouched clearance answer but for the
 *   procedure a carried-over strip settled.
 */
export function withInputKind(
  state: AppState,
  input: InputKind,
  previous: Attempt | undefined,
): AppState {
  const carried =
    previous === undefined
      ? {
          boxes: state.boxes,
          boxesSubmitted: state.boxesSubmitted,
          picks: { ...EMPTY_PICKS, procedure: state.picks.procedure },
        }
      : { boxes: EMPTY_BOXES, boxesSubmitted: false, picks: EMPTY_PICKS };
  return {
    ...state,
    ...carried,
    input,
    fullRoute: input === 'text' && state.fullRoute,
    text: '',
    submitted: false,
    revisit: previous,
  };
}

/**
 * Holds the scenario on screen to the route read to its end, or lets it back to the reading spoken
 * on frequency.
 *
 * Only a typed clearance knows a full reading, so ticking the box while the dropdowns are up answers
 * the scenario by typing instead, exactly as a switch of input kind does. The two readings grade the
 * same words differently, so an attempt the browser remembers under the new reading is shown back
 * and the clearance answer starts again; where it remembers none, the clearance typed so far stays,
 * because the box changes what those words are held to rather than asking a new question.
 *
 * @param state The state before the change.
 * @param fullRoute Whether the student is now held to the full route.
 * @param previous The attempt an earlier answer at this seed and mode submitted under the reading
 *   now asked for, or `undefined`.
 * @returns The same scenario answered by typing, held to the reading asked for.
 */
export function withFullRoute(
  state: AppState,
  fullRoute: boolean,
  previous: Attempt | undefined,
): AppState {
  const typed = withInputKind(state, 'text', previous);
  const keepsText = previous === undefined && state.input === 'text';
  return { ...typed, fullRoute, text: keepsText ? state.text : '' };
}

/** The reading a typed clearance is graded against: the route read to its end, or the one spoken. */
export function routeReadingOf(state: AppState): RouteReading {
  return state.fullRoute ? 'full' : 'abbreviated';
}

/**
 * Answers this scenario again, from a revisit or from the results of the attempt just submitted.
 *
 * @param state The state before the retry.
 * @returns The same scenario with an untouched strip, form and typed clearance, and nothing
 *   revealed.
 */
export function withRetry(state: AppState): AppState {
  return {
    ...state,
    revisit: undefined,
    picks: EMPTY_PICKS,
    text: '',
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
 * Writes the clearance typed so far into the session.
 *
 * @param state The state before the keystroke.
 * @param text Everything the typing box now holds, exactly as typed.
 * @returns The state after the keystroke; a submitted clearance takes no further typing.
 */
export function withText(state: AppState, text: string): AppState {
  if (state.submitted) return state;
  return { ...state, text };
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
 * Submits the clearance, which is refused while a required dropdown is still blank or, for a typed
 * answer, while nothing but whitespace is typed.
 *
 * Amendment mode grades the picked procedure too, and clears a plan the student has already
 * corrected, so it is refused while the procedure is blank or the strip is still open.
 *
 * @param state The state before the submission.
 * @returns The state with the clearance submitted, or the same state when it is incomplete.
 */
export function withSubmitted(state: AppState): AppState {
  if (state.mode === 'amendment') {
    if (!state.boxesSubmitted || toAmendmentAnswer(state) === undefined) return state;
    return { ...state, submitted: true };
  }
  if (toClearanceAnswer(state) === undefined) return state;
  return { ...state, submitted: true };
}

/**
 * Which panel set the page is on.
 *
 * Clearance mode shows the earlier attempt, the results, or the form; amendment mode answers the
 * strip first and clears the corrected plan afterwards, and a seed the engine cannot clear shows
 * the reasons instead of any of them.
 */
export type Phase =
  | 'unresolved'
  | 'clearance-revisit'
  | 'clearance-results'
  | 'clearance-form'
  | 'amendment-revisit'
  | 'amending'
  | 'clearing'
  | 'amendment-results';

/** The phase an amendment session is in, which answers the strip before it reads the clearance. */
function amendmentPhase(state: AppState): Phase {
  if (state.revisit?.kind === 'amendment' && !state.submitted) return 'amendment-revisit';
  if (!state.boxesSubmitted || toBoxAnswers(state.boxes) === undefined) return 'amending';
  if (!state.submitted || toAmendmentAnswer(state) === undefined) return 'clearing';
  return 'amendment-results';
}

/** The phase a clearance session is in: the earlier attempt, the results, or the form. */
function clearancePhase(state: AppState): Phase {
  if (state.revisit?.kind === 'clearance' && !state.submitted) return 'clearance-revisit';
  if (state.submitted && toClearanceAnswer(state) !== undefined) return 'clearance-results';
  return 'clearance-form';
}

/**
 * Which panel set the state renders, which the panels dispatch on and the view key is built from.
 *
 * @param state The state the page renders from.
 * @returns The phase the state is in.
 */
export function phaseOf(state: AppState): Phase {
  if (state.view.kind === 'unresolved') return 'unresolved';
  return state.view.kind === 'amendment' ? amendmentPhase(state) : clearancePhase(state);
}

/**
 * Identity of the panel set on screen: panels are rebuilt when it changes and synced when it does not.
 *
 * Everything the panels are built from is either in the key or held constant by it: the scenario
 * comes from the airport, the seed, the filter and the mode, the input kind decides whether the
 * clearance is picked or typed, the full route flag decides which reading grades it, and the hash
 * that shares it names all six, so the panels answer to nothing else while the key holds. What
 * varies under one key is the form's picks, the typed clearance and the strip's answers, which the
 * panels write into the controls they already built.
 *
 * @param state The state the page renders from.
 * @returns The key; two states that render the same panel set share it.
 */
export function viewKey(state: AppState): string {
  const hash = hashFor(state.airport.airport.icao, state.seed, state);
  return `${hash}|${phaseOf(state)}`;
}

/**
 * Renders the link that shares the scenario on screen.
 *
 * @param href The page's current URL.
 * @param icao The airport the scenario was drawn at, which the link reopens.
 * @param seed The seed the link restores.
 * @param settings The filter the link restores with it, so the seed draws the same scenario, the
 *   half of the trainer it opens in, and how the clearance is answered there.
 * @returns The same URL with the airport, the seed and the settings in its hash.
 */
export function shareLink(
  href: string,
  icao: string,
  seed: number,
  settings: SessionSettings,
): string {
  const url = new URL(href);
  url.hash = hashFor(icao, seed, settings);
  return url.toString();
}
