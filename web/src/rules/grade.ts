import type { RouteTemplate } from '@/data/schema.ts';
import type { Grade, PlayerPicks, ResolvedClearance } from '@/rules/types.ts';

/** How many minutes each expect-clause pick stands for; `none` means no expect clause at all. */
const EXPECT_MINUTES: Record<PlayerPicks['expect'], number | null> = {
  ten_minutes: 10,
  three_minutes: 3,
  none: null,
};

/**
 * Renders feet with thousands separators, e.g. `10000` as `10,000`.
 *
 * @param feet The altitude in feet.
 * @returns The altitude as it is written on a strip or in a dropdown.
 */
export function formatFeet(feet: number): string {
  return String(feet).replace(/\B(?=(?:\d{3})+$)/g, ',');
}

/** How the results view names each route shape on its own, when the pick names no element. */
const ROUTE_PHRASES: Record<RouteTemplate, string> = {
  transition: 'transition',
  radar_vectors_fix: 'radar vectors',
  radar_vectors_airway: 'radar vectors to join',
  as_filed: 'then as filed',
};

/**
 * Renders a route element the way the results view names it, e.g. `DEDHD transition`.
 *
 * @param route The route shape and, where the clearance names one, the element it speaks.
 * @returns The label, which is the bare shape when the route names no element.
 */
export function routeLabel(route: ResolvedClearance['route']['value']): string {
  const { template, fix } = route;
  if (fix === undefined) return ROUTE_PHRASES[template];
  if (template === 'transition') return `${fix} transition`;
  if (template === 'as_filed') return `${fix}, then as filed`;
  return `${ROUTE_PHRASES[template]} ${fix}`;
}

/**
 * Renders an altitude element, e.g. `climb via SID except maintain 10,000`.
 *
 * @param altitude The altitude phrase and, where the phrase speaks one, the feet.
 * @returns The label, which is the bare phrase when no feet are spoken.
 */
export function altitudeLabel(altitude: ResolvedClearance['altitude']['value']): string {
  const { phrase, feet } = altitude;
  if (phrase === 'climb_via') return 'climb via SID';
  const suffix = feet === undefined ? '' : ` ${formatFeet(feet)}`;
  return phrase === 'maintain' ? `maintain${suffix}` : `climb via SID except maintain${suffix}`;
}

/** Renders an expect clause by its delay, or names its absence. */
function expectLabel(minutes: number | null): string {
  return minutes === null
    ? 'no expect altitude'
    : `expect filed altitude ${minutes} minutes after departure`;
}

/**
 * Renders an expect-clause choice the way the form and the results view name it.
 *
 * @param choice The expect clause the player picked, or `none` for no expect clause at all.
 * @returns The label, e.g. `expect filed altitude 10 minutes after departure`.
 */
export function expectChoiceLabel(choice: PlayerPicks['expect']): string {
  return expectLabel(EXPECT_MINUTES[choice]);
}

/**
 * The route element matches when the template matches and, where one is spoken, the element too.
 *
 * Every shape names an element now, "as filed" included, so the fix is always compared.
 */
function routeOk(picks: PlayerPicks, route: ResolvedClearance['route']['value']): boolean {
  return picks.routeTemplate === route.template && picks.routeFix === route.fix;
}

/** The altitude element matches when the phrase matches and, where one is spoken, the feet too. */
function altitudeOk(picks: PlayerPicks, altitude: ResolvedClearance['altitude']['value']): boolean {
  if (picks.altitudePhrase !== altitude.phrase) return false;
  if (altitude.phrase === 'climb_via') return true;
  return picks.altitudeFeet === altitude.feet;
}

/** Grades the expect clause on its delay alone; the altitude in it is the filed one, not a pick. */
function gradeExpect(picks: PlayerPicks, expected: ResolvedClearance): Grade {
  const picked = EXPECT_MINUTES[picks.expect];
  const wanted = expected.expect.value === null ? null : expected.expect.value.minutes;
  return {
    element: 'A.expect',
    ok: picked === wanted,
    expectedLabel: expectLabel(wanted),
    actualLabel: expectLabel(picked),
    citations: expected.expect.citations,
  };
}

/** Grades the runway on the bare runway the player expected, e.g. `01R`. */
function gradeRunway(picks: PlayerPicks, expected: ResolvedClearance): Grade {
  return {
    element: 'RWY',
    ok: picks.runway === expected.runway.value,
    expectedLabel: expected.runway.value,
    actualLabel: picks.runway,
    citations: expected.runway.citations,
  };
}

/**
 * Grades a player's CRAFT entry element by element against the engine's clearance.
 *
 * @param picks What the player entered in the form.
 * @param expected The clearance the engine resolved for the same scenario.
 * @returns Exactly five verdicts, in the order R.route, A.phrase, A.expect, F, RWY.
 */
export function grade(picks: PlayerPicks, expected: ResolvedClearance): Grade[] {
  const route = expected.route.value;
  const altitude = expected.altitude.value;
  const actualRoute =
    picks.routeFix === undefined
      ? { template: picks.routeTemplate }
      : { template: picks.routeTemplate, fix: picks.routeFix };
  const actualAltitude =
    picks.altitudeFeet === undefined
      ? { phrase: picks.altitudePhrase }
      : { phrase: picks.altitudePhrase, feet: picks.altitudeFeet };
  return [
    {
      element: 'R.route',
      ok: routeOk(picks, route),
      expectedLabel: routeLabel(route),
      actualLabel: routeLabel(actualRoute),
      citations: expected.route.citations,
    },
    {
      element: 'A.phrase',
      ok: altitudeOk(picks, altitude),
      expectedLabel: altitudeLabel(altitude),
      actualLabel: altitudeLabel(actualAltitude),
      citations: expected.altitude.citations,
    },
    gradeExpect(picks, expected),
    {
      element: 'F',
      ok: picks.frequency === expected.frequency.value.value,
      expectedLabel: expected.frequency.value.value,
      actualLabel: picks.frequency,
      citations: expected.frequency.citations,
    },
    gradeRunway(picks, expected),
  ];
}
