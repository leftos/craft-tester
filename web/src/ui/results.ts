import type { BoxElementGrade } from '@/rules/amend/grade.ts';
import type { SpokenClearance } from '@/rules/speak.ts';
import type { RouteReading, SaidRun, TextGrade } from '@/rules/text/grade.ts';
import type { Grade, RuleCitation, Verdict } from '@/rules/types.ts';
import { button, el, iconButton } from '@/ui/dom.ts';
import { elementParts } from '@/ui/labels.ts';
import { readAloud, speechAvailable, stopReading } from '@/ui/speech.ts';
import { diffWords } from '@/ui/wordDiff.ts';

/** Everything the results view shows after the form is submitted. */
export type ResultsProps = {
  grades: readonly (Grade | TextGrade)[];
  spoken: SpokenClearance;
  /** The reading the student was held to, which is the one the reveal shows on frequency. */
  routeReading: RouteReading;
  onNext: () => void;
  onRetry: () => void;
};

/** One verdict of any kind the results view reads: a picked or typed element, or a strip box. */
type AnyGrade = Grade | TextGrade | BoxElementGrade;

/** What a half verdict is worth against the boxes it is scored among. */
const HALF_CREDIT = 0.5;

/** The count as the score line writes it, the half point as a fraction rather than a decimal. */
function countLabel(score: number): string {
  const whole = Math.floor(score);
  if (whole === score) return `${whole}`;
  return whole === 0 ? '½' : `${whole}½`;
}

/** How many verdicts read one way. */
function countOf(grades: readonly Grade[], verdict: Verdict): number {
  return grades.filter((grade) => grade.verdict === verdict).length;
}

/**
 * The points a set of verdicts earned: an acceptable answer counts whole, a half one half.
 *
 * @param grades The verdicts to count.
 * @returns The credit, a whole or half number no greater than the count of verdicts.
 */
export function creditOf(grades: readonly Grade[]): number {
  return (
    countOf(grades, 'correct') +
    countOf(grades, 'acceptable') +
    countOf(grades, 'half') * HALF_CREDIT
  );
}

/**
 * Whether an acceptable verdict is a route box the radar-vector SID's airport navaid alone separates
 * from the box the engine wrote, which is the only way a route box is acceptable.
 */
function isNavaidAcceptable(grade: Grade): boolean {
  return grade.verdict === 'acceptable' && grade.element === 'BOX.route';
}

/**
 * The rows that grade an element acceptable because it was read longer than it needed to be: extra
 * words, the route in full or closed on "then as filed", and an expect clause the clearance can do
 * without. An acceptable element citing none of them is acceptable without being longer: "nine"
 * for "niner", the "then" left off "then as filed".
 */
const LONGER_ROWS: ReadonlySet<string> = new Set([
  'S-FILLER',
  'R-FULL-ROUTE',
  'R-THEN-AS-FILED-END',
  'A-EXPECT-REDUNDANT',
  'A-FINAL',
]);

/** Whether an acceptable verdict is on an element read longer than it needed to be. */
function isInefficient(grade: Grade): boolean {
  return (
    grade.verdict === 'acceptable' &&
    !isNavaidAcceptable(grade) &&
    grade.citations.some((row) => LONGER_ROWS.has(row.id))
  );
}

/** Whether a verdict is on a box of the strip rather than on an element of the clearance. */
function isBoxGrade(grade: Grade): boolean {
  return grade.element.startsWith('BOX.');
}

/**
 * The line that says how many answers were right.
 *
 * An acceptable answer counts as correct, because it is one: the score line then says how many of
 * them were route boxes filed without the airport navaid, how many were longer than they needed to
 * be, and how many were acceptable without being longer. A half verdict counts as half a box, the
 * arrival routing being the only thing it missed, and the line says how many of those there were
 * too.
 *
 * @param grades The verdict for every element, or for every box of the strip.
 * @param noun What the verdicts are of: `elements` for a clearance alone, `flight plan checks /
 *   amendments` for the boxes of the strip, `CRAFT clearance elements` for the clearance read after
 *   them.
 * @returns The score, e.g. `4 of 5 elements correct, 1 inefficient` or `5 of 5 elements correct,
 *   1 acceptable` or
 *   `2½ of 3 flight plan checks / amendments correct, 1 half credit (arrival routing)` or
 *   `3 of 3 flight plan checks / amendments correct, 1 acceptable (airport navaid)`.
 */
