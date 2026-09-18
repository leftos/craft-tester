import type { BoxElementGrade } from '@/rules/amend/grade.ts';
import type { SpokenClearance } from '@/rules/speak.ts';
import type { TextGrade } from '@/rules/text/grade.ts';
import type { Grade, RuleCitation, Verdict } from '@/rules/types.ts';
import { button, el, iconButton } from '@/ui/dom.ts';
import { elementLabel } from '@/ui/labels.ts';
import { readAloud, speechAvailable, stopReading } from '@/ui/speech.ts';

/** Everything the results view shows after the form is submitted. */
export type ResultsProps = {
  grades: readonly (Grade | TextGrade)[];
  spoken: SpokenClearance;
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

/** Whether a verdict is on a box of the strip rather than on an element of the clearance. */
function isBoxGrade(grade: Grade): boolean {
  return grade.element.startsWith('BOX.');
}

/**
 * The line that says how many answers were right.
 *
 * An acceptable answer counts as correct, because it is one: the score line then says how many of
 * them were route boxes filed without the airport navaid, and how many were longer than they needed
 * to be. A half verdict counts as half a box, the arrival routing being the only thing it missed,
 * and the line says how many of those there were too.
 *
 * @param grades The verdict for every element, or for every box of the strip.
 * @param noun What the verdicts are of: `elements` for a clearance alone, `flight plan checks /
 *   amendments` for the boxes of the strip, `CRAFT clearance elements` for the clearance read after
 *   them.
 * @returns The score, e.g. `4 of 5 elements correct, 1 acceptable but inefficient` or
 *   `2½ of 3 flight plan checks / amendments correct, 1 half credit (arrival routing)` or
 *   `3 of 3 flight plan checks / amendments correct, 1 acceptable (airport navaid)`.
 */
export function scoreLine(
  grades: readonly Grade[],
  noun: 'elements' | 'flight plan checks / amendments' | 'CRAFT clearance elements',
): string {
  const acceptable = countOf(grades, 'acceptable');
  const navaid = grades.filter(isNavaidAcceptable).length;
  const inefficient = acceptable - navaid;
  const half = countOf(grades, 'half');
  const correct = countOf(grades, 'correct') + acceptable + half * HALF_CREDIT;
  const tails = [
    ...(half === 0 ? [] : [`${half} half credit (arrival routing)`]),
    ...(navaid === 0 ? [] : [`${navaid} acceptable (airport navaid)`]),
    ...(inefficient === 0 ? [] : [`${inefficient} acceptable but inefficient`]),
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
 * The second line a verdict reads: a correction where it was wrong, the reading it could have been
 * where it was acceptable (the preferred route box, with the airport navaid, for a route box; the
 * shorter reading for anything else), the box that would have earned the whole point where it
 * earned half, and nothing at all where it was correct.
 */
function correctionLine(verdict: Grade): string | undefined {
  if (verdict.verdict === 'wrong') return `correction: ${verdict.expectedLabel}`;
  if (isNavaidAcceptable(verdict)) return `preferred: ${verdict.expectedLabel}`;
  if (verdict.verdict === 'acceptable') return `shorter: ${verdict.expectedLabel}`;
  if (verdict.verdict === 'half') return `full credit: ${verdict.expectedLabel}`;
  return undefined;
}

/** The second line a typed element reads: the expected words wherever it was not fully correct. */
function expectedLine(verdict: TextGrade): string | undefined {
  return verdict.verdict === 'correct' ? undefined : `expected: ${verdict.expectedLabel}`;
}

/**
 * The lines one verdict reads as: the player's answer, and the second line their answer earns.
 *
 * A typed element's second line is the expected words, shown wherever it was not fully correct; a
 * picked one's is the correction, the shorter reading (the preferred one, for a route box the
 * airport navaid alone separates) or the full-credit box its verdict calls for.
 *
 * A box of the strip the engine raised an amendment for also reads why it was amended.
 *
 * @param verdict The verdict for one element, picked or typed, or for one box of the strip.
 * @returns The answer line, how it was answered, the second line, where there is one, and the
 *   reason for the box's amendment, where there is one.
 */
export function verdictLines(verdict: Grade | TextGrade | BoxElementGrade): {
  answer: string;
  verdict: Verdict;
  correction: string | undefined;
  why: string | undefined;
} {
  return {
    answer: `you said: ${verdict.actualLabel}`,
    verdict: verdict.verdict,
    correction: 'said' in verdict ? expectedLine(verdict) : correctionLine(verdict),
    why: 'reason' in verdict && verdict.reason !== undefined ? `why: ${verdict.reason}` : undefined,
  };
}

/** The mark an answer earns beside it: a tick for a full point, a half for half one, else none. */
function verdictMark(verdict: Verdict): string | undefined {
  if (verdict === 'wrong') return undefined;
  return verdict === 'half' ? '½' : '✓';
}

/**
 * The answer line: what the player said, with the filler of a typed element marked inside it.
 *
 * A typed element where nothing was heard reads its label, as a picked one does.
 */
function answerLine(verdict: Grade | TextGrade, text: string): HTMLParagraphElement {
  if (!('said' in verdict) || verdict.said.length === 0) return el('p', 'answer', text);
  const answer = el('p', 'answer', 'you said: ');
  for (const run of verdict.said) {
    answer.append(run.kind === 'filler' ? el('span', 'filler', run.text) : run.text);
  }
  return answer;
}

/**
 * Renders one element's verdict: what the player said, the correction where it was wrong, the
 * reason a box of the strip was amended, and the rows that decided it.
 *
 * @param verdict The verdict for one element of the clearance, picked or typed, or for one box of
 *   the strip.
 * @returns The verdict row.
 */
export function renderVerdict(verdict: Grade | TextGrade | BoxElementGrade): HTMLElement {
  const lines = verdictLines(verdict);
  const row = el('div', `verdict ${lines.verdict}`);
  const answer = answerLine(verdict, lines.answer);
  const mark = verdictMark(lines.verdict);
  if (mark !== undefined) answer.append(el('span', 'mark', mark));
  row.append(el('h3', '', elementLabel(verdict.element)), answer);
  if (lines.correction !== undefined) row.append(el('p', 'expected', lines.correction));
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
 * A route with nothing to hand over as filed is read in full on frequency, and the second block
 * would then repeat the first word for word, so it is left out.
 */
function revealPanel(spoken: SpokenClearance): HTMLElement {
  const panel = el('div', 'reveal');
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
    revealPanel(props.spoken),
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
 * @param props The verdicts, the spoken clearance, and the handlers for retry and next scenario.
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
 * @param props The verdicts of the earlier answer, the spoken clearance, and the two handlers.
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
