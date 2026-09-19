import type { AirportData, RouteTemplate } from '@/data/schema.ts';
import { citePhraseology } from '@/rules/cite.ts';
import { speakExpect } from '@/rules/speak.ts';
import type { SpokenClearance, SpokenElement, SpokenPart } from '@/rules/speak.ts';
import { lexiconFor, normaliseSpoken } from '@/rules/text/normalise.ts';
import type { Lexicon, SpokenToken } from '@/rules/text/normalise.ts';
import { isNearMiss } from '@/rules/text/spelling.ts';
import type { Grade, ResolvedClearance, RuleCitation, Verdict } from '@/rules/types.ts';

/**
 * A run of the typed text as a result row shows it.
 *
 * Words said, filler among them, the break between two stretches, words the reading does not have,
 * an element said out of its place, or a word typed a letter or two from the word it reads as.
 */
export type SaidRun =
  | { text: string; kind: 'said' | 'filler' | 'break' | 'wrong' | 'misplaced' }
  | { text: string; kind: 'spelling'; readAs: string };

/** A run of the words the reading has, as a result row shows it: said, or never said at all. */
export type ExpectedRun = { text: string; missed: boolean };

/**
 * One graded element of a typed clearance, with what was said for it as runs.
 *
 * `said` joins back to `actualLabel` wherever anything was heard, and is empty where nothing was.
 * `expected` joins back to the words the element was graded against, the ones never said marked.
 * `remarks` names the kinds of miss the matcher saw, in words, and is empty on a correct element.
 */
export type TextGrade = Grade & { said: SaidRun[]; expected: ExpectedRun[]; remarks: string[] };

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

/** How a stretch of the typed text is marked, and what a near-miss spelling stretch reads as. */
type MarkKind = { kind: 'filler' | 'wrong' | 'misplaced' } | { kind: 'spelling'; readAs: string };

/** A stretch of the typed text, and how the said runs mark it. */
type Mark = { span: Span } & MarkKind;

/** How a candidate reads the route: as spoken, in full, or with "then as filed" for its closing "direct". */
type RouteOption = 'base' | 'full' | 'end';

/**
 * The route reading a typed clearance is held to.
 *
 * `abbreviated` is the reading spoken on frequency, which hands the route over as filed where it
 * can; `full` is the route read element by element to its end, as a full route clearance takes.
 */
export type RouteReading = 'abbreviated' | 'full';

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

/**
 * What the gaps of an alignment put on one element.
 *
 * `blocks` is every stretch said for the element that matched nothing, which its label is built
 * from; `substituted` and `misplaced` are the two of those the said runs mark, a value said where
 * the reading has other words and an element said out of its place.
 */