export function scoreLine(
  grades: readonly Grade[],
  noun: 'elements' | 'flight plan checks / amendments' | 'CRAFT clearance elements',
): string {
  const acceptable = countOf(grades, 'acceptable');
  const navaid = grades.filter(isNavaidAcceptable).length;
  const inefficient = grades.filter(isInefficient).length;
  const other = acceptable - navaid - inefficient;
  const half = countOf(grades, 'half');
  const tails = [
    ...(half === 0 ? [] : [`${half} half credit (arrival routing)`]),
    ...(navaid === 0 ? [] : [`${navaid} acceptable (airport navaid)`]),
    ...(inefficient === 0 ? [] : [`${inefficient} inefficient`]),
    ...(other === 0 ? [] : [`${other} acceptable`]),
  ];
  return [`${countLabel(creditOf(grades))} of ${grades.length} ${noun} correct`, ...tails].join(
    ', ',
  );
}

/**
 * The score line of a whole session: the clearance alone, or the strip boxes and then the clearance.
 *
 * An amendment session grades the boxes of the strip before the clearance, and the two are counted
 * apart, each with its own tails, so a box is never counted as a clearance element.
 *
 * @param grades The verdicts of the session, the strip boxes (if any) ahead of the clearance.
 * @returns The score, e.g. `2 of 3 elements correct`, or `2 of 3 flight plan checks / amendments
 *   correct, 0 of 8 CRAFT clearance elements correct` where the session graded the strip.
 */
export function sessionScoreLine(grades: readonly Grade[]): string {
  const boxGrades = grades.filter(isBoxGrade);
  if (boxGrades.length === 0) return scoreLine(grades, 'elements');
  const clearanceGrades = grades.filter((grade) => !isBoxGrade(grade));
  return `${scoreLine(boxGrades, 'flight plan checks / amendments')}, ${scoreLine(clearanceGrades, 'CRAFT clearance elements')}`;
}

/**
 * What a verdict reads as to the student: an acceptable one split by why it was acceptable, since
 * a route box without the airport navaid, an element read longer than it needed to be and one
 * acceptable for any other reason each say something different.
 */
type VerdictKind = 'correct' | 'wrong' | 'half' | 'longer' | 'navaid' | 'acceptable';

/** Which kind of verdict one grade is. */
function kindOf(grade: Grade): VerdictKind {
  if (grade.verdict !== 'acceptable') return grade.verdict;
  if (isNavaidAcceptable(grade)) return 'navaid';
  return isInefficient(grade) ? 'longer' : 'acceptable';
}

/** The tag a results row carries, in words and, where it lost credit, a symbol. */
const KIND_TAGS: Readonly<Record<VerdictKind, string>> = {
  correct: 'Correct',
  wrong: '✗ Wrong',
  half: '½ Half credit',
  longer: '~ Longer than needed',
  navaid: 'Acceptable (airport navaid)',
  acceptable: 'Acceptable',
};

/** The symbol an element pill carries, so its state never reads by colour alone. */
const KIND_MARKS: Readonly<Record<VerdictKind, string>> = {
  correct: '✓',
  wrong: '✗',
  half: '½',
  longer: '~',
  navaid: '≈',
  acceptable: '≈',
};

/** The kinds the summary sentence counts, in the order it names them. */
const TAIL_KINDS: readonly Exclude<VerdictKind, 'correct'>[] = [
  'wrong',
  'half',
  'longer',
  'navaid',
  'acceptable',
];

/** How the summary sentence names a count of each kind that lost credit or was only acceptable. */
const TAIL_WORDS: Readonly<Record<Exclude<VerdictKind, 'correct'>, string>> = {
  wrong: 'wrong',
  half: 'half credit',
  longer: 'longer than needed',
  navaid: 'acceptable (airport navaid)',
  acceptable: 'acceptable',
};

