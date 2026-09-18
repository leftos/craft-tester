import type { AirportData, Scenario } from '@/data/schema.ts';
import { onOneWayAirway } from '@/rules/amend/altitude.ts';
import { withVectorNavaid } from '@/rules/amend/route.ts';
import type { AmendmentResult, ResolvedAmendment } from '@/rules/amend/types.ts';
import { citePhraseology } from '@/rules/cite.ts';
import { formatAltitude, verdictOf } from '@/rules/grade.ts';
import type { Grade, RuleCitation, Verdict } from '@/rules/types.ts';

/** One box of the flight progress strip the student answers. */
export type Box = 'type' | 'altitude' | 'route';

/** What the student did with one box: left it as filed, or wrote a new value in it. */
export type BoxAnswer = { kind: 'as_filed' } | { kind: 'amended'; value: string };

/** The student's answer for every box of the strip. */
export type BoxAnswers = Record<Box, BoxAnswer>;

/**
 * The verdict for one box: how it was answered, both labels, the rows that decided it, and the
 * reason the engine gave for the box's amendment, which is `undefined` where it raised none.
 *
 * A box is answered right or not, so a box verdict is `correct` or `wrong`, save for two route-box
 * tiers between them. A box a radar-vector SID's navaid is all that separates from the box the
 * engine wrote is `acceptable`: filed either way the plan flies the same route. A box that reads
 * the proposal but for the arrival the proposal swaps is `half`: everything but the arrival routing
 * was read right, and the arrival is the enroute controller's to change.
 */
export type BoxGrade = {
  box: Box;
  verdict: Verdict;
  expectedLabel: string;
  actualLabel: string;
  citations: RuleCitation[];
  reason: string | undefined;
};

/** A box verdict keyed by the element it reports under, carrying the reason for the box's amendment. */
export type BoxElementGrade = Grade & { reason: string | undefined };

/** How a box was answered, and what the answer should have been. */
type BoxVerdict = { verdict: Verdict; expectedLabel: string };

/** The boxes in the order they read across the strip, which is the order the verdicts come back in. */
const STRIP_ORDER: readonly Box[] = ['type', 'altitude', 'route'];

/** What a box that needed no changing is labelled with, expected and actual alike. */
const AS_FILED_LABEL = 'correct as filed';

/** What the box of an alternative pair is labelled with once the other box carries the fix. */
const ALTERNATIVE_LABEL = 'correct as filed (the other box already fixes this)';

/** An altitude as it may be written: plain feet, or a flight level. */
const ALTITUDE_TEXT = /^(?:FL)?(\d+)$/;

/** A three-digit altitude is hundreds of feet, the way a flight level is written. */
const HUNDREDS_LENGTH = 3;

/** Plain feet are written with four or five digits, e.g. `3000` and `32000`. */
const FEET_LENGTHS: readonly number[] = [4, 5];

/**
 * Normalises a route box: the tokens as filed, upper case, one space between them.
 *
 * @param text The route as the student typed it.
 * @returns The route in the one form two answers are compared in.
 */
export function normaliseRoute(text: string): string {
  return text
    .toUpperCase()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .join(' ');
}

/**
 * Normalises a type box: the designator and suffix run together, upper case.
 *
 * @param text The type box as the student typed it.
 * @returns The type in the one form two answers are compared in.
 */
export function normaliseType(text: string): string {
  return text.toUpperCase().replace(/\s+/g, '');
}

/**
 * Reads an altitude box as feet.
 *
 * Accepts the forms a strip and a controller write: plain feet with or without a thousands
 * separator (`32000`, `32,000`), a flight level (`FL320`, `fl 320`), and a bare three-digit number,
 * which is hundreds of feet the way a flight level is. Anything else is not an altitude.
 *
 * @param text The altitude box as the student typed it.
 * @returns The altitude in feet, or `undefined` when the text is not one.
 */
export function parseAltitude(text: string): number | undefined {
  const compact = text.toUpperCase().replace(/[\s,]/g, '');
  const digits = ALTITUDE_TEXT.exec(compact)?.[1];
  if (digits === undefined) return undefined;
  if (digits.length === HUNDREDS_LENGTH) return Number(digits) * 100;
  if (compact.startsWith('FL')) return undefined;
  return FEET_LENGTHS.includes(digits.length) ? Number(digits) : undefined;
}

