import type { AirportData, RouteTemplate } from '@/data/schema.ts';
import { citePhraseology } from '@/rules/cite.ts';
import { speakExpect } from '@/rules/speak.ts';
import type { SpokenClearance, SpokenElement, SpokenPart } from '@/rules/speak.ts';
import { lexiconFor, normaliseSpoken } from '@/rules/text/normalise.ts';
import type { Lexicon, SpokenToken } from '@/rules/text/normalise.ts';
import { isNearMiss } from '@/rules/text/spelling.ts';
import type { Grade, ResolvedClearance, RuleCitation, Verdict } from '@/rules/types.ts';

/** A run of the typed text as a result row shows it: words said, filler among them, or the break between two stretches. */
export type SaidRun = { text: string; kind: 'said' | 'filler' | 'break' };

/** A run of the words the reading has, as a result row shows it: said, or never said at all. */
export type ExpectedRun = { text: string; missed: boolean };

/**
 * One graded element of a typed clearance, with what was said for it as runs.
 *
 * `said` joins back to `actualLabel` wherever anything was heard, and is empty where nothing was.
 * `expected` joins back to the words the element was graded against, the ones never said marked.
 */
export type TextGrade = Grade & { said: SaidRun[]; expected: ExpectedRun[] };

/** An element a typed clearance is graded on: every element of the reading but the callsign. */
type GradedElement = Exclude<SpokenElement, 'callsign'>;

/** A part of the reading that is graded. */
type GradedPart = { element: GradedElement; words: string };

/** The graded elements, in the order the grades are returned. */
const GRADED_ORDER: readonly GradedElement[] = [
  'C',
  'R.sid',
  'R.route',
  'A.phrase',
  'A.expect',
  'F',
  'T',
  'RWY',
];

/** A character span of the typed text, end exclusive. */
type Span = { start: number; end: number };

/** How a candidate reads the route: as spoken, in full, or with "then as filed" for its closing "direct". */
type RouteOption = 'base' | 'full' | 'end';

/** How a candidate reads the expect clause: as spoken, or as the redundant clause the rules allow. */
type ExpectOption = 'base' | 'redundant';

/** A token of a candidate reading, tagged with the element it speaks. */
type CandidateToken = { token: SpokenToken; element: GradedElement };

/** One reading the typed text is aligned against, as its parts' words and as their tokens. */
type Candidate = {
  route: RouteOption;
  expect: ExpectOption;
  parts: GradedPart[];
  tokens: CandidateToken[];
};

/** A student token matched with a candidate token, by their indices. */
type Pair = { student: number; candidate: number };

/**
 * A candidate aligned with the typed text.
 *
 * `student` is the typed tokens the candidate was aligned with, a stray expect clause cut out, and
 * `stray` is the span of that clause.
 */
type Alignment = {
  candidate: Candidate;
  student: SpokenToken[];
  stray: Span | undefined;
  pairs: Pair[];
};

/** A number token of the normalised text. */
type NumberToken = Extract<SpokenToken, { kind: 'number' }>;

/** A tier a rule set on an element, and the rows that rule cites. */
type Tier = { verdict: Verdict; rows: RuleCitation[] };

/** What the gaps of an alignment put on one element. */
type GapMarks = {
  outOfOrder: boolean;
  blocks: Span[];
  filler: Span[];
  tiers: Tier[];
};

/** A matched student token and the element of the candidate token it matched. */
type MatchedToken = { student: SpokenToken; element: GradedElement };

/** The unmatched tokens between two matches, or after the last one. */
type Gap = {
  student: SpokenToken[];
  candidate: CandidateToken[];
  before: MatchedToken | undefined;
  after: MatchedToken | undefined;
};

/** What the gap walk reads and writes. */
type Walk = {
  alignment: Alignment;
  matched: ReadonlySet<number>;
  marks: Map<GradedElement, GapMarks>;
  expected: ResolvedClearance;
  airport: AirportData;
  vocabulary: ReadonlySet<string>;
};

/** The route reading's closing "direct", which "then as filed" may take the place of. */
const CLOSING_DIRECT = /\bdirect$/u;

/** The facility words a student may add after a bare fix an as-filed route hands over on. */
const FACILITY_WORDS: ReadonlySet<string> = new Set(['vor', 'ndb']);