/** The tails of one group of verdicts, e.g. `1 wrong, 1 longer than needed`, or `all correct`. */
function tailsOf(grades: readonly Grade[]): string {
  const tails = TAIL_KINDS.flatMap((kind) => {
    const count = grades.filter((grade) => kindOf(grade) === kind).length;
    return count === 0 ? [] : [`${count} ${TAIL_WORDS[kind]}`];
  });
  return tails.length === 0 ? 'all correct' : tails.join(', ');
}

/** The rows that decided one element, each with its id, its text and the source it comes from. */
function citationList(citations: readonly RuleCitation[]): HTMLElement {
  const list = el('ul', 'citations');
  for (const citation of citations) {
    const item = el('li');
    item.append(
      el('code', 'rule-id', citation.id),
      ` — ${citation.text} `,
      el('span', 'rule-source', `(${citation.source})`),
    );
    list.append(item);
  }
  return list;
}

/** The words the second line of a picked or box verdict opens with. */
type CorrectionPrefix = 'correction' | 'preferred' | 'shorter' | 'full credit';

/**
 * What the second line a verdict reads opens with: a correction where it was wrong, the reading it
 * could have been where it was acceptable (the preferred route box, with the airport navaid, for a
 * route box; the shorter reading for anything else), the box that would have earned the whole point
 * where it earned half, and nothing at all where it was correct.
 */
function correctionPrefix(verdict: Grade): CorrectionPrefix | undefined {
  if (verdict.verdict === 'wrong') return 'correction';
  if (isNavaidAcceptable(verdict)) return 'preferred';
  if (verdict.verdict === 'acceptable') return 'shorter';
  if (verdict.verdict === 'half') return 'full credit';
  return undefined;
}

/** The second line a verdict reads, its prefix ahead of the words the clearance was meant to read. */
function correctionLine(verdict: Grade): string | undefined {
  const prefix = correctionPrefix(verdict);
  return prefix === undefined ? undefined : `${prefix}: ${verdict.expectedLabel}`;
}

/** The second line a typed element reads: the expected words wherever it was not fully correct. */
function expectedLine(verdict: TextGrade): string | undefined {
  if (verdict.verdict === 'correct') return undefined;
  const runs = verdict.expected;
  const words = runs.length === 0 ? verdict.expectedLabel : runs.map((run) => run.text).join('');
  return `expected: ${words}`;
}

/** What a results row reads between one remark and the next. */
const REMARK_JOINER = ' · ';

/** The line that names the kinds of miss a typed element made, where it made any. */
function remarksLine(verdict: AnyGrade): string | undefined {
  if (!('remarks' in verdict) || verdict.remarks.length === 0) return undefined;
  return verdict.remarks.join(REMARK_JOINER);
}

/**
 * The lines one verdict reads as: the player's answer, and the second line their answer earns.
 *
 * A typed element's second line is the expected words, shown wherever it was not fully correct; a
 * picked one's is the correction, the shorter reading (the preferred one, for a route box the
 * airport navaid alone separates) or the full-credit box its verdict calls for. A typed element
 * that missed also names the kinds of miss it made, in words.
 *
 * A box of the strip the engine raised an amendment for also reads why it was amended.
 *
 * @param verdict The verdict for one element, picked or typed, or for one box of the strip.
 * @returns The answer line, how it was answered, the second line, where there is one, the kinds of
 *   miss a typed element made, where it made any, and the reason for the box's amendment, where
 *   there is one.
 */
export function verdictLines(verdict: AnyGrade): {
  answer: string;
  verdict: Verdict;
  correction: string | undefined;
  remarks: string | undefined;
  why: string | undefined;
} {
  return {
    answer: `you said: ${verdict.actualLabel}`,
    verdict: verdict.verdict,
    correction: 'said' in verdict ? expectedLine(verdict) : correctionLine(verdict),
    remarks: remarksLine(verdict),
    why: 'reason' in verdict && verdict.reason !== undefined ? `why: ${verdict.reason}` : undefined,
  };
}