/** Whether the answer writes exactly the value the engine proposes for the box. */
function matches(answer: BoxAnswer, amendment: ResolvedAmendment): boolean {
  if (answer.kind === 'as_filed') return false;
  if (amendment.box === 'altitude') return parseAltitude(answer.value) === amendment.proposedFeet;
  if (amendment.box === 'route') {
    return normaliseRoute(answer.value) === normaliseRoute(amendment.proposed);
  }
  return normaliseType(answer.value) === normaliseType(amendment.proposed);
}

/** The value the box should read once amended, written the way the strip writes it. */
function proposalLabel(amendment: ResolvedAmendment): string {
  return amendment.box === 'altitude' ? formatAltitude(amendment.proposedFeet) : amendment.proposed;
}

/** What the student put in the box, read back for the results view. */
function answerLabel(answer: BoxAnswer): string {
  return answer.kind === 'as_filed' ? AS_FILED_LABEL : answer.value;
}

/** The amendment for each box, the last raised winning, which is the one `corrected` applied. */
function byBox(amendments: readonly ResolvedAmendment[]): Partial<Record<Box, ResolvedAmendment>> {
  const found: Partial<Record<Box, ResolvedAmendment>> = {};
  for (const amendment of amendments) found[amendment.box] = amendment;
  return found;
}

/** Which boxes the student wrote the proposed value into. */
function fixedBoxes(
  answers: BoxAnswers,
  amendments: Partial<Record<Box, ResolvedAmendment>>,
): Record<Box, boolean> {
  const fixedFor = (box: Box): boolean => {
    const amendment = amendments[box];
    return amendment !== undefined && matches(answers[box], amendment);
  };
  return { type: fixedFor('type'), altitude: fixedFor('altitude'), route: fixedFor('route') };
}

/** The boxes on the other side of the type box: every box that names it as its alternative. */
function otherSide(amendments: Partial<Record<Box, ResolvedAmendment>>): Box[] {
  return STRIP_ORDER.filter((box) => amendments[box]?.alternativeTo === 'type');
}

/**
 * The verdict for one box of an alternative pair, where fixing either side alone is a full answer.
 *
 * The pair has the type box on one side and every box that names it on the other: raising the
 * equipment suffix leaves the plan standing as filed, and amending every other box the plan is
 * wrong in is the same fix made the other way round. Once the other side carries the fix — every
 * box of it, where it has more than one — this box is expected to read as filed, and amending it
 * too is a miss; the type box, which the strip reads first, is the one that carries it where both
 * sides were amended. While the other side does not carry it, the plan is still wrong, so the box
 * is graded against its proposal.
 *
 * @param box The box being graded.
 * @param answer What the student put in it.
 * @param amendment The amendment the engine raised for it.
 * @param ctx Which boxes the student fixed, and the amendment each box carries.
 * @returns The verdict and the label for this box.
 */
function gradePair(
  box: Box,
  answer: BoxAnswer,
  amendment: ResolvedAmendment,
  ctx: GradeContext,
): BoxVerdict {
  const others: Box[] = box === 'type' ? otherSide(ctx.amendments) : ['type'];
  const otherFixed = others.length > 0 && others.every((other) => ctx.fixed[other]);
  const carries = box === 'type' && ctx.fixed[box];
  if (otherFixed && !carries) {
    return { verdict: verdictOf(answer.kind === 'as_filed'), expectedLabel: ALTERNATIVE_LABEL };
  }
  return { verdict: verdictOf(ctx.fixed[box]), expectedLabel: proposalLabel(amendment) };
}

/**
 * What the route box is graded against beyond its own amendment.
 *
 * `expected` is the box as the corrected plan reads it and `filed` the box as the pilot filed it,
 * which is what a student who left the box alone wrote.
 */
type RouteRule = { airport: AirportData; expected: string; filed: string };

/**
 * What the three boxes are graded against: which of them the student fixed, what the engine raised
 * for each, the route rule, and whether the filed route runs on a one-way airway.
 */
type GradeContext = {
  fixed: Record<Box, boolean>;
  amendments: Partial<Record<Box, ResolvedAmendment>>;
  route: RouteRule;
  oneWayRoute: boolean;
};

/** The phraseology row that says the navaid after a vector SID is filed rather than spoken. */
const VECTOR_NAVAID_ROW = 'R-RV-NAVAID';