/** A number written plainly, whose leading and trailing zeros do not change its value. */
const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/u;

/** A run of letters inside a phraseology row, which is a word the phraseology has. */
const LETTER_RUN = /[a-z]+/gu;

/** Text between two spans that leaves them adjacent in a label. */
const LABEL_JOINER = /^[\s\p{P}]*$/u;

/** What a label reads between two stretches of the text that are not adjacent. */
const LABEL_BREAK = ' … ';

const NOT_HEARD = '(not heard)';

const NO_EXPECT_CLAUSE = 'no expect clause';

const VERDICT_RANK: Readonly<Record<Verdict, number>> = {
  correct: 0,
  acceptable: 1,
  half: 2,
  wrong: 3,
};

/** The rows an element cites for itself. */
const OWN_ROWS: Readonly<Record<GradedElement, (expected: ResolvedClearance) => RuleCitation[]>> = {
  C: (expected) => expected.clearedTo.citations,
  'R.sid': (expected) => expected.procedure.citations,
  'R.route': (expected) => expected.route.citations,
  'A.phrase': (expected) => expected.altitude.citations,
  'A.expect': (expected) => expected.expect.citations,
  F: (expected) => expected.frequency.citations,
  T: () => [],
  RWY: (expected) => expected.runway.citations,
};

function isGradedPart(part: SpokenPart): part is GradedPart {
  return part.element !== 'callsign';
}

function withWords(
  parts: readonly GradedPart[],
  element: GradedElement,
  words: string,
): GradedPart[] {
  return parts.map((part) => (part.element === element ? { ...part, words } : part));
}

/**
 * The route readings a candidate may take, in the order ties are broken.
 *
 * A route vectored straight to its destination has no closing "direct" to trade for "then as filed":
 * the "direct" of "radar vectors direct" is the vectors, not the end of a route read in full.
 */
function routeReadings(
  parts: readonly GradedPart[],
  fullRouteWords: string,
  template: RouteTemplate,
): { option: RouteOption; parts: GradedPart[] }[] {
  const base = { option: 'base' as const, parts: [...parts] };
  const words = parts.find((part) => part.element === 'R.route')?.words;
  if (words === undefined) return [base];
  if (words !== fullRouteWords) {
    return [base, { option: 'full', parts: withWords(parts, 'R.route', fullRouteWords) }];
  }
  if (template === 'radar_vectors_direct' || !CLOSING_DIRECT.test(words)) return [base];
  const end = words.replace(CLOSING_DIRECT, 'then as filed');
  return [base, { option: 'end', parts: withWords(parts, 'R.route', end) }];
}

/** The parts with the expect clause spoken as `words`, placed after the altitude where there is none. */
function withExpect(parts: readonly GradedPart[], words: string): GradedPart[] {
  if (parts.some((part) => part.element === 'A.expect')) {
    return withWords(parts, 'A.expect', words);
  }
  const at = parts.findIndex((part) => part.element === 'A.phrase') + 1;
  return [...parts.slice(0, at), { element: 'A.expect', words }, ...parts.slice(at)];
}

function tagged(parts: readonly GradedPart[]): CandidateToken[] {
  return parts.flatMap((part) =>
    normaliseSpoken(part.words, {}).map((token) => ({ token, element: part.element })),
  );
}

/** Every candidate reading, route-major, the base reading first. */
function candidatesFor(spoken: SpokenClearance, expected: ResolvedClearance): Candidate[] {
  const parts = spoken.parts.filter(isGradedPart);
  const redundant = expected.redundantExpect.value;
  const { template } = expected.route.value;
  return routeReadings(parts, spoken.fullRouteWords, template).flatMap(
    ({ option, parts: routeParts }) => {
      const base: Candidate = {
        route: option,
        expect: 'base',
        parts: routeParts,
        tokens: tagged(routeParts),
      };
      if (redundant === null) return [base];
      const redundantParts = withExpect(routeParts, speakExpect(redundant));
      return [
        base,
        {
          route: option,
          expect: 'redundant',
          parts: redundantParts,
          tokens: tagged(redundantParts),
        },
      ];
    },
  );
}