/** What a marked run of a typed answer says about the words under it, as its tooltip. */
const RUN_TITLES: Readonly<Record<'wrong' | 'misplaced', string>> = {
  wrong: 'not what the reading has',
  misplaced: 'out of CRAFT order',
};

/** The node with the tooltip that says what the mark on it means. */
function titled(node: HTMLElement, title: string): HTMLElement {
  node.setAttribute('title', title);
  return node;
}

/** One run of a typed answer: a marked one as a node of its own, the rest as plain text. */
function saidNode(run: SaidRun): HTMLElement | string {
  if (run.kind === 'filler') return el('span', 'filler', run.text);
  if (run.kind === 'spelling') {
    return titled(el('span', 'spelling', run.text), `read as "${run.readAs}"`);
  }
  if (run.kind === 'wrong' || run.kind === 'misplaced') {
    return titled(el('span', run.kind, run.text), RUN_TITLES[run.kind]);
  }
  return run.text;
}

/** What the two lines of a picked answer read: the second line's prefix, and the words that differ. */
type PickedDiff = { prefix: CorrectionPrefix } & ReturnType<typeof diffWords>;

/** Whether a verdict is one the student picked: not a typed element, not a box of the strip. */
function isPicked(verdict: AnyGrade): boolean {
  return !('said' in verdict) && !('reason' in verdict);
}

/** The words that differ between what a picked answer said and what it was held against. */
function pickedDiff(verdict: AnyGrade): PickedDiff | undefined {
  const prefix = isPicked(verdict) ? correctionPrefix(verdict) : undefined;
  if (prefix === undefined) return undefined;
  return { prefix, ...diffWords(verdict.actualLabel, verdict.expectedLabel) };
}

/**
 * Writes what the player said into a node, with what the matcher made of it marked inside it.
 *
 * A typed element marks its filler, the words the reading does not have, an element said out of its
 * place and a word typed a letter or two from the word it reads as; a picked one that was not
 * correct marks the words the reading does not have. A typed element where nothing was heard reads
 * its label, as a correct picked one does.
 */
function fillAnswer(node: HTMLElement, verdict: AnyGrade, diff: PickedDiff | undefined): void {
  if (diff !== undefined) {
    for (const run of diff.said)
      node.append(run.differs ? el('span', 'wrong', run.text) : run.text);
    return;
  }
  if (!('said' in verdict) || verdict.said.length === 0) {
    node.append(verdict.actualLabel);
    return;
  }
  for (const run of verdict.said) node.append(saidNode(run));
}

/**
 * Writes the words the element was held against into a node, the ones never said marked inside.
 *
 * A typed element marks the words of its reading it never said, a picked one the words its answer
 * lacks. A box of the strip, and a typed element whose grade carries no runs, read its label.
 */
function fillExpected(node: HTMLElement, verdict: AnyGrade, diff: PickedDiff | undefined): void {
  if (diff !== undefined) {
    for (const run of diff.expected) {
      node.append(run.differs ? el('strong', 'missed', run.text) : run.text);
    }
    return;
  }
  if (!('expected' in verdict) || verdict.expected.length === 0) {
    node.append(verdict.expectedLabel);
    return;
  }
  for (const run of verdict.expected) {
    node.append(run.missed ? el('strong', 'missed', run.text) : run.text);
  }
}

/** The label a picked or box verdict's second line reads under, from the prefix it opened with. */
const PREFIX_TERMS: Readonly<Record<CorrectionPrefix, string>> = {
  correction: 'Reads as',
  preferred: 'Preferred',
  shorter: 'Shorter',
  'full credit': 'Full credit',
};

/** The label a typed element's expected words read under, by the kind of verdict it earned. */
const TYPED_TERMS: Readonly<Record<VerdictKind, string>> = {
  correct: 'Reads as',
  wrong: 'Reads as',
  half: 'Full credit',
  longer: 'Shorter',
  navaid: 'Preferred',
  acceptable: 'Reads as',
};

