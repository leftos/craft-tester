import type { AltitudePhrase, ExpectedClearance, RouteTemplate } from '@/data/schema.ts';

/** One data row that decided an element of a clearance, quoted verbatim in the results view. */
export type RuleCitation = {
  id: string;
  source: string;
  text: string;
};

/** A resolved value together with the rule rows that produced it. */
export type Cited<T> = {
  value: T;
  citations: RuleCitation[];
};

/**
 * The clearance the engine resolved for a scenario, element by element.
 *
 * `runway` is the scenario's departure runway together with the configuration row and the mechanism
 * row that settled it. `sid.value.spoken` is the chart's spoken name ("Trukn Two");
 * `sid.value.family` is what grading compares, because AIRAC cycles bump the version in `id`.
 */
export type ResolvedClearance = {
  clearedTo: Cited<string>;
  runway: Cited<string>;
  sid: Cited<{ id: string; family: string; spoken: string }>;
  route: Cited<{ template: RouteTemplate; fix?: string }>;
  altitude: Cited<{ phrase: AltitudePhrase; feet?: number }>;
  expect: Cited<{ feet: number; minutes: number } | null>;
  frequency: Cited<{ value: string; sectorId: string }>;
};

/**
 * The elements of a clearance the engine resolves, in the order CRAFT speaks them, followed by the
 * strip boxes amendment mode reports under.
 *
 * Grading covers all the clearance elements but `R.sid`: the flight plan always files the procedure
 * the SOP assigns, so the element is resolved, spoken and reported unresolved under this key, never
 * graded. The `BOX.` keys name the three boxes of the flight progress strip an amendment can change
 * — the type box, the altitude box and the route box — and are what the amendment checks report an
 * unresolved box under.
 */
export type ClearanceElement =
  | 'R.sid'
  | 'R.route'
  | 'A.phrase'
  | 'A.expect'
  | 'F'
  | 'RWY'
  | 'BOX.type'
  | 'BOX.altitude'
  | 'BOX.route';

/** An element the engine could not resolve, with the reason to show the player. */
export type Unresolved = {
  element: ClearanceElement;
  reason: string;
};

/** What the engine returns: a full clearance, or the elements that blocked it. */
export type EngineResult =
  | { ok: true; clearance: ResolvedClearance }
  | { ok: false; unresolved: Unresolved[] };

/** What the player entered in the CRAFT form, before grading. */
export type PlayerPicks = {
  routeTemplate: RouteTemplate;
  routeFix?: string;
  altitudePhrase: AltitudePhrase;
  altitudeFeet?: number;
  expect: 'ten_minutes' | 'three_minutes' | 'none';
  frequency: string;
  runway: string;
};

/** The verdict for one element: whether it matched, both labels, and the rows that decided it. */
export type Grade = {
  element: ClearanceElement;
  ok: boolean;
  expectedLabel: string;
  actualLabel: string;
  citations: RuleCitation[];
};

/**
 * Flattens a resolved clearance into the fixture schema's `ExpectedClearance` shape.
 *
 * Drops the citations and keeps the SID family rather than its versioned id, so a fixture runner
 * can compare an engine result with a checked-in expectation by deep equality.
 *
 * @param resolved The clearance the engine resolved.
 * @returns The same clearance in the shape a fixture stores.
 */
export function toExpectedClearance(resolved: ResolvedClearance): ExpectedClearance {
  const route = resolved.route.value;
  const altitude = resolved.altitude.value;
  const expect = resolved.expect.value;
  return {
    clearedTo: resolved.clearedTo.value,
    sidFamily: resolved.sid.value.family,
    route:
      route.fix === undefined
        ? { template: route.template }
        : { template: route.template, fix: route.fix },
    altitude:
      altitude.feet === undefined
        ? { phrase: altitude.phrase }
        : { phrase: altitude.phrase, feet: altitude.feet },
    expect: expect === null ? null : { feet: expect.feet, minutes: expect.minutes },
    frequency: resolved.frequency.value.value,
  };
}
