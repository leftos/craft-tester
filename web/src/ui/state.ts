import type { AirportData, AltitudePhrase, RouteTemplate } from '@/data/schema.ts';
import { AltitudePhraseSchema, RouteTemplateSchema } from '@/data/schema.ts';
import type { PlayerPicks } from '@/rules/types.ts';
import type { ScenarioFilter } from '@/scenario/filter.ts';
import { hashFor } from '@/scenario/filter.ts';
import { buildScenario } from '@/ui/session.ts';
import type { ScenarioView } from '@/ui/session.ts';

/** Every expect clause the form offers, in the order it offers them. */
const EXPECT_CHOICES: readonly PlayerPicks['expect'][] = ['ten_minutes', 'three_minutes', 'none'];

/** One dropdown of the CRAFT form, named by the pick it sets. */
export type PickKey =
  | 'sidId'
  | 'routeTemplate'
  | 'routeFix'
  | 'altitudePhrase'
  | 'altitudeFeet'
  | 'expect'
  | 'frequency'
  | 'runway';

/** What the player has picked so far; a dropdown nobody has touched is `undefined`. */
export type DraftPicks = {
  sidId: string | undefined;
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
  sidId: undefined,
  routeTemplate: undefined,
  routeFix: undefined,
  altitudePhrase: undefined,
  altitudeFeet: undefined,
  expect: undefined,
  frequency: undefined,
  runway: undefined,
};

/** Everything the page holds between renders. */
export type AppState = {
  airport: AirportData;
  seed: number;
  /** What the player has narrowed the draw to; the URL hash carries it beside the seed. */
  filter: ScenarioFilter;
  view: ScenarioView;
  picks: DraftPicks;
  submitted: boolean;
  /** The clearance an earlier attempt at this seed submitted, where this browser remembers one. */
  revisit: PlayerPicks | undefined;
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
 * Changing the procedure clears the route element, because the elements on offer are that
 * procedure's transitions; picking "climb via SID" clears the feet, because that phrase speaks none.
 */
const SETTERS: Record<PickKey, (picks: DraftPicks, raw: string) => DraftPicks> = {
  sidId: (picks, raw) => ({ ...picks, sidId: text(raw), routeFix: undefined }),
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
  'sidId',
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
    sidId: picks.sidId,
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
 * Starts a session on one airport and seed, with an untouched form.
 *
 * @param airport The airport data.
 * @param seed The scenario seed.
 * @param previous The clearance an earlier attempt at this seed submitted, or `undefined`.
 * @param filter The time of day and runway configurations the draw is narrowed to.
 * @returns The state the page renders from.
 */
export function newSession(
  airport: AirportData,
  seed: number,
  previous: PlayerPicks | undefined,
  filter: ScenarioFilter,
): AppState {
  return {
    airport,
    seed,
    filter,
    view: buildScenario(airport, seed, filter),
    picks: EMPTY_PICKS,
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
 * @param previous The clearance an earlier attempt at that seed submitted, or `undefined`.
 * @returns A new session on the same airport, with an untouched form.
 */
export function withFilter(
  state: AppState,
  filter: ScenarioFilter,
  seed: number,
  previous: PlayerPicks | undefined,
): AppState {
  return newSession(state.airport, seed, previous, filter);
}

/**
 * Answers this scenario again, from a revisit or from the results of the attempt just submitted.
 *
 * @param state The state before the retry.
 * @returns The same scenario with an untouched form and nothing revealed.
 */
export function withRetry(state: AppState): AppState {
  return { ...state, revisit: undefined, picks: EMPTY_PICKS, submitted: false };
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
 * Submits the form, which is refused while a required dropdown is still blank.
 *
 * @param state The state before the submission.
 * @returns The state with the form submitted, or the same state when the form is incomplete.
 */
export function withSubmitted(state: AppState): AppState {
  if (toPlayerPicks(state.picks) === undefined) return state;
  return { ...state, submitted: true };
}

/**
 * Renders the link that shares the scenario on screen.
 *
 * @param href The page's current URL.
 * @param seed The seed the link restores.
 * @param filter The filter the link restores with it, so the seed draws the same scenario.
 * @returns The same URL with the seed and the filter in its hash.
 */
export function shareLink(href: string, seed: number, filter: ScenarioFilter): string {
  const url = new URL(href);
  url.hash = hashFor(seed, filter);
  return url.toString();
}