/** The phraseology row that says why a one-way route is not read against the parity. */
const ONE_WAY_AIRWAY_ROW = 'A-ONE-WAY-AIRWAY';

/** Whether two route boxes name the same route, the navaid a vector SID is filed with aside. */
function sameRouteButNavaid(left: string, right: string, airport: AirportData): boolean {
  const written = (route: string): string =>
    withVectorNavaid(normaliseRoute(route).split(' '), airport).join(' ');
  return written(left) === written(right);
}

/**
 * Whether a route answer is acceptable though it is not the box the engine wrote.
 *
 * The navaid after a radar-vector SID is filed for the computerized flight plan and never spoken,
 * so a box that carries it and a box that does not are the same route: a student who writes either
 * has read the plan right. A box the engine only warned about is likewise acceptable left as filed,
 * the warning being what a warning is.
 *
 * @param box The box being graded, of which only the route box carries a route.
 * @param answer What the student put in it.
 * @param amendment The amendment the engine raised for it, where it raised one.
 * @param rule The box as the plan should read it, and the airport whose navaid is at issue.
 * @returns True when the answer is acceptable rather than wrong.
 */
function navaidAcceptable(
  box: Box,
  answer: BoxAnswer,
  amendment: ResolvedAmendment | undefined,
  rule: RouteRule,
): boolean {
  if (box !== 'route') return false;
  if (answer.kind === 'as_filed') {
    return amendment?.box === 'route' && amendment.warning === true;
  }
  if (normaliseRoute(answer.value) === normaliseRoute(rule.expected)) return false;
  return sameRouteButNavaid(answer.value, rule.expected, rule.airport);
}

/** The rows an acceptable route box cites: the ones that decided it, and the navaid row. */
function withNavaidRow(citations: readonly RuleCitation[], airport: AirportData): RuleCitation[] {
  const cited = new Set(citations.map((citation) => citation.id));
  const row = citePhraseology(airport, VECTOR_NAVAID_ROW).filter(
    (citation) => !cited.has(citation.id),
  );
  return [...citations, ...row];
}

/**
 * The rows a box cites from its amendment, with the one-way airway row on the altitude box of a
 * flight whose filed route runs on a one-way airway: whether the level stood as filed or was
 * amended, that row is why the parity was not read against it.
 *
 * @param box The box being graded.
 * @param citations The rows the box's amendment cites, empty where the engine raised none.
 * @param ctx What the boxes are graded against, which says whether the route is one-way.
 * @returns The citations, the one-way row appended where the amendment does not already cite it.
 */
function withOneWayRow(
  box: Box,
  citations: readonly RuleCitation[],
  ctx: GradeContext,
): RuleCitation[] {
  if (box !== 'altitude' || !ctx.oneWayRoute) return [...citations];
  const cited = new Set(citations.map((citation) => citation.id));
  const row = citePhraseology(ctx.route.airport, ONE_WAY_AIRWAY_ROW).filter(
    (citation) => !cited.has(citation.id),
  );
  return [...citations, ...row];
}

/**
 * Whether a route answer reads the box as it would have read without the arrival the proposal swaps.
 *
 * A proposal that puts the flight on another arrival of its destination carries the box it would
 * otherwise have written, and a student who writes that box — or leaves the box as filed where that
 * is the box the pilot filed — has read everything but the arrival routing right. The arrival is
 * the enroute controller's to change, so the answer earns half a point rather than nothing.
 *
 * @param box The box being graded, of which only the route box carries a route.
 * @param answer What the student put in it.
 * @param amendment The amendment the engine raised for it, where it raised one.
 * @param rule The route as filed and as the corrected plan reads it, with the airport.
 * @returns True when the answer earns half credit rather than nothing.
 */
function arrivalHalf(
  box: Box,
  answer: BoxAnswer,
  amendment: ResolvedAmendment | undefined,
  rule: RouteRule,
): boolean {
  if (box !== 'route' || amendment?.box !== 'route') return false;
  const swap = amendment.arrivalSwap;
  if (swap === undefined) return false;
  const written = answer.kind === 'as_filed' ? rule.filed : answer.value;
  return sameRouteButNavaid(written, swap, rule.airport);
}

/** The tier a missed route box lands in: acceptable first, then half credit, then the miss. */
function routeTier(base: Verdict, acceptable: boolean, half: boolean): Verdict {
  if (acceptable) return 'acceptable';
  return half ? 'half' : base;
}