/** The label of the second line of a verdict that lost credit, or none where it has none. */
function expectedTerm(verdict: AnyGrade): string | undefined {
  if (verdict.verdict === 'correct') return undefined;
  if ('said' in verdict) return TYPED_TERMS[kindOf(verdict)];
  const prefix = correctionPrefix(verdict);
  return prefix === undefined ? undefined : PREFIX_TERMS[prefix];
}

/** The id a results row carries, which its element pill links to. */
function rowId(verdict: AnyGrade): string {
  return `row-${verdict.element}`;
}

/** The letter and the name a results row opens with. */
function headCells(verdict: AnyGrade): HTMLElement[] {
  const { letter, name } = elementParts(verdict.element);
  return [el('span', 'letter', letter), el('span', 'name', name)];
}

/**
 * A correct row, collapsed to one line: letter, name, what was said, and its tag. It opens to the
 * rows that decided it.
 */
function collapsedRow(verdict: AnyGrade, diff: PickedDiff | undefined): HTMLElement {
  const row = el('details', `verdict ${verdict.verdict}`);
  row.id = rowId(verdict);
  const said = el('span', 'said answer');
  fillAnswer(said, verdict, diff);
  const head = el('summary', 'verdict-head');
  head.append(...headCells(verdict), said, el('span', 'tag', KIND_TAGS[kindOf(verdict)]));
  row.append(head, citationList(verdict.citations));
  return row;
}

/** One label and its value in the detail list of a row that lost credit. */
function detailPair(term: string, value: HTMLElement): HTMLElement[] {
  return [el('dt', '', term), value];
}

/** The Note value: the kinds of miss a typed element made, in words; none on a picked row. */
function noteValue(verdict: AnyGrade): HTMLElement | undefined {
  if (!('remarks' in verdict) || verdict.remarks.length === 0) return undefined;
  const value = el('dd', 'note');
  value.append(el('p', 'remarks', verdict.remarks.join(REMARK_JOINER)));
  return value;
}

/** The detail list of a row that lost credit: what was said, what it reads as, a note, the reason. */
function detailList(verdict: AnyGrade, diff: PickedDiff | undefined): HTMLElement {
  const list = el('dl', 'detail');
  const answer = el('dd', 'answer');
  fillAnswer(answer, verdict, diff);
  list.append(...detailPair('You said', answer));
  const term = expectedTerm(verdict);
  if (term !== undefined) {
    const expected = el('dd', 'expected');
    fillExpected(expected, verdict, diff);
    list.append(...detailPair(term, expected));
  }
  const note = noteValue(verdict);
  if (note !== undefined) list.append(...detailPair('Note', note));
  if ('reason' in verdict && verdict.reason !== undefined) {
    list.append(...detailPair('Reason', el('dd', 'reason', verdict.reason)));
  }
  return list;
}

/** The rows that decided a verdict, behind a closed disclosure that counts them. */
function rulesApplied(citations: readonly RuleCitation[]): HTMLElement {
  const rules = el('details', 'rules');
  const noun = citations.length === 1 ? 'rule' : 'rules';
  rules.append(el('summary', '', `${citations.length} ${noun} applied`), citationList(citations));
  return rules;
}

/** A row that lost credit, expanded: its tag, the detail list and the rows that decided it. */
function expandedRow(verdict: AnyGrade, diff: PickedDiff | undefined): HTMLElement {
  const row = el('div', `verdict ${verdict.verdict}`);
  row.id = rowId(verdict);
  const head = el('div', 'verdict-head');
  head.append(...headCells(verdict), el('span', 'tag', KIND_TAGS[kindOf(verdict)]));
  row.append(head, detailList(verdict, diff));
  if (verdict.citations.length > 0) row.append(rulesApplied(verdict.citations));
  return row;
}

/**
 * Renders one element's verdict as a results row.
 *
 * A correct row is one line that opens to the rows that decided it. A row that lost credit (or was
 * only acceptable) is expanded: its tag, what the player said, what it reads as, why, the reason a
 * box of the strip was amended, and the rows that decided it behind a closed disclosure.
 *
 * @param verdict The verdict for one element of the clearance, picked or typed, or for one box of
 *   the strip.
 * @returns The verdict row.
 */