type GapMarks = {
  outOfOrder: boolean;
  blocks: Span[];
  substituted: Span[];
  misplaced: Span[];
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

/** The fewest typed numbers a join takes: one number already says itself. */
const MIN_JOINED_PIECES = 2;

/** Text between two spans that leaves them adjacent in a label. */
const LABEL_JOINER = /^[\s\p{P}]*$/u;

/** What a label reads between two stretches of the text that are not adjacent. */
const LABEL_BREAK = ' … ';

const NOT_HEARD = '(not heard)';

const NO_EXPECT_CLAUSE = 'no expect clause';

/** The kinds of miss a results row names in words, one short line under what was said. */
const REMARKS = {
  notHeard: 'not heard',
  strayExpect: 'an expect clause this clearance does not have',
  outOfOrder: 'out of CRAFT order',
  niner: 'say niner, not nine',
  groupForm: 'group form alone — say the digits',
  restated: 'restated in group form — the digits alone are enough',
  fullRoute: 'the route read in full — the shorter reading is enough',
  thenAsFiled: '"then as filed" said where the reading ends on "direct"',
  frc: '"then as filed" said on a full route clearance — read the route to its end',
  redundantExpect: 'an expect clause the clearance can do without',
} as const;

/** The remark a route read longer than it had to be leaves on the reading spoken on frequency. */
const ROUTE_REMARKS: Readonly<Record<RouteOption, string | undefined>> = {
  base: undefined,
  full: REMARKS.fullRoute,
  end: REMARKS.thenAsFiled,
};

/** Whitespace and punctuation at either end of a stretch, which a remark quotes it without. */
const REMARK_EDGES = /^[\s\p{P}]+|[\s\p{P}]+$/gu;

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
 * The reading the student is held to comes first, so a text that reads as both is graded as the one
 * asked of it. A route vectored straight to its destination has no closing "direct" to trade for
 * "then as filed": the "direct" of "radar vectors direct" is the vectors, not the end of a route
 * read in full.
 */
function routeReadings(
  parts: readonly GradedPart[],
  fullRouteWords: string,
  template: RouteTemplate,
  routeReading: RouteReading,
): { option: RouteOption; parts: GradedPart[] }[] {
  const base = { option: 'base' as const, parts: [...parts] };
  const words = parts.find((part) => part.element === 'R.route')?.words;
  if (words === undefined) return [base];
  if (words !== fullRouteWords) {
    const full = {
      option: 'full' as const,
      parts: withWords(parts, 'R.route', fullRouteWords),
    };
    return routeReading === 'full' ? [full, base] : [base, full];
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

/** The expect readings a candidate may take: as spoken, and the redundant clause where one is allowed. */
function expectReadings(
  parts: readonly GradedPart[],
  expected: ResolvedClearance,
): { option: ExpectOption; parts: GradedPart[] }[] {
  const base = { option: 'base' as const, parts: [...parts] };
  const redundant = expected.redundantExpect.value;
  if (redundant === null) return [base];
  return [base, { option: 'redundant', parts: withExpect(parts, speakExpect(redundant)) }];
}

/** The clearance limit sentence, as the reading speaks it, around one name of the field. */
function limitWords(name: string): string {
  return `cleared to ${name} airport`;
}

/**
 * The names a candidate may call the field by, in the order ties are broken.
 *
 * The reading's own name comes first, then every other name the destination's row lists: its full
 * name, its short name and the names it also goes by are each the field itself, so a clearance that
 * names the field by any of them names the field.
 */
function nameReadings(
  parts: readonly GradedPart[],
  expected: ResolvedClearance,
  airport: AirportData,
): GradedPart[][] {
  const base = [...parts];
  const words = parts.find((part) => part.element === 'C')?.words;
  const row = airport.routeLibrary.destinations.find(
    (destination) => destination.icao === expected.clearedTo.value,
  );
  if (words === undefined || row === undefined) return [base];
  const named = [row.spoken, row.short, ...row.also].map(limitWords);
  const others = named.filter((said, index) => said !== words && named.indexOf(said) === index);
  return [base, ...others.map((said) => withWords(parts, 'C', said))];
}

/** Every candidate reading, route-major, the base reading first. */
function candidatesFor(
  spoken: SpokenClearance,
  expected: ResolvedClearance,
  airport: AirportData,
  routeReading: RouteReading,
): Candidate[] {
  const parts = spoken.parts.filter(isGradedPart);
  const { template } = expected.route.value;
  return routeReadings(parts, spoken.fullRouteWords, template, routeReading).flatMap((route) =>
    expectReadings(route.parts, expected).flatMap((expect) =>
      nameReadings(expect.parts, expected, airport).map((named) => ({
        route: route.option,
        expect: expect.option,
        parts: named,
        tokens: tagged(named),
      })),
    ),
  );
}

function addWords(words: Set<string>, tokens: readonly SpokenToken[]): void {
  for (const token of tokens) {
    if (token.kind === 'word') words.add(token.text);
  }
}

/** Every word the candidate readings say. */
function candidateWords(candidates: readonly Candidate[]): Set<string> {
  const words = new Set<string>();
  for (const candidate of candidates) {
    addWords(
      words,
      candidate.tokens.map((tagged) => tagged.token),
    );
  }
  return words;
}

/**
 * The lexicon the typed text is read with: the airport's, less every identifier a reading spells
 * as one of its own words, so a word the clearance says is read as typed and not as a fix.
 */
function typedLexicon(lexicon: Lexicon, candidates: readonly Candidate[]): Lexicon {
  const words = candidateWords(candidates);
  return Object.fromEntries(
    Object.entries(lexicon).filter(([identifier]) => !words.has(identifier.toLowerCase())),
  );
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
  const words = candidateWords(candidates);
  for (const spoken of Object.values(lexicon)) {
    addWords(words, normaliseSpoken(spoken, {}));
  }
  for (const rule of airport.phraseologyRules) {
    for (const run of rule.text.toLowerCase().matchAll(LETTER_RUN)) words.add(run[0]);
  }
  return words;
}

/** Every value a candidate reading says as a number. */
function candidateNumbers(candidates: readonly Candidate[]): ReadonlySet<string> {
  const values = new Set<string>();
  for (const candidate of candidates) {
    for (const { token } of candidate.tokens) {
      if (token.kind === 'number') values.add(token.value);
    }
  }
  return values;
}

/** The number tokens from `from` on, up to the first token that is not one. */
function numberRun(tokens: readonly SpokenToken[], from: number): NumberToken[] {
  const run: NumberToken[] = [];
  for (let index = from; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== 'number') break;
    run.push(token);
  }
  return run;
}

/** The longest run of numbers from `from` whose digits, in order, spell a number a reading says. */
function joinableAt(
  tokens: readonly SpokenToken[],
  from: number,
  values: ReadonlySet<string>,
): NumberToken[] | undefined {
  const run = numberRun(tokens, from);
  for (let length = run.length; length >= MIN_JOINED_PIECES; length -= 1) {
    const pieces = run.slice(0, length);
    if (values.has(digitsOf(pieces))) return pieces;
  }
  return undefined;
}

function digitsOf(pieces: readonly NumberToken[]): string {
  return pieces.map((piece) => piece.value).join('');
}

/** How a number typed in pieces was said: figures where every piece was, group where any piece was. */
function joinedForm(pieces: readonly NumberToken[]): NumberToken['form'] {
  if (pieces.some((piece) => piece.form === 'group')) return 'group';
  return pieces.every((piece) => piece.form === 'figures') ? 'figures' : 'digits';
}

/** The pieces of one number as the single number they spell, spanning all of them. */
function joinedNumber(pieces: readonly NumberToken[]): SpokenToken {
  const span = spanOf(pieces);
  return {
    kind: 'number',
    value: digitsOf(pieces),
    form: joinedForm(pieces),
    saidNine: pieces.some((piece) => piece.saidNine),
    restated: false,
    start: span.start,
    end: span.end,
  };
}

/**
 * The typed tokens with the pieces of one number read as that number.
 *
 * A number run ends at typed figures, which keeps "expect 10000 one zero minutes" two numbers, so a
 * squawk typed `00 six two` arrives in pieces; where consecutive numbers spell a number one of the
 * readings says, they are that one number. The longest run wins at each place, and a word between
 * two numbers keeps them apart.
 */
function joinNumbers(tokens: readonly SpokenToken[], values: ReadonlySet<string>): SpokenToken[] {
  const joined: SpokenToken[] = [];
  let index = 0;
  while (index < tokens.length) {
    const pieces = joinableAt(tokens, index, values);
    if (pieces !== undefined) {
      joined.push(joinedNumber(pieces));
      index += pieces.length;
      continue;
    }
    const token = tokens[index];
    if (token !== undefined) joined.push(token);
    index += 1;
  }
  return joined;
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

/** How well an alignment does: the matches it makes, and how many of them follow another match. */
type Score = { matches: number; adjacent: number };

/** The score of an alignment that matches nothing. */
const NO_MATCHES: Score = { matches: 0, adjacent: 0 };

/** Ranks two scores: more matches wins, and among equals more adjacent matches. */
function compareScores(a: Score, b: Score): number {
  return a.matches - b.matches || a.adjacent - b.adjacent;
}

/** The better of two scores, the first winning a tie. */
function better(a: Score, b: Score): Score {
  return compareScores(b, a) > 0 ? b : a;
}

/** A suffix's score with one more match at its head, which is adjacent after a matched pair. */
function withMatch(rest: Score, afterMatch: boolean): Score {
  return { matches: rest.matches + 1, adjacent: rest.adjacent + (afterMatch ? 1 : 0) };
}

/**
 * The best score of every pair of suffixes, in both states, as a lookup.
 *
 * `afterMatch` says the pair before the cell is a match, which is what a match at the cell needs to
 * be adjacent to, so the two states are scored side by side: the same suffixes score differently
 * depending on whether the match at their head has a match behind it.
 */
type SuffixScores = (i: number, j: number, afterMatch: boolean) => Score;

function suffixScores(
  student: readonly SpokenToken[],
  candidate: readonly CandidateToken[],
  vocabulary: ReadonlySet<string>,
): SuffixScores {
  const width = candidate.length + 1;
  const size = (student.length + 1) * width;
  const joined = Array.from({ length: size }, () => NO_MATCHES);
  const alone = Array.from({ length: size }, () => NO_MATCHES);
  const at: SuffixScores = (i, j, afterMatch) =>
    (afterMatch ? joined : alone)[i * width + j] ?? NO_MATCHES;
  for (let i = student.length - 1; i >= 0; i -= 1) {
    for (let j = candidate.length - 1; j >= 0; j -= 1) {
      const skipped = better(at(i + 1, j, false), at(i, j + 1, false));
      const rest = sameAt(student, candidate, i, j, vocabulary)
        ? at(i + 1, j + 1, true)
        : undefined;
      joined[i * width + j] = rest === undefined ? skipped : better(withMatch(rest, true), skipped);
      alone[i * width + j] = rest === undefined ? skipped : better(withMatch(rest, false), skipped);
    }
  }
  return at;
}

/**
 * Aligns the student tokens with a candidate's, as many of them matched as can be.
 *
 * Among the alignments that match the most tokens, the one with the most adjacent matches wins: two
 * neighbouring typed words that say two neighbouring words of the reading belong together, so a word
 * the reading says twice goes to the placement its neighbour speaks as well. Full ties go to the
 * earliest match.
 */
function align(
  student: readonly SpokenToken[],
  candidate: readonly CandidateToken[],
  vocabulary: ReadonlySet<string>,
): Pair[] {
  const at = suffixScores(student, candidate, vocabulary);
  const pairs: Pair[] = [];
  let i = 0;
  let j = 0;
  let afterMatch = false;
  while (i < student.length && j < candidate.length) {
    const taken = sameAt(student, candidate, i, j, vocabulary)
      ? withMatch(at(i + 1, j + 1, true), afterMatch)
      : undefined;
    if (taken !== undefined && compareScores(taken, at(i, j, afterMatch)) === 0) {
      pairs.push({ student: i, candidate: j });
      i += 1;
      j += 1;
      afterMatch = true;
    } else {
      if (compareScores(at(i + 1, j, false), at(i, j + 1, false)) >= 0) i += 1;
      else j += 1;
      afterMatch = false;
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

/** How many of a candidate's own clearance limit tokens nothing typed said. */
function unsaidLimitTokens(alignment: Alignment): number {
  const said = new Set(alignment.pairs.map((pair) => pair.candidate));
  return alignment.candidate.tokens.filter(
    (token, index) => token.element === 'C' && !said.has(index),
  ).length;
}

/**
 * The better of two aligned candidates: the one that matches more tokens, and among equals the one
 * that leaves fewer of its own clearance limit words unsaid, so a field named by a shorter name its
 * row lists is that name rather than the longer one with words never said.
 */
function betterAligned(best: Alignment, alignment: Alignment): Alignment {
  if (alignment.pairs.length !== best.pairs.length) {
    return alignment.pairs.length > best.pairs.length ? alignment : best;
  }
  return unsaidLimitTokens(alignment) < unsaidLimitTokens(best) ? alignment : best;
}

/** The candidate that reads the typed text best, the earliest winning a tie. */
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
  return rest.reduce(betterAligned, first);
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

/** What an element the gap walk left nothing on carries. */
function noMarks(): GapMarks {
  return { outOfOrder: false, blocks: [], substituted: [], misplaced: [], filler: [], tiers: [] };
}

function marksOf(marks: Map<GradedElement, GapMarks>, element: GradedElement): GapMarks {
  const existing = marks.get(element);
  if (existing !== undefined) return existing;
  const created = noMarks();
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
  marks.misplaced.push(span);
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
    const marks = marksOf(walk.marks, substituted.element);
    marks.blocks.push(span);
    marks.substituted.push(span);
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

/**
 * Whether the chosen reading hands part of the route over as filed rather than reading it to its
 * end, which a full route clearance does not allow.
 */
function handsOverRoute(grading: Grading): boolean {
  const words = grading.alignment.candidate.parts.find((part) => part.element === 'R.route')?.words;
  return words !== undefined && words !== grading.spoken.fullRouteWords;
}

/** The tier the chosen route reading sets: a route read longer than it had to be, or handed over. */
function routeTiers(grading: Grading): Tier[] {
  const { airport } = grading;
  if (grading.routeReading === 'full') {
    return handsOverRoute(grading) ? [tier(airport, 'wrong', 'R-FRC')] : [];
  }
  const { route } = grading.alignment.candidate;
  if (route === 'full') return [tier(airport, 'acceptable', 'R-FULL-ROUTE')];
  if (route === 'end') return [tier(airport, 'acceptable', 'R-THEN-AS-FILED-END')];
  return [];
}

/** The tier the candidate reading itself sets on an element. */
function candidateTiers(element: GradedElement, grading: Grading): Tier[] {
  const { candidate } = grading.alignment;
  const { expected } = grading;
  if (element === 'R.route') return routeTiers(grading);
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

function pushRun(runs: SaidRun[], run: SaidRun): void {
  if (run.text.length > 0) runs.push(run);
}

/** The run a marked stretch reads as, which carries the word a near-miss spelling stands for. */
function markRun(text: string, mark: MarkKind): SaidRun {
  return mark.kind === 'spelling'
    ? { text, kind: 'spelling', readAs: mark.readAs }
    : { text, kind: mark.kind };
}

/** One merged span of the text, split at the marks inside it; two that touch are left apart. */
function spanRuns(text: string, span: Span, marks: readonly Mark[]): SaidRun[] {
  const inside = marks
    .filter((mark) => mark.span.start >= span.start && mark.span.end <= span.end)
    .sort((a, b) => a.span.start - b.span.start);
  const runs: SaidRun[] = [];
  let at = span.start;
  for (const mark of inside) {
    const from = Math.max(at, mark.span.start);
    pushRun(runs, { text: text.slice(at, from), kind: 'said' });
    pushRun(runs, markRun(text.slice(from, mark.span.end), mark));
    at = Math.max(at, mark.span.end);
  }
  pushRun(runs, { text: text.slice(at, span.end), kind: 'said' });
  return runs;
}

/** The merged spans as runs, each split at its marks, a break between two spans as the label has one. */
function saidRuns(text: string, merged: readonly Span[], marks: readonly Mark[]): SaidRun[] {
  return merged.flatMap((span, index) => [
    ...(index === 0 ? [] : [{ text: LABEL_BREAK, kind: 'break' as const }]),
    ...spanRuns(text, span, marks),
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

/** The words an element is graded against: the reading's own, the route's in full where that is asked. */
function expectedLabel(
  element: GradedElement,
  spoken: SpokenClearance,
  routeReading: RouteReading,
): string {
  const words = spoken.parts.find((part) => part.element === element)?.words;
  if (words === undefined) return element === 'A.expect' ? NO_EXPECT_CLAUSE : '';
  return element === 'R.route' && routeReading === 'full' ? spoken.fullRouteWords : words;
}

/** Everything the per-element verdict reads. */
type Grading = {
  text: string;
  spoken: SpokenClearance;
  expected: ResolvedClearance;
  airport: AirportData;
  routeReading: RouteReading;
  alignment: Alignment;
  marks: Map<GradedElement, GapMarks>;
  matchedBy: Map<number, SpokenToken>;
};

/** A candidate token of an element and the student token that matched it. */
type MatchedPair = { student: SpokenToken; expected: SpokenToken };

/** The element's candidate tokens with the student tokens that matched them, where any did. */
function matchedPairs(indices: readonly number[], grading: Grading): MatchedPair[] {
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
 * for a route read in full or closed on "then as filed", or a redundant expect clause. A route
 * handed over as filed where the whole of it was asked for is shown whole instead: its words are
 * the route in full, which the chosen candidate does not speak and so cannot mark inside.
 */
function expectedFor(
  element: GradedElement,
  indices: readonly number[],
  marks: GapMarks,
  grading: Grading,
): ExpectedRun[] {
  const label = expectedLabel(element, grading.spoken, grading.routeReading);
  const missed = missedSpans(indices, grading);
  const routeInFull = element === 'R.route' && grading.routeReading === 'full';
  if (
    marks.outOfOrder ||
    missed.length === 0 ||
    missed.length === indices.length ||
    (routeInFull && handsOverRoute(grading))
  ) {
    return wholeExpected(label);
  }
  const words = grading.alignment.candidate.parts.find((part) => part.element === element)?.words;
  return words === undefined ? wholeExpected(label) : markedExpected(words, missed);
}

/** The verdict and rows of an element every token of which matched. */
function matchedVerdict(
  element: GradedElement,
  pairs: readonly MatchedPair[],
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

/** A grade before the remarks its marks read as are put on it. */
type Unremarked = Omit<TextGrade, 'remarks'>;

/** Everything a grade carries but its verdict, its citations and its remarks. */
type ElementLabels = Omit<Unremarked, 'verdict' | 'citations'>;

/** One element's place in the chosen alignment: its tokens, its marks, and what matched it. */
type ElementParts = {
  element: GradedElement;
  indices: number[];
  marks: GapMarks;
  pairs: MatchedPair[];
  stray: Span | undefined;
};

function partsOf(element: GradedElement, grading: Grading): ElementParts {
  const indices = elementTokens(grading.alignment.candidate, element);
  return {
    element,
    indices,
    marks: grading.marks.get(element) ?? noMarks(),
    pairs: matchedPairs(indices, grading),
    stray: element === 'A.expect' ? grading.alignment.stray : undefined,
  };
}

/** Every stretch of the typed text one element is read from, before they are merged. */
function elementSpans(parts: ElementParts): Span[] {
  const { marks, stray } = parts;
  return [
    ...parts.pairs.map((pair) => ({ start: pair.student.start, end: pair.student.end })),
    ...marks.blocks,
    ...marks.filler,
    ...(stray === undefined ? [] : [stray]),
  ];
}

/** The mark a matched pair leaves: a number said wrong, or a word typed a letter or two away. */
function pairMark(pair: MatchedPair, airport: AirportData): Mark[] {
  const { student, expected } = pair;
  const span = { start: student.start, end: student.end };
  if (numberTiers(student, expected, airport).some((entry) => entry.verdict === 'wrong')) {
    return [{ span, kind: 'wrong' }];
  }
  if (spellingTiers(student, expected, airport).length === 0 || expected.kind !== 'word') return [];
  return [{ span, kind: 'spelling', readAs: expected.text }];
}

/** Every mark the said runs of one element carry, from its gaps and from its matched pairs. */
function saidMarks(parts: ElementParts, grading: Grading): Mark[] {
  const { marks } = parts;
  return [
    ...marks.filler.map((span): Mark => ({ span, kind: 'filler' })),
    ...marks.substituted.map((span): Mark => ({ span, kind: 'wrong' })),
    ...marks.misplaced.map((span): Mark => ({ span, kind: 'misplaced' })),
    ...parts.pairs.flatMap((pair) => pairMark(pair, grading.airport)),
  ];
}

/** The two labels of one element, each as the runs a results row marks inside it. */
function labelsOf(parts: ElementParts, grading: Grading): ElementLabels {
  const { text } = grading;
  const merged = mergeSpans(text, elementSpans(parts));
  return {
    element: parts.element,
    expectedLabel: expectedLabel(parts.element, grading.spoken, grading.routeReading),
    actualLabel: actualLabel(text, merged),
    said: saidRuns(text, merged, saidMarks(parts, grading)),
    expected: expectedFor(parts.element, parts.indices, parts.marks, grading),
  };
}

/**
 * Grades an element the chosen reading gives no words: wrong where a stray expect clause was cut
 * for it, and otherwise right, with nothing said for it.
 */
function emptyElementGrade(
  labels: ElementLabels,
  stray: Span | undefined,
  own: readonly RuleCitation[],
): Unremarked {
  if (stray !== undefined) return { ...labels, verdict: 'wrong', citations: citeOnce(own) };
  const actual = labels.element === 'A.expect' ? NO_EXPECT_CLAUSE : labels.actualLabel;
  return { ...labels, actualLabel: actual, verdict: 'correct', citations: citeOnce(own) };
}

/** The verdict and the rows of one element, on the labels already read from its marks. */
function verdictOf(parts: ElementParts, labels: ElementLabels, grading: Grading): Unremarked {
  const { element, indices, marks, pairs } = parts;
  const own = OWN_ROWS[element](grading.expected);
  if (indices.length === 0) return emptyElementGrade(labels, parts.stray, own);
  if (pairs.length < indices.length) {
    const order = marks.outOfOrder ? citePhraseology(grading.airport, 'S-ORDER') : [];
    return { ...labels, verdict: 'wrong', citations: citeOnce([...own, ...order]) };
  }
  return { ...labels, ...matchedVerdict(element, pairs, marks, grading) };
}

/** A stretch of text as a remark writes it, without the whitespace and punctuation at its ends. */
function remarkText(text: string): string {
  return text.replace(REMARK_EDGES, '');
}

function quoted(text: string): string {
  return `"${remarkText(text)}"`;
}

/** The one item of a list, where the list holds exactly one. */
function onlyOne<T>(items: readonly T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined;
}

/** Whether anything at all was heard for an element. */
function heardAnything(parts: ElementParts): boolean {
  const { marks } = parts;
  const stretches = marks.blocks.length + marks.filler.length;
  return parts.pairs.length + stretches > 0 || parts.stray !== undefined;
}

/** The remark that says the element was not heard, was never wanted, or landed in the wrong place. */
function placeRemarks(parts: ElementParts): string[] {
  if (!heardAnything(parts)) return [REMARKS.notHeard];
  if (parts.stray !== undefined) return [REMARKS.strayExpect];
  return parts.marks.outOfOrder ? [REMARKS.outOfOrder] : [];
}

/** Whether a stretch of the typed text holds a number token. */
function spanHoldsNumber(span: Span, tokens: readonly SpokenToken[]): boolean {
  return tokens.some(
    (token) => token.kind === 'number' && token.start >= span.start && token.end <= span.end,
  );
}

/** Whether a token of the element the student never said is a number. */
function missedNumber(indices: readonly number[], grading: Grading): boolean {
  return indices.some((index) => {
    const token = grading.alignment.candidate.tokens[index]?.token;
    return !grading.matchedBy.has(index) && token?.kind === 'number';
  });
}

/** The remark for one value said in place of the one value never said, where that is the whole miss. */
function wrongValueRemark(
  parts: ElementParts,
  missed: readonly string[],
  grading: Grading,
): string | undefined {
  const span = onlyOne(parts.marks.substituted);
  const only = onlyOne(missed);
  if (span === undefined || only === undefined) return undefined;
  if (!spanHoldsNumber(span, grading.alignment.student)) return undefined;
  if (!missedNumber(parts.indices, grading)) return undefined;
  const said = grading.text.slice(span.start, span.end);
  return `wrong value: said ${quoted(said)}, expected ${quoted(only)}`;
}

/** The remarks that say which words were never said, and which words the reading does not have. */
function valueRemarks(parts: ElementParts, grade: Unremarked, grading: Grading): string[] {
  const missed = grade.expected.filter((run) => run.missed).map((run) => run.text);
  const said = parts.marks.substituted.map((span) => grading.text.slice(span.start, span.end));
  const wrongValue = wrongValueRemark(parts, missed, grading);
  if (wrongValue !== undefined) return [wrongValue];
  return [
    ...(missed.length === 0 ? [] : [`missed: ${missed.map(quoted).join(', ')}`]),
    ...(said.length === 0 ? [] : [`not in the reading: ${said.map(quoted).join(', ')}`]),
  ];
}

/** Whether one of the tiers an element carries is a row read at a verdict. */
function hasTier(tiers: readonly Tier[], id: string, verdict: Verdict): boolean {
  return tiers.some(
    (entry) => entry.verdict === verdict && entry.rows.some((row) => row.id === id),
  );
}

/** The remarks the number rows of an element read as: "nine", the group form, and a restatement. */
function tierRemarks(parts: ElementParts, grading: Grading): string[] {
  const tiers = [
    ...parts.pairs.flatMap((pair) => numberTiers(pair.student, pair.expected, grading.airport)),
    ...parts.marks.tiers,
  ];
  return [
    ...(hasTier(tiers, 'S-NINER', 'wrong') ? [REMARKS.niner] : []),
    ...(hasTier(tiers, 'S-GROUP-FORM', 'wrong') ? [REMARKS.groupForm] : []),
    ...(hasTier(tiers, 'S-GROUP-FORM', 'acceptable') ? [REMARKS.restated] : []),
  ];
}

/** The remark that lists the extra words an element carried. */
function fillerRemarks(parts: ElementParts, grading: Grading): string[] {
  if (parts.marks.filler.length === 0) return [];
  const words = parts.marks.filler.map((span) =>
    remarkText(grading.text.slice(span.start, span.end)),
  );
  return [`extra words: ${words.join(', ')}`];
}

/** The remark the chosen route reading leaves: a route read at length, or one handed over as filed. */
function routeRemark(grading: Grading): string | undefined {
  if (grading.routeReading === 'full') {
    return handsOverRoute(grading) ? REMARKS.frc : undefined;
  }
  return ROUTE_REMARKS[grading.alignment.candidate.route];
}

/** The remark the chosen reading itself leaves on the element it reads longer than it had to. */
function candidateRemark(element: GradedElement, grading: Grading): string | undefined {
  if (element === 'R.route') return routeRemark(grading);
  const { candidate } = grading.alignment;
  if (element === 'A.expect' && candidate.expect === 'redundant') return REMARKS.redundantExpect;
  return undefined;
}

/** The reading's own remark, on an element every token of which matched. */
function candidateRemarks(parts: ElementParts, grading: Grading): string[] {
  if (parts.indices.length === 0 || parts.pairs.length < parts.indices.length) return [];
  const remark = candidateRemark(parts.element, grading);
  return remark === undefined ? [] : [remark];
}

/**
 * The kinds of miss one element made, in words, in the order a row reads them.
 *
 * A correct element says nothing: its row already says it was right, and a near-miss spelling or a
 * facility word is not a miss to name.
 */
function remarksFor(parts: ElementParts, grade: Unremarked, grading: Grading): string[] {
  if (grade.verdict === 'correct') return [];
  return [
    ...placeRemarks(parts),
    ...valueRemarks(parts, grade, grading),
    ...tierRemarks(parts, grading),
    ...fillerRemarks(parts, grading),
    ...candidateRemarks(parts, grading),
  ];
}

/** Grades one element of the chosen alignment, and says in words what it missed. */
function gradeElement(element: GradedElement, grading: Grading): TextGrade {
  const parts = partsOf(element, grading);
  const graded = verdictOf(parts, labelsOf(parts, grading), grading);
  return { ...graded, remarks: remarksFor(parts, graded, grading) };
}

/**
 * Grades a typed clearance element by element against the engine's reading.
 *
 * The text is aligned with every candidate reading (the reading as spoken, the route in full or
 * closed on "then as filed", the redundant expect clause, the field under each name its row lists)
 * and graded against the one it matches best, which is the one that matches the most tokens and,
 * among equals, leaves fewest of its own clearance limit words unsaid. Unmatched words between
 * matches are read as an element out of order, a value said in place
 * of another, a facility word, a restated number or filler; words before the first match are the
 * callsign and are not graded, unless they say a whole element out of order.
 *
 * @param text What the student typed.
 * @param spoken The engine's reading of the clearance (`speakClearance`).
 * @param expected The clearance the engine resolved.
 * @param airport The airport data: its lexicon and its phraseology rows.
 * @param routeReading The reading the student is held to: the one spoken on frequency, or the route
 *   read to its end as on a full route clearance.
 * @returns Exactly eight grades, in the order C, R.sid, R.route, A.phrase, A.expect, F, T, RWY.
 */
export function gradeText(
  text: string,
  spoken: SpokenClearance,
  expected: ResolvedClearance,
  airport: AirportData,
  routeReading: RouteReading,
): TextGrade[] {
  const lexicon = lexiconFor(airport);
  const candidates = candidatesFor(spoken, expected, airport, routeReading);
  const typed = normaliseSpoken(text, typedLexicon(lexicon, candidates));
  const tokens = joinNumbers(typed, candidateNumbers(candidates));
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
    routeReading,
    alignment,
    marks: walkGaps(alignment, expected, airport, vocabulary),
    matchedBy,
  };
  return GRADED_ORDER.map((element) => gradeElement(element, grading));
}