function addWords(words: Set<string>, tokens: readonly SpokenToken[]): void {
  for (const token of tokens) {
    if (token.kind === 'word') words.add(token.text);
  }
}

/**
 * Every word a typed word is read as typed against, rather than as a misspelling of another.
 *
 * The words of every candidate reading, the words the airport's fixes, procedures and destinations
 * are spoken as, and every letter run of its phraseology rows.
 */
function vocabularyOf(
  candidates: readonly Candidate[],
  lexicon: Lexicon,
  airport: AirportData,
): ReadonlySet<string> {
  const words = new Set<string>();
  for (const candidate of candidates) {
    addWords(
      words,
      candidate.tokens.map((tagged) => tagged.token),
    );
  }
  for (const spoken of Object.values(lexicon)) {
    addWords(words, normaliseSpoken(spoken, {}));
  }
  for (const rule of airport.phraseologyRules) {
    for (const run of rule.text.toLowerCase().matchAll(LETTER_RUN)) words.add(run[0]);
  }
  return words;
}

function isWord(token: SpokenToken | undefined, text: string): boolean {
  return token?.kind === 'word' && token.text === text;
}

/** The index of the token a stray expect clause opened before `from` ends on, if one does. */
function strayClauseEnd(tokens: readonly SpokenToken[], from: number): number | undefined {
  for (let index = from; index < tokens.length; index += 1) {
    if (isWord(tokens[index], 'final')) return index;
    if (isWord(tokens[index], 'after') && isWord(tokens[index + 1], 'departure')) return index + 1;
  }
  return undefined;
}

/**
 * The first stray expect clause of the typed text, by token indices, both inclusive.
 *
 * It opens on an "expect" that "runway" does not follow and runs through the first "after
 * departure" or "final" after it. An opening with neither after it closes nothing, and neither can
 * any later one, so the search stops there.
 */
function strayExpect(tokens: readonly SpokenToken[]): { from: number; to: number } | undefined {
  const from = tokens.findIndex(
    (token, index) => isWord(token, 'expect') && !isWord(tokens[index + 1], 'runway'),
  );
  if (from === -1) return undefined;
  const to = strayClauseEnd(tokens, from + 1);
  return to === undefined ? undefined : { from, to };
}

function samePlainDecimal(student: string, expected: string): boolean {
  return (
    PLAIN_DECIMAL.test(student) &&
    PLAIN_DECIMAL.test(expected) &&
    Number(student) === Number(expected)
  );
}

/**
 * Whether a student token says what a candidate token says.
 *
 * Words compare by text, a word typed a letter or two away from the word read saying that word
 * (`S-SPELLING`). Numbers compare by value, and plain decimals by numeric value too, except in the
 * squawk, whose leading zeros count.
 */
function same(
  student: SpokenToken,
  candidate: CandidateToken,
  vocabulary: ReadonlySet<string>,
): boolean {
  const expected = candidate.token;
  if (student.kind === 'word') {
    return expected.kind === 'word' && isNearMiss(student.text, expected.text, vocabulary);
  }
  if (expected.kind === 'word') return false;
  if (student.value === expected.value) return true;
  return candidate.element !== 'T' && samePlainDecimal(student.value, expected.value);
}

function sameAt(
  student: readonly SpokenToken[],
  candidate: readonly CandidateToken[],
  i: number,
  j: number,
  vocabulary: ReadonlySet<string>,
): boolean {
  const said = student[i];
  const wanted = candidate[j];
  return said !== undefined && wanted !== undefined && same(said, wanted, vocabulary);
}

/** The longest common subsequence lengths over every pair of suffixes, as a lookup. */
function suffixLengths(
  student: readonly SpokenToken[],
  candidate: readonly CandidateToken[],
  vocabulary: ReadonlySet<string>,
): (i: number, j: number) => number {
  const width = candidate.length + 1;
  const table = Array.from({ length: (student.length + 1) * width }, () => 0);
  const at = (i: number, j: number): number => table[i * width + j] ?? 0;
  for (let i = student.length - 1; i >= 0; i -= 1) {
    for (let j = candidate.length - 1; j >= 0; j -= 1) {
      const matched = sameAt(student, candidate, i, j, vocabulary) ? 1 + at(i + 1, j + 1) : 0;
      table[i * width + j] = Math.max(matched, at(i + 1, j), at(i, j + 1));
    }
  }
  return at;
}