export function renderVerdict(verdict: AnyGrade): HTMLElement {
  const diff = pickedDiff(verdict);
  return verdict.verdict === 'correct' ? collapsedRow(verdict, diff) : expandedRow(verdict, diff);
}

/** The speaker the read-aloud button draws: Material Icons `volume_up`, Apache 2.0. */
const SPEAKER_ICON =
  'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z';

/**
 * The button that reads one box aloud, and stops the reading when it is pressed a second time.
 *
 * The pressed state is the button's own `aria-pressed`, cleared by the callback the reading ends
 * through, so starting the other box — which cancels this one — releases this button too.
 */
function readAloudButton(text: string): HTMLButtonElement {
  const node = iconButton('Read aloud', 'read-aloud', SPEAKER_ICON, () => {
    if (node.getAttribute('aria-pressed') === 'true') {
      stopReading();
      return;
    }
    node.setAttribute('aria-pressed', 'true');
    readAloud(text, () => {
      node.setAttribute('aria-pressed', 'false');
    });
  });
  node.setAttribute('aria-pressed', 'false');
  return node;
}

/**
 * One box of the reveal: what it is a reading of, and the clearance as it is spoken.
 *
 * The button that reads it aloud is only offered where the browser has a synthesiser to read it
 * with.
 *
 * @param heading What the box is a reading of.
 * @param text The clearance, written the way it is spoken.
 * @returns The box.
 */
function spokenBox(heading: string, text: string): HTMLElement {
  const box = el('div', 'spoken-box');
  const head = el('div', 'spoken-head');
  head.append(el('h3', '', heading));
  if (speechAvailable()) head.append(readAloudButton(text));
  box.append(head, el('p', 'spoken', text));
  return box;
}

/**
 * The clearance as it is read on frequency, and the same clearance with the route read in full.
 *
 * A student held to the full route was answering a strip marked FRC, where the route read to its
 * end is what the controller says on frequency, so that reading is the only one shown. Otherwise
 * the reading in full follows the one spoken, except where a route with nothing to hand over as
 * filed makes the second block repeat the first word for word, and it is left out.
 */
function revealPanel(spoken: SpokenClearance, routeReading: RouteReading): HTMLElement {
  const panel = el('div', 'reveal');
  if (routeReading === 'full') {
    panel.append(spokenBox('On frequency', spoken.fullRoute));
    return panel;
  }
  panel.append(spokenBox('On frequency', spoken.abbreviated));
  if (spoken.abbreviated !== spoken.fullRoute) {
    panel.append(spokenBox('With the route read in full', spoken.fullRoute));
  }
  return panel;
}

/** One group the summary scores apart: the strip boxes, or the clearance. */
type ScoreGroup = { grades: readonly Grade[]; caption: string; name: string };

/** The groups a session is scored in: the clearance alone, or the strip boxes and the clearance. */
function scoreGroups(grades: readonly Grade[]): ScoreGroup[] {
  const boxGrades = grades.filter(isBoxGrade);
  if (boxGrades.length === 0) return [{ grades, caption: 'correct', name: '' }];
  return [
    { grades: boxGrades, caption: 'strip boxes correct', name: 'Strip boxes' },
    {
      grades: grades.filter((grade) => !isBoxGrade(grade)),
      caption: 'clearance correct',
      name: 'Clearance',
    },
  ];
}

/** The large score of one group, e.g. `6/8` over `correct`. */
function scoreFigure(group: ScoreGroup): HTMLElement {
  const figure = el('div', 'score', `${countLabel(creditOf(group.grades))}/${group.grades.length}`);
  figure.append(el('small', '', group.caption));
  return figure;
}

/** The sentence under the score: the tails of each group, named where there are two. */
function tailSentence(groups: readonly ScoreGroup[]): string {
  const [only] = groups;
  if (groups.length === 1 && only !== undefined) {
    const tails = tailsOf(only.grades);
    return `${tails.charAt(0).toUpperCase()}${tails.slice(1)}.`;
  }
  return groups.map((group) => `${group.name}: ${tailsOf(group.grades)}.`).join(' ');
}

