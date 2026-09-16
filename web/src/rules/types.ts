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
 * The clause the controller speaks after the altitude, in one of the three readings it has.
 *
 * `filed` names the altitude the pilot filed and the delay the rules give it. `amended` is the
 * reading after the controller amended the final altitude, which names the amended altitude
 * instead. `final` is the reading where the clearance climbs the flight straight to that amended
 * altitude and speaks it: there is nothing further to expect, so the clause says the altitude just
 * assigned is the final one and carries no delay.
 */
export type ExpectClause =
  | { kind: 'filed'; feet: number; minutes: number }
  | { kind: 'amended'; feet: number; minutes: number }
  | { kind: 'final'; feet: number };

/**
 * The clearance the engine resolved for a scenario, element by element.
 *
 * `runway` is the scenario's departure runway together with the configuration row and the mechanism
 * row that settled it. `sid.value.spoken` is the chart's spoken name ("Trukn Two");
 * `sid.value.family` is what grading compares, because AIRAC cycles bump the version in `id`.
 * `expect.value.kind` says which of the three readings the clause takes. `redundantExpect` carries
 * the longer expect reading the rules still allow beside the one the clearance speaks: the clause
 * the chart already speaks for the pilot, which a controller may repeat without harm, and the
 * amended clause beside a `final` clause, which says at a delay what the final reading says
 * outright. It is null wherever no longer reading is allowed — an amended or filed clause spoken on
 * its own, a clause dropped for any other reason, a chart that publishes no note.
 */
export type ResolvedClearance = {
  clearedTo: Cited<string>;
  runway: Cited<string>;
  sid: Cited<{ id: string; family: string; spoken: string }>;
  route: Cited<{ template: RouteTemplate; fix?: string }>;
  altitude: Cited<{ phrase: AltitudePhrase; feet?: number }>;
  expect: Cited<ExpectClause | null>;
  redundantExpect: Cited<{ feet: number; minutes: number } | null>;
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
  expect: 'ten_minutes' | 'five_minutes' | 'three_minutes' | 'final' | 'none';
  frequency: string;
  runway: string;
};

/**
 * How one element was answered.
 *
 * `correct` matches the clearance the engine resolved. `acceptable` is a reading the rules allow but
 * that says more than it needs to — the expect clause the SID chart already publishes, or the
 * amended clause where "will be your final" is the answer.
 * `wrong` is a miss.
 */
export type Verdict = 'correct' | 'acceptable' | 'wrong';

/** The verdict for one element: how it was answered, both labels, and the rows that decided it. */
export type Grade = {
  element: ClearanceElement;
  verdict: Verdict;
  expectedLabel: string;
  actualLabel: string;
  citations: RuleCitation[];
};

/** The expect clause as a fixture stores it, which marks the reading only where it is not the filed one. */
function expectedExpect(expect: ExpectClause): NonNullable<ExpectedClearance['expect']> {
  if (expect.kind === 'final') return { feet: expect.feet, final: true };
  const stored = { feet: expect.feet, minutes: expect.minutes };
  return expect.kind === 'amended' ? { ...stored, amended: true } : stored;
}

/**
 * Flattens a resolved clearance into the fixture schema's `ExpectedClearance` shape.
 *
 * Drops the citations and keeps the SID family rather than its versioned id, so a fixture runner
 * can compare an engine result with a checked-in expectation by deep equality. An expect clause
 * writes `amended` or `final` only where the reading is one of those, which leaves an ordinary
 * clause the shape it always had.
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
    expect: expect === null ? null : expectedExpect(expect),
    frequency: resolved.frequency.value.value,
  };
}