/** Aligns the student tokens with a candidate's as a longest common subsequence, earliest match first. */
function align(
  student: readonly SpokenToken[],
  candidate: readonly CandidateToken[],
  vocabulary: ReadonlySet<string>,
): Pair[] {
  const at = suffixLengths(student, candidate, vocabulary);
  const pairs: Pair[] = [];
  let i = 0;
  let j = 0;
  while (i < student.length && j < candidate.length) {
    if (sameAt(student, candidate, i, j, vocabulary) && at(i, j) === 1 + at(i + 1, j + 1)) {
      pairs.push({ student: i, candidate: j });
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

/** The span from the first token's start to the last one's end. */
function spanOf(tokens: readonly SpokenToken[]): Span {
  return { start: tokens[0]?.start ?? 0, end: tokens.at(-1)?.end ?? 0 };
}

/** A candidate aligned with the typed text, a stray expect clause cut first where it has no clause. */
function alignCandidate(
  candidate: Candidate,
  tokens: readonly SpokenToken[],
  vocabulary: ReadonlySet<string>,
): Alignment {
  const hasExpect = candidate.tokens.some((token) => token.element === 'A.expect');
  const clause = hasExpect ? undefined : strayExpect(tokens);
  if (clause === undefined) {
    return {
      candidate,
      student: [...tokens],
      stray: undefined,
      pairs: align(tokens, candidate.tokens, vocabulary),
    };
  }
  const student = [...tokens.slice(0, clause.from), ...tokens.slice(clause.to + 1)];
  const stray = spanOf(tokens.slice(clause.from, clause.to + 1));
  return { candidate, student, stray, pairs: align(student, candidate.tokens, vocabulary) };
}

/** The candidate with the most matches, the earliest winning a tie. */
function bestAlignment(
  candidates: readonly Candidate[],
  tokens: readonly SpokenToken[],
  vocabulary: ReadonlySet<string>,
): Alignment {
  const [first, ...rest] = candidates.map((candidate) =>
    alignCandidate(candidate, tokens, vocabulary),
  );
  if (first === undefined)
    throw new Error('gradeText: the reading yields no candidate to grade against');
  return rest.reduce(
    (best, alignment) => (alignment.pairs.length > best.pairs.length ? alignment : best),
    first,
  );
}

function matchedAt(alignment: Alignment, pair: Pair | undefined): MatchedToken | undefined {
  if (pair === undefined) return undefined;
  const student = alignment.student[pair.student];
  const candidate = alignment.candidate.tokens[pair.candidate];
  return student === undefined || candidate === undefined
    ? undefined
    : { student, element: candidate.element };
}

/** Every gap after the first match, in text order; the one before it is the callsign region. */
function gapsOf(alignment: Alignment): Gap[] {
  const { pairs, student, candidate } = alignment;
  return pairs.map((before, index) => {
    const after = pairs[index + 1];
    return {
      student: student.slice(before.student + 1, after?.student ?? student.length),
      candidate: candidate.tokens.slice(
        before.candidate + 1,
        after?.candidate ?? candidate.tokens.length,
      ),
      before: matchedAt(alignment, before),
      after: matchedAt(alignment, after),
    };
  });
}

function marksOf(marks: Map<GradedElement, GapMarks>, element: GradedElement): GapMarks {
  const existing = marks.get(element);
  if (existing !== undefined) return existing;
  const created: GapMarks = { outOfOrder: false, blocks: [], filler: [], tiers: [] };
  marks.set(element, created);
  return created;
}

function tier(airport: AirportData, verdict: Verdict, id: string): Tier {
  return { verdict, rows: citePhraseology(airport, id) };
}

function elementTokens(candidate: Candidate, element: GradedElement): number[] {
  return candidate.tokens.flatMap((token, index) => (token.element === element ? [index] : []));
}

/** An element none of the matches touch, and the tokens of the block that say it whole. */
type Misplaced = { element: GradedElement; said: SpokenToken[] };

/** The block tokens that say the wanted tokens in order, earliest first, where the block says them all. */
function subsequenceOf(
  wanted: readonly CandidateToken[],
  block: readonly SpokenToken[],
  vocabulary: ReadonlySet<string>,
): SpokenToken[] | undefined {
  const said: SpokenToken[] = [];
  for (const token of block) {
    const next = wanted[said.length];
    if (next !== undefined && same(token, next, vocabulary)) said.push(token);
  }
  return said.length === wanted.length ? said : undefined;
}

/** The first element, in grading order, that none of the matches touch and that the block says whole. */
function outOfOrderElement(block: readonly SpokenToken[], walk: Walk): Misplaced | undefined {
  const { candidate } = walk.alignment;
  for (const element of GRADED_ORDER) {
    const indices = elementTokens(candidate, element);
    if (indices.length === 0 || indices.some((index) => walk.matched.has(index))) continue;
    const wanted = indices.flatMap((index) => candidate.tokens[index] ?? []);
    const said = subsequenceOf(wanted, block, walk.vocabulary);
    if (said !== undefined) return { element, said };
  }
  return undefined;
}

function isFacilityWord(gap: Gap, before: MatchedToken, expected: ResolvedClearance): boolean {
  const [only, ...rest] = gap.student;
  return (
    rest.length === 0 &&
    only?.kind === 'word' &&
    FACILITY_WORDS.has(only.text) &&
    before.element === 'R.route' &&
    expected.route.value.template === 'as_filed'
  );
}

function isRestatement(gap: Gap, before: MatchedToken): boolean {
  const [only, ...rest] = gap.student;
  return (
    rest.length === 0 &&
    only?.kind === 'number' &&
    only.form === 'group' &&
    before.student.kind === 'number' &&
    before.student.value === only.value
  );
}

/** A gap with nothing unmatched on the reading's side: a facility word, a restatement or filler. */
function markExtraWords(gap: Gap, span: Span, walk: Walk): void {
  const { before, after } = gap;
  if (before === undefined) return;
  if (isFacilityWord(gap, before, walk.expected)) {
    const route = marksOf(walk.marks, 'R.route');
    route.blocks.push(span);
    route.tiers.push(tier(walk.airport, 'correct', 'R-FACILITY-WORD'));
    return;
  }
  if (isRestatement(gap, before)) {
    const restated = marksOf(walk.marks, before.element);
    restated.blocks.push(span);
    restated.tiers.push(tier(walk.airport, 'acceptable', 'S-GROUP-FORM'));
    return;
  }
  const owner = marksOf(walk.marks, (after ?? before).element);
  owner.filler.push(span);
  owner.tiers.push(tier(walk.airport, 'acceptable', 'S-FILLER'));
}

function markMisplaced(element: GradedElement, span: Span, walk: Walk): void {
  const marks = marksOf(walk.marks, element);
  marks.outOfOrder = true;
  marks.blocks.push(span);
}

/** Marks the block out of order on the element it says whole, where there is one. */
function markOutOfOrder(block: readonly SpokenToken[], walk: Walk): boolean {
  const misplaced = outOfOrderElement(block, walk);
  if (misplaced === undefined) return false;
  markMisplaced(misplaced.element, spanOf(block), walk);
  return true;
}

/**
 * Marks an element the callsign stretch says whole out of order, on the words that say it: the rest
 * of the stretch is the callsign.
 */
function markLeading(leading: readonly SpokenToken[], walk: Walk): void {
  const misplaced = outOfOrderElement(leading, walk);
  if (misplaced !== undefined) markMisplaced(misplaced.element, spanOf(misplaced.said), walk);
}

/** Puts one gap's unmatched student tokens on the element they belong to. */
function markGap(gap: Gap, walk: Walk): void {
  if (markOutOfOrder(gap.student, walk)) return;
  const span = spanOf(gap.student);
  const substituted = gap.candidate[0];
  if (substituted !== undefined) {
    marksOf(walk.marks, substituted.element).blocks.push(span);
    return;
  }
  markExtraWords(gap, span, walk);
}

/**
 * Walks the alignment's gaps, in text order, into what each element carries from them.
 *
 * The stretch before the first match is the callsign and is otherwise ignored, but an element it
 * says whole is out of order there as anywhere else.
 */
function walkGaps(
  alignment: Alignment,
  expected: ResolvedClearance,
  airport: AirportData,
  vocabulary: ReadonlySet<string>,
): Map<GradedElement, GapMarks> {
  const walk: Walk = {
    alignment,
    matched: new Set(alignment.pairs.map((pair) => pair.candidate)),
    marks: new Map(),
    expected,
    airport,
    vocabulary,
  };
  const { student, pairs } = alignment;
  const leading = student.slice(0, pairs[0]?.student ?? student.length);
  if (leading.length > 0) markLeading(leading, walk);
  for (const gap of gapsOf(alignment)) {
    if (gap.student.length > 0) markGap(gap, walk);
  }
  return walk.marks;
}

/** The tier a matched word pair sets: a word typed a letter or two away is the word it says. */
function spellingTiers(student: SpokenToken, expected: SpokenToken, airport: AirportData): Tier[] {
  if (student.kind !== 'word' || expected.kind !== 'word') return [];
  return student.text === expected.text ? [] : [tier(airport, 'correct', 'S-SPELLING')];
}

/** The tiers a matched number pair sets: group form and a restatement against digits, and "nine". */
function numberTiers(student: SpokenToken, expected: SpokenToken, airport: AirportData): Tier[] {
  if (student.kind !== 'number' || expected.kind !== 'number') return [];
  const niner = student.saidNine && !expected.saidNine ? [tier(airport, 'wrong', 'S-NINER')] : [];
  return [...groupFormTiers(student, expected, airport), ...niner];
}

/** A number the reading speaks digit by digit: wrong in group form alone, acceptable restated. */
function groupFormTiers(student: NumberToken, expected: NumberToken, airport: AirportData): Tier[] {
  if (expected.form !== 'digits') return [];
  if (student.form === 'group') return [tier(airport, 'wrong', 'S-GROUP-FORM')];
  return student.restated ? [tier(airport, 'acceptable', 'S-GROUP-FORM')] : [];
}

/** The tier the candidate reading itself sets on an element. */
function candidateTiers(element: GradedElement, grading: Grading): Tier[] {
  const { candidate } = grading.alignment;
  const { airport, expected } = grading;
  if (element === 'R.route' && candidate.route === 'full') {
    return [tier(airport, 'acceptable', 'R-FULL-ROUTE')];
  }
  if (element === 'R.route' && candidate.route === 'end') {
    return [tier(airport, 'acceptable', 'R-THEN-AS-FILED-END')];
  }
  if (element === 'A.expect' && candidate.expect === 'redundant') {
    return [{ verdict: 'acceptable', rows: expected.redundantExpect.citations }];
  }
  return [];
}

/** Each row once, by id, in the order first given. */
function citeOnce(rows: readonly RuleCitation[]): RuleCitation[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function lowest(verdicts: readonly Verdict[]): Verdict {
  return verdicts.reduce<Verdict>(
    (low, verdict) => (VERDICT_RANK[verdict] > VERDICT_RANK[low] ? verdict : low),
    'correct',
  );
}

/** The spans merged where only whitespace and punctuation lie between them. */
function mergeSpans(text: string, spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (
      last !== undefined &&
      (span.start <= last.end || LABEL_JOINER.test(text.slice(last.end, span.start)))
    ) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function actualLabel(text: string, merged: readonly Span[]): string {
  if (merged.length === 0) return NOT_HEARD;
  return merged.map((span) => text.slice(span.start, span.end)).join(LABEL_BREAK);
}

function pushRun(runs: SaidRun[], text: string, kind: SaidRun['kind']): void {
  if (text.length > 0) runs.push({ text, kind });
}

/** One merged span of the text, split at the filler inside it. */
function spanRuns(text: string, span: Span, filler: readonly Span[]): SaidRun[] {
  const inside = filler
    .filter((stretch) => stretch.start >= span.start && stretch.end <= span.end)
    .sort((a, b) => a.start - b.start);
  const runs: SaidRun[] = [];
  let at = span.start;
  for (const stretch of inside) {
    const from = Math.max(at, stretch.start);
    pushRun(runs, text.slice(at, from), 'said');
    pushRun(runs, text.slice(from, stretch.end), 'filler');
    at = Math.max(at, stretch.end);
  }
  pushRun(runs, text.slice(at, span.end), 'said');
  return runs;
}

/** The merged spans as runs, each split at its filler, a break between two spans as the label has one. */
function saidRuns(text: string, merged: readonly Span[], filler: readonly Span[]): SaidRun[] {
  return merged.flatMap((span, index) => [
    ...(index === 0 ? [] : [{ text: LABEL_BREAK, kind: 'break' as const }]),
    ...spanRuns(text, span, filler),
  ]);
}

function pushExpected(runs: ExpectedRun[], text: string, missed: boolean): void {
  if (text.length > 0) runs.push({ text, missed });
}

/** The words of one element, the spans never said marked, the text around them left plain. */
function markedExpected(words: string, missed: readonly Span[]): ExpectedRun[] {
  const runs: ExpectedRun[] = [];
  let at = 0;
  for (const span of mergeSpans(words, missed)) {
    pushExpected(runs, words.slice(at, span.start), false);
    pushExpected(runs, words.slice(span.start, span.end), true);
    at = span.end;
  }
  pushExpected(runs, words.slice(at), false);
  return runs;
}

/** The whole label as one run nobody missed, and no run at all where the reading has no words. */
function wholeExpected(label: string): ExpectedRun[] {
  return label === '' ? [] : [{ text: label, missed: false }];
}

function expectedLabel(element: GradedElement, spoken: SpokenClearance): string {
  const words = spoken.parts.find((part) => part.element === element)?.words;
  if (words !== undefined) return words;
  return element === 'A.expect' ? NO_EXPECT_CLAUSE : '';
}

/** Everything the per-element verdict reads. */
type Grading = {
  text: string;
  spoken: SpokenClearance;
  expected: ResolvedClearance;
  airport: AirportData;
  alignment: Alignment;
  marks: Map<GradedElement, GapMarks>;
  matchedBy: Map<number, SpokenToken>;
};

/** The element's candidate tokens with the student tokens that matched them, where any did. */
function matchedPairs(
  indices: readonly number[],
  grading: Grading,
): { student: SpokenToken; expected: SpokenToken }[] {
  return indices.flatMap((index) => {
    const student = grading.matchedBy.get(index);
    const expected = grading.alignment.candidate.tokens[index]?.token;
    return student === undefined || expected === undefined ? [] : [{ student, expected }];
  });
}

/** The element's candidate tokens no student token matched, as spans of the candidate's own words. */
function missedSpans(indices: readonly number[], grading: Grading): Span[] {
  return indices.flatMap((index) => {
    if (grading.matchedBy.has(index)) return [];
    const token = grading.alignment.candidate.tokens[index]?.token;
    return token === undefined ? [] : [{ start: token.start, end: token.end }];
  });
}

/**
 * The words an element was graded against, the ones the student never said marked.
 *
 * Words are marked only where some of the element's words were heard and others were not: an
 * element nothing was heard for, and one said in the wrong place, say nothing by marking every word
 * of them. The marks are cut from the chosen candidate's own words, which are the reading's own but
 * for a route read in full or closed on "then as filed", or a redundant expect clause.
 */
function expectedFor(
  element: GradedElement,
  indices: readonly number[],
  marks: GapMarks,
  grading: Grading,
): ExpectedRun[] {
  const label = expectedLabel(element, grading.spoken);
  const missed = missedSpans(indices, grading);
  if (marks.outOfOrder || missed.length === 0 || missed.length === indices.length) {
    return wholeExpected(label);
  }
  const words = grading.alignment.candidate.parts.find((part) => part.element === element)?.words;
  return words === undefined ? wholeExpected(label) : markedExpected(words, missed);
}

/** The verdict and rows of an element every token of which matched. */
function matchedVerdict(
  element: GradedElement,
  pairs: readonly { student: SpokenToken; expected: SpokenToken }[],
  marks: GapMarks,
  grading: Grading,
): { verdict: Verdict; citations: RuleCitation[] } {
  const { airport, expected, alignment } = grading;
  const tiers = [
    ...pairs.flatMap((pair) => numberTiers(pair.student, pair.expected, airport)),
    ...pairs.flatMap((pair) => spellingTiers(pair.student, pair.expected, airport)),
    ...marks.tiers,
    ...candidateTiers(element, grading),
  ];
  const redundant = element === 'A.expect' && alignment.candidate.expect === 'redundant';
  const own = redundant ? [] : OWN_ROWS[element](expected);
  return {
    verdict: lowest(tiers.map((entry) => entry.verdict)),
    citations: citeOnce([...own, ...tiers.flatMap((entry) => entry.rows)]),
  };
}

/**
 * Grades an element the chosen reading gives no words: wrong where a stray expect clause was cut
 * for it, and otherwise right, with nothing said for it.
 */
function emptyElementGrade(
  labels: Omit<TextGrade, 'verdict' | 'citations'>,
  stray: Span | undefined,
  own: readonly RuleCitation[],
): TextGrade {
  if (stray !== undefined) return { ...labels, verdict: 'wrong', citations: citeOnce(own) };
  const actual = labels.element === 'A.expect' ? NO_EXPECT_CLAUSE : labels.actualLabel;
  return { ...labels, actualLabel: actual, verdict: 'correct', citations: citeOnce(own) };
}

/** Grades one element of the chosen alignment. */
function gradeElement(element: GradedElement, grading: Grading): TextGrade {
  const { text, alignment, airport, expected } = grading;
  const indices = elementTokens(alignment.candidate, element);
  const marks = grading.marks.get(element) ?? {
    outOfOrder: false,
    blocks: [],
    filler: [],
    tiers: [],
  };
  const pairs = matchedPairs(indices, grading);
  const stray = element === 'A.expect' ? alignment.stray : undefined;
  const spans = [
    ...pairs.map((pair) => ({ start: pair.student.start, end: pair.student.end })),
    ...marks.blocks,
    ...marks.filler,
    ...(stray === undefined ? [] : [stray]),
  ];
  const merged = mergeSpans(text, spans);
  const labels = {
    element,
    expectedLabel: expectedLabel(element, grading.spoken),
    actualLabel: actualLabel(text, merged),
    said: saidRuns(text, merged, marks.filler),
    expected: expectedFor(element, indices, marks, grading),
  };
  const own = OWN_ROWS[element](expected);
  if (indices.length === 0) return emptyElementGrade(labels, stray, own);
  if (pairs.length < indices.length) {
    const order = marks.outOfOrder ? citePhraseology(airport, 'S-ORDER') : [];
    return { ...labels, verdict: 'wrong', citations: citeOnce([...own, ...order]) };
  }
  return { ...labels, ...matchedVerdict(element, pairs, marks, grading) };
}

/**
 * Grades a typed clearance element by element against the engine's reading.
 *
 * The text is aligned with every candidate reading (the reading as spoken, the route in full or
 * closed on "then as filed", the redundant expect clause) and graded against the one it matches
 * best. Unmatched words between matches are read as an element out of order, a value said in place
 * of another, a facility word, a restated number or filler; words before the first match are the
 * callsign and are not graded, unless they say a whole element out of order.
 *
 * @param text What the student typed.
 * @param spoken The engine's reading of the clearance (`speakClearance`).
 * @param expected The clearance the engine resolved.
 * @param airport The airport data: its lexicon and its phraseology rows.
 * @returns Exactly eight grades, in the order C, R.sid, R.route, A.phrase, A.expect, F, T, RWY.
 */
export function gradeText(
  text: string,
  spoken: SpokenClearance,
  expected: ResolvedClearance,
  airport: AirportData,
): TextGrade[] {
  const lexicon = lexiconFor(airport);
  const tokens = normaliseSpoken(text, lexicon);
  const candidates = candidatesFor(spoken, expected);
  const vocabulary = vocabularyOf(candidates, lexicon, airport);
  const alignment = bestAlignment(candidates, tokens, vocabulary);
  const matchedBy = new Map<number, SpokenToken>();
  for (const pair of alignment.pairs) {
    const student = alignment.student[pair.student];
    if (student !== undefined) matchedBy.set(pair.candidate, student);
  }
  const grading: Grading = {
    text,
    spoken,
    expected,
    airport,
    alignment,
    marks: walkGaps(alignment, expected, airport, vocabulary),
    matchedBy,
  };
  return GRADED_ORDER.map((element) => gradeElement(element, grading));
}