/** What an element pill reads: its letter alone where no other graded element shares it. */
function pillText(grade: Grade, grades: readonly Grade[]): { letter: string; name: string } {
  const { letter, name } = elementParts(grade.element);
  if (letter === '') return { letter: '', name };
  const shared = grades.filter((other) => elementParts(other.element).letter === letter).length;
  return { letter, name: shared > 1 ? name : '' };
}

/** Scrolls to a row, rather than following the link, which would replace the scenario's hash. */
function scrollToRow(event: Event, id: string): void {
  event.preventDefault();
  document.getElementById(id)?.scrollIntoView({ block: 'start' });
}

/** The pill of one element: its letter or name, and its state as a symbol and in words. */
function elementPill(grade: Grade, grades: readonly Grade[]): HTMLElement {
  const kind = kindOf(grade);
  const { letter, name } = pillText(grade, grades);
  const parts = elementParts(grade.element);
  const link = el('a', `pill ${grade.verdict}`);
  const id = rowId(grade);
  link.href = `#${id}`;
  link.setAttribute('aria-label', `${parts.letter} ${parts.name}: ${KIND_TAGS[kind]}`.trim());
  if (letter !== '') link.append(el('b', '', letter));
  if (name !== '') link.append(` ${name}`);
  link.append(` ${KIND_MARKS[kind]}`);
  link.addEventListener('click', (event) => {
    scrollToRow(event, id);
  });
  const item = el('li');
  item.append(link);
  return item;
}

/** The summary: the score of each group, the sentence of tails, and a pill per element. */
function summaryPanel(grades: readonly Grade[]): HTMLElement {
  const groups = scoreGroups(grades);
  const summary = el('div', 'summary');
  const scores = el('div', 'scores');
  scores.append(...groups.map(scoreFigure));
  const pills = el('ul', 'pills');
  pills.setAttribute('aria-label', 'Elements');
  pills.append(...grades.map((grade) => elementPill(grade, grades)));
  summary.append(scores, el('p', 'score-sub', tailSentence(groups)), pills);
  return summary;
}

/** The summary, the spoken reveal, and a row per element in CRAFT order. */
function resultsBody(props: ResultsProps): HTMLElement[] {
  const rows = el('div', 'verdicts');
  rows.append(...props.grades.map((verdict) => renderVerdict(verdict)));
  return [summaryPanel(props.grades), revealPanel(props.spoken, props.routeReading), rows];
}

/**
 * The two ways on from a graded clearance, the next strip first, and the slot the variants of this
 * strip are offered in.
 */
function actionRows(props: ResultsProps): HTMLElement[] {
  const row = el('div', 'actions');
  row.append(
    button('Next strip', 'primary', props.onNext),
    button('Try this strip again', 'secondary', props.onRetry),
  );
  return [row, el('div', 'what-if')];
}

/**
 * Renders the results: the summary, the spoken reveal, then a row per element.
 *
 * @param props The verdicts, the spoken clearance, the reading the student was held to, and the
 *   handlers for retry and next scenario.
 * @returns The results panel.
 */
export function renderResults(props: ResultsProps): HTMLElement {
  const panel = el('section', 'panel results');
  panel.append(el('h2', '', 'Results'), ...resultsBody(props), ...actionRows(props));
  return panel;
}

/**
 * Renders a scenario this browser has already answered, with the earlier result behind a spoiler.
 *
 * @param props The verdicts of the earlier answer, the spoken clearance, the reading the student
 *   was held to, and the two handlers.
 * @returns The revisit panel.
 */
export function renderRevisit(props: ResultsProps): HTMLElement {
  const panel = el('section', 'panel results revisit');
  const spoiler = el('details', 'spoiler');
  spoiler.append(el('summary', '', 'Show your result and the solution'), ...resultsBody(props));
  panel.append(
    el('h2', '', 'Already solved'),
    el('p', 'muted', 'You submitted a clearance for this scenario before.'),
    spoiler,
    ...actionRows(props),
  );
  return panel;
}