/** The verdict for one box before the navaid rule: as filed, the proposal, or one half of a pair. */
function baseVerdict(
  box: Box,
  answer: BoxAnswer,
  amendment: ResolvedAmendment | undefined,
  ctx: GradeContext,
): BoxVerdict {
  if (amendment === undefined) {
    return { verdict: verdictOf(answer.kind === 'as_filed'), expectedLabel: AS_FILED_LABEL };
  }
  return amendment.alternativeTo === undefined
    ? { verdict: verdictOf(ctx.fixed[box]), expectedLabel: proposalLabel(amendment) }
    : gradePair(box, answer, amendment, ctx);
}

/**
 * The verdict for one box: the base verdict, with the two tiers a missed route box can still earn.
 *
 * A box the vector navaid alone spoils is acceptable, and a box that misses only the arrival the
 * proposal swaps earns half credit; the acceptable reading wins where an answer could be read as
 * either. Both keep the proposal as the expected label, and only the acceptable one cites a row of
 * its own.
 */
function gradeBox(
  box: Box,
  answer: BoxAnswer,
  amendment: ResolvedAmendment | undefined,
  ctx: GradeContext,
): BoxGrade {
  const base = baseVerdict(box, answer, amendment, ctx);
  const missed = base.verdict === 'wrong';
  const acceptable = missed && navaidAcceptable(box, answer, amendment, ctx.route);
  const half = missed && arrivalHalf(box, answer, amendment, ctx.route);
  const citations = withOneWayRow(box, amendment?.citations ?? [], ctx);
  return {
    box,
    verdict: routeTier(base.verdict, acceptable, half),
    expectedLabel: base.expectedLabel,
    actualLabel: answerLabel(answer),
    citations: acceptable ? withNavaidRow(citations, ctx.route.airport) : citations,
    reason: amendment?.reason,
  };
}

/**
 * Grades the three boxes of the strip against the amendments the engine resolved.
 *
 * A box the engine raised no amendment for is right when the student left it as filed: knowing that
 * nothing is wrong is half the skill the mode trains, and amending a correct box is a miss. A box
 * with an amendment is right when the student wrote the proposed value in it, compared as the strip
 * reads it rather than character by character. The type box and the boxes paired with it are two
 * ways to fix one fault, and either side alone is right. A route box that names the same route as the
 * corrected plan, the navaid a radar-vector SID is filed with aside, is acceptable either way, and
 * one that reads the proposal but for the arrival it swaps earns half credit. The altitude box of a
 * flight filed on a one-way airway cites the one-way airway row, whatever its verdict.
 *
 * @param answers What the student answered for every box.
 * @param result The amendments the engine resolved for the same plan.
 * @param scenario The plan as filed, whose route box is what a student who amended nothing wrote and
 *   whose route says whether the flight is on a one-way airway.
 * @param airport The airport data, whose vector SIDs and own navaid decide the route box and whose
 *   airways say which of them are one-way.
 * @returns One verdict per box, in strip order: type, altitude, route.
 */
export function gradeBoxes(
  answers: BoxAnswers,
  result: Extract<AmendmentResult, { ok: true }>,
  scenario: Scenario,
  airport: AirportData,
): BoxGrade[] {
  const amendments = byBox(result.amendments);
  const fixed = fixedBoxes(answers, amendments);
  const route: RouteRule = {
    airport,
    expected: result.corrected.filedRoute,
    filed: scenario.filedRoute,
  };
  const ctx: GradeContext = {
    fixed,
    amendments,
    route,
    oneWayRoute: onOneWayAirway(scenario, airport),
  };
  return STRIP_ORDER.map((box) => gradeBox(box, answers[box], amendments[box], ctx));
}

/**
 * Reads a box verdict as a verdict on a clearance element, which is how the results view shows it.
 *
 * An amendment session is graded as one run of the strip boxes and then the clearance elements, so
 * the two kinds of verdict share a score line and a renderer; the box becomes the element it reports
 * under, e.g. `BOX.altitude`.
 *
 * @param grade The verdict for one box of the strip.
 * @returns The same verdict, keyed by the element the box reports under, with the reason for the
 *   box's amendment kept.
 */
export function boxGradeAsGrade(grade: BoxGrade): BoxElementGrade {
  const { box, ...rest } = grade;
  return { element: `BOX.${box}`, ...rest };
}
