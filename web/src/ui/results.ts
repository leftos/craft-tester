import type { BoxElementGrade } from '@/rules/amend/grade.ts';
import type { SpokenClearance } from '@/rules/speak.ts';
import type { RouteReading, SaidRun, TextGrade } from '@/rules/text/grade.ts';
import type { Grade, RuleCitation, Verdict } from '@/rules/types.ts';
import { button, el, iconButton } from '@/ui/dom.ts';
import { elementLabel } from '@/ui/labels.ts';
import { readAloud, speechAvailable, stopReading } from '@/ui/speech.ts';
import type { DiffRun } from '@/ui/wordDiff.ts';
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
 * Whether an acceptable verdict is a route box the radar-vector SID's airport navaid alone separates
 * from the box the engine wrote, which is the only way a route box is acceptable.
 */
function isNavaidAcceptable(grade: Grade): boolean {
  return grade.verdict === 'acceptable' && grade.element === 'BOX.route';
}

/**
 * The rows that grade an element acceptable because it was read longer than it needed to be: extra
 * words, a number restated in group form, the route in full or closed on "then as filed", and an
 * expect clause the clearance can do without. An acceptable element citing none of them is
 * acceptable without being longer: "nine" for "niner", a navaid said without its facility word.
 */
const LONGER_ROWS: ReadonlySet<string> = new Set([
  'S-FILLER',
  'S-GROUP-FORM',
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
  const correct = countOf(grades, 'correct') + acceptable + half * HALF_CREDIT;
  const tails = [
    ...(half === 0 ? [] : [`${half} half credit (arrival routing)`]),
    ...(navaid === 0 ? [] : [`${navaid} acceptable (airport navaid)`]),
    ...(inefficient === 0 ? [] : [`${inefficient} inefficient`]),
    ...(other === 0 ? [] : [`${other} acceptable`]),
  ];
  return [`${countLabel(correct)} of ${grades.length} ${noun} correct`, ...tails].join(', ');
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

/** The rows that decided one element, quoted the way the proposal script quotes them. */
function citationList(citations: readonly RuleCitation[]): HTMLElement {
  const list = el('ul', 'citations');
  for (const citation of citations) {
    list.append(el('li', '', `${citation.id} — ${citation.text}`));
  }
  return list;
}

/**
 * What the second line a verdict reads opens with: a correction where it was wrong, the reading it
 * could have been where it was acceptable (the preferred route box, with the airport navaid, for a
 * route box; the shorter reading for anything else), the box that would have earned the whole point
 * where it earned half, and nothing at all where it was correct.
 */
function correctionPrefix(verdict: Grade): string | undefined {
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
function remarksLine(verdict: Grade | TextGrade | BoxElementGrade): string | undefined {
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
export function verdictLines(verdict: Grade | TextGrade | BoxElementGrade): {
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

/** The mark an answer earns beside it: a tick for a full point, a half for half one, else none. */
function verdictMark(verdict: Verdict): string | undefined {
  if (verdict === 'wrong') return undefined;
  return verdict === 'half' ? '½' : '✓';
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
type PickedDiff = { prefix: string } & ReturnType<typeof diffWords>;

/** Whether a verdict is one the student picked: not a typed element, not a box of the strip. */
function isPicked(verdict: Grade | TextGrade | BoxElementGrade): boolean {
  return !('said' in verdict) && !('reason' in verdict);
}

/** The words that differ between what a picked answer said and what it was held against. */
function pickedDiff(verdict: Grade | TextGrade | BoxElementGrade): PickedDiff | undefined {
  const prefix = isPicked(verdict) ? correctionPrefix(verdict) : undefined;
  if (prefix === undefined) return undefined;
  return { prefix, ...diffWords(verdict.actualLabel, verdict.expectedLabel) };
}

/** The answer line of a picked verdict, the words the reading does not have marked inside it. */
function pickedAnswer(runs: readonly DiffRun[]): HTMLParagraphElement {
  const line = el('p', 'answer', 'you said: ');
  for (const run of runs) line.append(run.differs ? el('span', 'wrong', run.text) : run.text);
  return line;
}

/** The second line of a picked verdict, the words the answer does not have marked inside it. */
function pickedExpected(prefix: string, runs: readonly DiffRun[]): HTMLParagraphElement {
  const line = el('p', 'expected', `${prefix}: `);
  for (const run of runs) line.append(run.differs ? el('strong', 'missed', run.text) : run.text);
  return line;
}

/**
 * The answer line: what the player said, with what the matcher made of it marked inside it.
 *
 * A typed element marks its filler, the words the reading does not have, an element said out of its
 * place and a word typed a letter or two from the word it reads as; a picked one that was not
 * correct marks the words the reading does not have. A typed element where nothing was heard reads
 * its label, as a correct picked one does.
 */
function answerLine(
  verdict: Grade | TextGrade,
  text: string,
  diff: PickedDiff | undefined,
): HTMLParagraphElement {
  if (diff !== undefined) return pickedAnswer(diff.said);
  if (!('said' in verdict) || verdict.said.length === 0) return el('p', 'answer', text);
  const answer = el('p', 'answer', 'you said: ');
  for (const run of verdict.said) answer.append(saidNode(run));
  return answer;
}

/**
 * The second line: the words the element was held against, the ones never said marked inside them.
 *
 * A typed element marks the words of its reading it never said, a picked one the words its answer
 * lacks. A box of the strip, and a typed element whose grade carries no runs, read as the plain
 * line.
 */
function expectedParagraph(
  verdict: Grade | TextGrade | BoxElementGrade,
  text: string,
  diff: PickedDiff | undefined,
): HTMLParagraphElement {
  if (diff !== undefined) return pickedExpected(diff.prefix, diff.expected);
  if (!('expected' in verdict) || verdict.expected.length === 0) return el('p', 'expected', text);
  const line = el('p', 'expected', 'expected: ');
  for (const run of verdict.expected) {
    line.append(run.missed ? el('strong', 'missed', run.text) : run.text);
  }
  return line;
}

/**
 * Renders one element's verdict: what the player said, the correction where it was wrong, the kinds
 * of miss a typed element made, the reason a box of the strip was amended, and the rows that
 * decided it.
 *
 * @param verdict The verdict for one element of the clearance, picked or typed, or for one box of
 *   the strip.
 * @returns The verdict row.
 */
export function renderVerdict(verdict: Grade | TextGrade | BoxElementGrade): HTMLElement {
  const lines = verdictLines(verdict);
  const diff = pickedDiff(verdict);
  const row = el('div', `verdict ${lines.verdict}`);
  const answer = answerLine(verdict, lines.answer, diff);
  const mark = verdictMark(lines.verdict);
  if (mark !== undefined) answer.append(el('span', 'mark', mark));
  row.append(el('h3', '', elementLabel(verdict.element)), answer);
  if (lines.correction !== undefined) {
    row.append(expectedParagraph(verdict, lines.correction, diff));
  }
  if (lines.remarks !== undefined) row.append(el('p', 'remarks', lines.remarks));
  if (lines.why !== undefined) row.append(el('p', 'why', lines.why));
  row.append(citationList(verdict.citations));
  return row;
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

/** The score, a verdict per element with its citations, and the spoken reveal. */
function resultsBody(props: ResultsProps): HTMLElement[] {
  return [
    el('p', 'score', sessionScoreLine(props.grades)),
    ...props.grades.map((verdict) => renderVerdict(verdict)),
    revealPanel(props.spoken, props.routeReading),
  ];
}

/** The two ways on from a graded clearance: answer this scenario again, or take another. */
function actionRow(props: ResultsProps): HTMLElement {
  const row = el('div', 'actions');
  row.append(
    button('Retry', 'primary', props.onRetry),
    button('Next scenario', 'primary', props.onNext),
  );
  return row;
}

/**
 * Renders the results: a verdict per element with its citations, then the spoken reveal.
 *
 * @param props The verdicts, the spoken clearance, the reading the student was held to, and the
 *   handlers for retry and next scenario.
 * @returns The results panel.
 */
export function renderResults(props: ResultsProps): HTMLElement {
  const panel = el('section', 'panel results');
  panel.append(el('h2', '', 'Results'), ...resultsBody(props), actionRow(props));
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
    actionRow(props),
  );
  return panel;
}
