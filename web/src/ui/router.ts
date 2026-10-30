import type { Mode } from '@/scenario/filter.ts';
import { MAX_SET_MINUTES, MAX_SET_STRIPS, parseSetSeed } from '@/scenario/filter.ts';

/**
 * What a URL hash opens.
 *
 * `query` is the `&`-separated settings after the path's `?`, kept verbatim for the hash readers in
 * `filter.ts`. `strip` is every hash that does not start with `#/`: the `#s=…` links the trainer
 * writes, which open a strip as they always have. `tutorial` is one part of the guided tour.
 */
export type Route =
  | { kind: 'home' }
  | { kind: 'practice'; icao: string; mode: Mode; query: string }
  | { kind: 'newTest'; icao: string; mode: Mode; n: number; minutes: number; query: string }
  | { kind: 'continueTest'; icao: string; mode: Mode; setSeed: number }
  | { kind: 'tutorial'; part: TutorialPart }
  | { kind: 'strip' };

/** The parts of the guided tour that have a route: clearance first, then Amend. */
export const TUTORIAL_PART_NAMES = ['clearance', 'amend'] as const;

/** One part of the guided tour that has a route. */
export type TutorialPart = (typeof TUTORIAL_PART_NAMES)[number];

/** The path each tutorial part is written as after `#/`. */
const TUTORIAL_PATHS: Readonly<Record<TutorialPart, string>> = {
  clearance: 'tutorial',
  amend: 'tutorial/amend',
};

/** A route that has an `#/…` link of its own. */
export type PageRoute = Exclude<Route, { kind: 'strip' }>;

/** The route every hash this module cannot read opens. */
const HOME: Route = { kind: 'home' };

/** The shape an airport segment has to have once upper-cased: a four-letter ICAO code. */
const ICAO_PATTERN = /^[A-Z]{4}$/;

/** The test spec a new set is started from: the strip count, `x`, and the minutes (0 is untimed). */
const NEW_TEST_SPEC = /^(\d{1,2})x(\d{1,3})$/;

/** The path segment each mode is written as. */
const MODE_SEGMENTS: Readonly<Record<Mode, string>> = {
  clearance: 'clearance',
  amendment: 'amend',
};

/** Reads a mode segment, or `undefined` for anything but `clearance` and `amend`. */
function modeOf(segment: string): Mode | undefined {
  if (segment === 'clearance') return 'clearance';
  return segment === 'amend' ? 'amendment' : undefined;
}

/** Reads a test spec: a new set's count and minutes, a set seed to continue, or home. */
function testRoute(icao: string, mode: Mode, rawSpec: string, query: string): Route {
  const spec = rawSpec.toLowerCase();
  const match = NEW_TEST_SPEC.exec(spec);
  if (match !== null) {
    const n = Number.parseInt(match[1] ?? '', 10);
    const minutes = Number.parseInt(match[2] ?? '', 10);
    const inRange = n >= 1 && n <= MAX_SET_STRIPS && minutes <= MAX_SET_MINUTES;
    return inRange ? { kind: 'newTest', icao, mode, n, minutes, query } : HOME;
  }
  const setSeed = parseSetSeed(spec);
  return setSeed === undefined ? HOME : { kind: 'continueTest', icao, mode, setSeed };
}

/**
 * Reads the path after `#/`: `tutorial` or `tutorial/amend`, `<ICAO>/<mode>/practice`, or
 * `<ICAO>/<mode>/test/<spec>`.
 */
function pathRoute(path: string, query: string): Route {
  if (path === TUTORIAL_PATHS.clearance) return { kind: 'tutorial', part: 'clearance' };
  if (path === TUTORIAL_PATHS.amend) return { kind: 'tutorial', part: 'amend' };
  const segments = path.split('/');
  const [rawIcao = '', rawMode = '', format, spec] = segments;
  const icao = rawIcao.toUpperCase();
  const mode = modeOf(rawMode);
  if (!ICAO_PATTERN.test(icao) || mode === undefined) return HOME;
  if (segments.length === 3 && format === 'practice') {
    return { kind: 'practice', icao, mode, query };
  }
  if (segments.length === 4 && format === 'test' && spec !== undefined) {
    return testRoute(icao, mode, spec, query);
  }
  return HOME;
}

/**
 * Reads the route a URL hash opens.
 *
 * An empty hash, `#` and `#/` are home, and so is every `#/…` path this app does not know, so a
 * mistyped link lands somewhere useful. A hash that does not start with `#/` is a strip link.
 *
 * @param hash The hash, with or without its leading `#`.
 * @returns The route, e.g. `newTest` with n 10 and minutes 20 for `#/KOAK/amend/test/10x20`.
 */
export function routeOf(hash: string): Route {
  const withMark = hash.startsWith('#') ? hash : `#${hash}`;
  if (withMark === '#' || withMark === '#/') return HOME;
  if (!withMark.startsWith('#/')) return { kind: 'strip' };
  const rest = withMark.slice(2);
  const mark = rest.indexOf('?');
  const path = mark === -1 ? rest : rest.slice(0, mark);
  const query = mark === -1 ? '' : rest.slice(mark + 1);
  return pathRoute(path, query);
}

/** The path and its query, the `?` written only when the query carries something. */
function withQuery(path: string, query: string): string {
  return query.length > 0 ? `${path}?${query}` : path;
}

/**
 * Writes the link a route opens from, which `routeOf` reads back as the same route.
 *
 * @param route The route.
 * @returns The hash, e.g. `#/KOAK/amend/test/10x20?i=text`, `#/tutorial/amend`, or `#/` for home.
 */
export function hrefOf(route: PageRoute): string {
  if (route.kind === 'home') return '#/';
  if (route.kind === 'tutorial') return `#/${TUTORIAL_PATHS[route.part]}`;
  const base = `#/${route.icao}/${MODE_SEGMENTS[route.mode]}`;
  switch (route.kind) {
    case 'practice':
      return withQuery(`${base}/practice`, route.query);
    case 'newTest':
      return withQuery(`${base}/test/${route.n}x${route.minutes}`, route.query);
    case 'continueTest':
      return `${base}/test/${(route.setSeed >>> 0).toString(36)}`;
  }
}

/**
 * Draws the seed of a new test set, one whose base-36 form never reads as a new test's spec, so the
 * set's continue link can never start another set instead.
 *
 * @param draw Draws a candidate seed.
 * @returns The first candidate whose base-36 form is not a count, `x` and minutes.
 */
export function newSetSeed(draw: () => number): number {
  let seed = draw();
  while (NEW_TEST_SPEC.test(seed.toString(36))) seed = draw();
  return seed;
}
