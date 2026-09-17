import type { AirportData } from '@/data/schema.ts';
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
 * The verdict for one box: how it was answered, both labels, and the rows that decided it.
 *
 * A box is answered right or not, so a box verdict is `correct` or `wrong`, save for the route box
 * a radar-vector SID's navaid is all that separates from the box the engine wrote: filed either way
 * the plan flies the same route, so that answer is `acceptable`.
 */
export type BoxGrade = {
  box: Box;
  verdict: Verdict;
  expectedLabel: string;
  actualLabel: string;
  citations: RuleCitation[];
};

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

/**
 * The verdict for one box of an alternative pair, where fixing either box alone is a full answer.
 *
 * Once the other box carries the fix, this one is expected to read as filed, and amending it too is
 * a miss; the box earlier in strip order is the one that carries it when both were amended. While
 * neither box carries it, the plan is still wrong, so both are graded against their proposals.
 *
 * @param box The box being graded.
 * @param answer What the student put in it.
 * @param amendment The amendment the engine raised for it.
 * @param other The box the amendment pairs with.
 * @param fixed Which boxes the student wrote the proposed value into.
 * @returns The verdict and the label for this box.
 */
function gradePair(
  box: Box,
  answer: BoxAnswer,
  amendment: ResolvedAmendment,
  other: Box,
  fixed: Record<Box, boolean>,
): BoxVerdict {
  const otherFirst = STRIP_ORDER.indexOf(other) < STRIP_ORDER.indexOf(box);
  if (fixed[other] && (otherFirst || !fixed[box])) {
    return { verdict: verdictOf(answer.kind === 'as_filed'), expectedLabel: ALTERNATIVE_LABEL };
  }
  return { verdict: verdictOf(fixed[box]), expectedLabel: proposalLabel(amendment) };
}

/** What the route box is graded against beyond its own amendment: the box as the plan should read. */
type RouteRule = { airport: AirportData; expected: string };

/** What the three boxes are graded against: which of them the student fixed, and the route rule. */
type GradeContext = { fixed: Record<Box, boolean>; route: RouteRule };

/** The phraseology row that says the navaid after a vector SID is filed rather than spoken. */
const VECTOR_NAVAID_ROW = 'R-RV-NAVAID';

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

/** The verdict for one box before the navaid rule: as filed, the proposal, or one half of a pair. */
function baseVerdict(
  box: Box,
  answer: BoxAnswer,
  amendment: ResolvedAmendment | undefined,
  fixed: Record<Box, boolean>,
): BoxVerdict {
  if (amendment === undefined) {
    return { verdict: verdictOf(answer.kind === 'as_filed'), expectedLabel: AS_FILED_LABEL };
  }
  const other = amendment.alternativeTo;
  return other === undefined
    ? { verdict: verdictOf(fixed[box]), expectedLabel: proposalLabel(amendment) }
    : gradePair(box, answer, amendment, other, fixed);
}

/** The verdict for one box, with a route box the vector navaid alone spoils read as acceptable. */
function gradeBox(
  box: Box,
  answer: BoxAnswer,
  amendment: ResolvedAmendment | undefined,
  ctx: GradeContext,
): BoxGrade {
  const base = baseVerdict(box, answer, amendment, ctx.fixed);
  const acceptable =
    base.verdict === 'wrong' && navaidAcceptable(box, answer, amendment, ctx.route);
  const citations = amendment?.citations ?? [];
  return {
    box,
    verdict: acceptable ? 'acceptable' : base.verdict,
    expectedLabel: base.expectedLabel,
    actualLabel: answerLabel(answer),
    citations: acceptable ? withNavaidRow(citations, ctx.route.airport) : citations,
  };
}

/**
 * Grades the three boxes of the strip against the amendments the engine resolved.
 *
 * A box the engine raised no amendment for is right when the student left it as filed: knowing that
 * nothing is wrong is half the skill the mode trains, and amending a correct box is a miss. A box
 * with an amendment is right when the student wrote the proposed value in it, compared as the strip
 * reads it rather than character by character. A box paired with another as two ways to fix one
 * fault is right when either box alone carries the fix. A route box that names the same route as the
 * corrected plan, the navaid a radar-vector SID is filed with aside, is acceptable either way.
 *
 * @param answers What the student answered for every box.
 * @param result The amendments the engine resolved for the same plan.
 * @param airport The airport data, whose vector SIDs and own navaid decide the route box.
 * @returns One verdict per box, in strip order: type, altitude, route.
 */
export function gradeBoxes(
  answers: BoxAnswers,
  result: Extract<AmendmentResult, { ok: true }>,
  airport: AirportData,
): BoxGrade[] {
  const amendments = byBox(result.amendments);
  const fixed = fixedBoxes(answers, amendments);
  const route: RouteRule = { airport, expected: result.corrected.filedRoute };
  return STRIP_ORDER.map((box) => gradeBox(box, answers[box], amendments[box], { fixed, route }));
}

/**
 * Reads a box verdict as a verdict on a clearance element, which is how the results view shows it.
 *
 * An amendment session is graded as one run of the strip boxes and then the clearance elements, so
 * the two kinds of verdict share a score line and a renderer; the box becomes the element it reports
 * under, e.g. `BOX.altitude`.
 *
 * @param grade The verdict for one box of the strip.
 * @returns The same verdict, keyed by the element the box reports under.
 */
export function boxGradeAsGrade(grade: BoxGrade): Grade {
  const { box, ...rest } = grade;
  return { element: `BOX.${box}`, ...rest };
}
