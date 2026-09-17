import type {
  AltitudePhrase,
  ExpectedClearance,
  NonDpHeading,
  RouteTemplate,
  Sid,
} from '@/data/schema.ts';

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

/** Which way a flight is turned onto an assigned heading; absent where the heading needs no turn. */
export type Turn = 'left' | 'right' | undefined;

/**
 * What the clearance sends the flight out on: a published departure procedure, or the heading the
 * SOP clears a flight on where it assigns no procedure at all.
 *
 * `spoken` is what the clearance reads: the chart's spoken name ("Trukn Two"), which the reading
 * follows with "departure", or the heading words with the heading written in digits ("fly runway
 * heading", "turn left heading 270", "fly heading 284"), which stand on their own. `turn` is the
 * shorter way round from the departure runway's bearing onto the heading, undefined where the
 * heading is the runway heading or the runway's own bearing. `family` is what grading compares a
 * SID by, because AIRAC cycles bump the version in `id`.
 */
export type Procedure =
  | { kind: 'sid'; id: string; family: string; spoken: string }
  | { kind: 'heading'; heading: NonDpHeading; turn: Turn; spoken: string };

/**
 * What the form and the results view call a clearance the SOP issues without a procedure.
 *
 * The label names the heading but never the turn: the procedure dropdown offers it before any
 * runway is known, so there is no bearing to derive a turn direction from.
 *
 * @param heading The runway heading, or the assigned magnetic heading in degrees.
 * @returns The label, e.g. `fly runway heading (no DP)` or `heading 270 (no DP)`.
 */
export function headingLabel(heading: NonDpHeading): string {
  return heading === 'runway heading' ? 'fly runway heading (no DP)' : `heading ${heading} (no DP)`;
}

/**
 * The same choice as the engine carries it while it resolves the rest of the clearance, which for a
 * SID is the whole chart record the altitude and the route phrase are read off.
 */
export type SelectedProcedure =
  | { kind: 'sid'; sid: Sid }
  | { kind: 'heading'; heading: NonDpHeading; turn: Turn };

/** The heading as the clearance writes it, the turn included wherever one is issued. */
function headingSpoken(heading: NonDpHeading, turn: Turn): string {
  if (heading === 'runway heading') return 'fly runway heading';
  return turn === undefined ? `fly heading ${heading}` : `turn ${turn} heading ${heading}`;
}

/**
 * The clearance element a selected procedure becomes.
 *
 * @param selected The procedure the assignment row put the flight on.
 * @returns The procedure as the clearance carries it, spoken form included.
 */
export function procedureOf(selected: SelectedProcedure): Procedure {
  if (selected.kind === 'heading') {
    const { heading, turn } = selected;
    return { kind: 'heading', heading, turn, spoken: headingSpoken(heading, turn) };
  }
  const { sid } = selected;
  return { kind: 'sid', id: sid.id, family: sid.family, spoken: sid.spoken };
}

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
 * The route element of a clearance: the shape it is spoken in, the element the flight leaves the
 * terminal on, and the route box a built clearance is read for.
 *
 * `builtRoute` is set only where the flight is issued a SID the assignment table passed over,
 * connected onward to the route the pilot filed: the clearance is then read for that route rather
 * than for the filed one, and "then as filed" hands over at the fix the two run together from.
 */
export type ResolvedRoute = Cited<{ template: RouteTemplate; fix?: string; builtRoute?: string }>;

/**
 * The clearance the engine resolved for a scenario, element by element.
 *
 * `runway` is the scenario's departure runway together with the configuration row and the mechanism
 * row that settled it. `procedure.value` is the SID the assignment row assigns, or the runway
 * heading it clears the flight on where it assigns no procedure.
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
  procedure: Cited<Procedure>;
  route: ResolvedRoute;
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
 * amended clause where "will be your final" is the answer. `half` earns half a point: the answer
 * read everything but the arrival routing right, the arrival being the enroute controller's to
 * change.
 * `wrong` is a miss.
 */
export type Verdict = 'correct' | 'acceptable' | 'half' | 'wrong';

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
 * can compare an engine result with a checked-in expectation by deep equality. A clearance flown on
 * the runway heading has no procedure to name, so it writes a null family and the heading instead.
 * An expect clause writes `amended` or `final` only where the reading is one of those, which leaves
 * an ordinary clause the shape it always had.
 *
 * @param resolved The clearance the engine resolved.
 * @returns The same clearance in the shape a fixture stores.
 */
export function toExpectedClearance(resolved: ResolvedClearance): ExpectedClearance {
  const route = resolved.route.value;
  const altitude = resolved.altitude.value;
  const expect = resolved.expect.value;
  const procedure = resolved.procedure.value;
  return {
    clearedTo: resolved.clearedTo.value,
    sidFamily: procedure.kind === 'sid' ? procedure.family : null,
    ...(procedure.kind === 'heading' ? { heading: procedure.heading } : {}),
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
