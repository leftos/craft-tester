import type { AirportData, AltitudePhrase, RouteTemplate, Scenario } from '@/data/schema.ts';
import { isSidToken } from '@/rules/route.ts';
import type { PlayerPicks } from '@/rules/types.ts';

/** Every route shape the form offers, in the order the results view names them. */
const ROUTE_TEMPLATES: readonly RouteTemplate[] = [
  'transition',
  'radar_vectors_fix',
  'radar_vectors_airway',
  'as_filed',
];

/** Every altitude phrase the form offers. */
const ALTITUDE_PHRASES: readonly AltitudePhrase[] = ['climb_via', 'climb_via_except', 'maintain'];

/** Every expect clause the form offers, in the order it offers them. */
export const EXPECT_CHOICES: readonly PlayerPicks['expect'][] = [
  'ten_minutes',
  'five_minutes',
  'three_minutes',
  'none',
];

/** How many fixes of the filed route the route-fix dropdown offers as distractors. */
const FILED_FIXES_OFFERED = 3;

/** The deterministic dropdown lists the CRAFT form is built from. */
export type ClearanceOptions = {
  routeTemplates: RouteTemplate[];
  routeFixes: string[];
  altitudePhrases: AltitudePhrase[];
  altitudeFeet: number[];
  expect: PlayerPicks['expect'][];
  frequencies: string[];
  runways: string[];
};

/** Keeps the first occurrence of every value, so the lists stay stable and free of duplicates. */
function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** The filed route split into its tokens, with the empty strings of any stray spacing dropped. */
function routeTokens(scenario: Scenario): string[] {
  return scenario.filedRoute
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * The first few elements of the filed route after the procedure token, as route-fix distractors.
 *
 * An airway is kept, because a route that joins one straight off the SID is cleared on the airway
 * and the form has to offer it as the element to pick.
 */
function filedFixes(scenario: Scenario): string[] {
  const tokens = routeTokens(scenario);
  const first = tokens[0];
  const afterSid = first !== undefined && isSidToken(first) ? tokens.slice(1) : tokens;
  return afterSid.slice(0, FILED_FIXES_OFFERED);
}

/**
 * The transitions of the procedure the filed route names, which are the route elements on offer.
 *
 * A flight plan files the procedure the SOP assigns, so the leading token names it; a plan that
 * files no procedure token, or one the airport does not publish, contributes no transitions.
 */
function filedSidTransitions(scenario: Scenario, airport: AirportData): string[] {
  const first = routeTokens(scenario)[0];
  if (first === undefined || !isSidToken(first)) return [];
  const filed = airport.sids.find((sid) => sid.id === first);
  return (filed?.transitions ?? []).map((transition) => transition.fix);
}

/** Every altitude the field can issue: the interim rows, the published tops, and the filed one. */
function altitudeFeet(scenario: Scenario, airport: AirportData): number[] {
  const interim = airport.altitudeRules.flatMap((row) =>
    row.outcome.kind === 'interim' ? [row.outcome.feet] : [],
  );
  const published = airport.sids.flatMap((sid) =>
    sid.topAltitude.kind === 'published' ? [sid.topAltitude.feet] : [],
  );
  return unique([...interim, ...published, scenario.filedAltitude]).sort(
    (left, right) => left - right,
  );
}

/** Every runway the scenario's configuration departs, in the order the data lists its rows. */
function configuredRunways(scenario: Scenario, airport: AirportData): string[] {
  const config = airport.runwayConfigs.find((entry) => entry.id === scenario.runwayConfigId);
  return unique((config?.departureRunways ?? []).map((assignment) => assignment.runway));
}

/**
 * Builds the dropdown lists for one scenario, from the data alone and with no randomness.
 *
 * @param scenario The filed flight plan, which contributes the filed route and altitude.
 * @param airport The airport data.
 * @returns The options for every element of the CRAFT form.
 */
export function buildOptions(scenario: Scenario, airport: AirportData): ClearanceOptions {
  return {
    routeTemplates: [...ROUTE_TEMPLATES],
    routeFixes: unique([...filedSidTransitions(scenario, airport), ...filedFixes(scenario)]),
    altitudePhrases: [...ALTITUDE_PHRASES],
    altitudeFeet: altitudeFeet(scenario, airport),
    expect: [...EXPECT_CHOICES],
    frequencies: unique(airport.frequencies.map((frequency) => frequency.value)),
    runways: configuredRunways(scenario, airport),
  };
}
