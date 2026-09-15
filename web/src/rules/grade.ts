import type { RouteTemplate, Sid } from '@/data/schema.ts';
import type { Grade, PlayerPicks, ResolvedClearance } from '@/rules/types.ts';

/** How many minutes each expect-clause pick stands for; `none` means no expect clause at all. */
const EXPECT_MINUTES: Record<PlayerPicks['expect'], number | null> = {
  ten_minutes: 10,
  three_minutes: 3,
  none: null,
};

/** Renders feet with thousands separators, e.g. `10000` as `10,000`. */
function formatFeet(feet: number): string {
  return String(feet).replace(/\B(?=(?:\d{3})+$)/g, ',');
}

/** How the results view names each route shape on its own, when the pick names no element. */
const ROUTE_PHRASES: Record<RouteTemplate, string> = {
  transition: 'transition',
  radar_vectors_fix: 'radar vectors',
  radar_vectors_airway: 'radar vectors to join',
  as_filed: 'then as filed',
};

/** Renders a route element the way the results view names it, e.g. `DEDHD transition`. */
export function routeLabel(route: ResolvedClearance['route']['value']): string {
  const { template, fix } = route;
  if (fix === undefined) return ROUTE_PHRASES[template];
  if (template === 'transition') return `${fix} transition`;
  if (template === 'as_filed') return `${fix}, then as filed`;
  return `${ROUTE_PHRASES[template]} ${fix}`;
}

/** Renders an altitude element, e.g. `climb via SID except maintain 10,000`. */
function altitudeLabel(altitude: ResolvedClearance['altitude']['value']): string {
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

/** Grades the SID by family, because AIRAC cycles bump the version in the id. */
function gradeSid(picks: PlayerPicks, expected: ResolvedClearance, sids: readonly Sid[]): Grade {
  const wanted = expected.sid.value;
  const picked = sids.find((sid) => sid.id === picks.sidId);
  const wantedSid = sids.find((sid) => sid.id === wanted.id);
  return {
    element: 'R.sid',
    ok: picked !== undefined && picked.family === wanted.family,
    expectedLabel: wantedSid?.chartName ?? wanted.id,
    actualLabel: picked?.chartName ?? 'unknown SID',
    citations: expected.sid.citations,
  };
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

/**
 * Grades a player's CRAFT entry element by element against the engine's clearance.
 *
 * @param picks What the player entered in the form.
 * @param expected The clearance the engine resolved for the same scenario.
 * @param sids Every published SID of the airport, used to map a picked id to its family and chart name.
 * @returns Exactly six verdicts, in the order C, R.sid, R.route, A.phrase, A.expect, F.
 */
export function grade(
  picks: PlayerPicks,
  expected: ResolvedClearance,
  sids: readonly Sid[],
): Grade[] {
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
      element: 'C',
      ok: picks.clearedTo === expected.clearedTo.value,
      expectedLabel: expected.clearedTo.value,
      actualLabel: picks.clearedTo,
      citations: expected.clearedTo.citations,
    },
    gradeSid(picks, expected, sids),
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
  ];
}
