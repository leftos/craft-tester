import type { SpokenClearance } from '@/rules/speak.ts';
import type { Grade, RuleCitation, Verdict } from '@/rules/types.ts';
import { button, el } from '@/ui/dom.ts';
import { elementLabel } from '@/ui/labels.ts';

/** Everything the results view shows after the form is submitted. */
export type ResultsProps = {
  grades: readonly Grade[];
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
 * The line that says how many answers were right.
 *
 * An acceptable answer counts as correct, because it is one: the score line then says how many of
 * them were longer than they needed to be. A half verdict counts as half a box, the arrival routing
 * being the only thing it missed, and the line says how many of those there were too.
 *
 * @param grades The verdict for every element, or for every box of the strip.
 * @param noun What the verdicts are of, `elements` or `boxes`.
 * @returns The score, e.g. `4 of 5 elements correct, 1 acceptable but inefficient` or
 *   `2½ of 3 boxes correct, 1 half credit (arrival routing)`.
 */
export function scoreLine(grades: readonly Grade[], noun: 'elements' | 'boxes'): string {
  const acceptable = countOf(grades, 'acceptable');
  const half = countOf(grades, 'half');
  const correct = countOf(grades, 'correct') + acceptable + half * HALF_CREDIT;
  const tails = [
    ...(half === 0 ? [] : [`${half} half credit (arrival routing)`]),
    ...(acceptable === 0 ? [] : [`${acceptable} acceptable but inefficient`]),
  ];
  return [`${countLabel(correct)} of ${grades.length} ${noun} correct`, ...tails].join(', ');
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
 * The second line a verdict reads: a correction where it was wrong, the shorter reading where it was
 * acceptable, the box that would have earned the whole point where it earned half, and nothing at
 * all where it was correct.
 */
function correctionLine(verdict: Grade): string | undefined {
  if (verdict.verdict === 'wrong') return `correction: ${verdict.expectedLabel}`;
  if (verdict.verdict === 'acceptable') return `shorter: ${verdict.expectedLabel}`;
  if (verdict.verdict === 'half') return `full credit: ${verdict.expectedLabel}`;
  return undefined;
}

/**
 * The lines one verdict reads as: the player's answer, and the second line their answer earns.
 *
 * @param verdict The verdict for one element.
 * @returns The answer line, how it was answered, and the correction or the shorter reading.
 */
export function verdictLines(verdict: Grade): {
  answer: string;
  verdict: Verdict;
  correction: string | undefined;
} {
  return {
    answer: `you said: ${verdict.actualLabel}`,
    verdict: verdict.verdict,
    correction: correctionLine(verdict),
  };
}

/** The mark an answer earns beside it: a tick for a full point, a half for half one, else none. */
function verdictMark(verdict: Verdict): string | undefined {
  if (verdict === 'wrong') return undefined;
  return verdict === 'half' ? '½' : '✓';
}

/**
 * Renders one element's verdict: what the player said, the correction where it was wrong, and why.
 *
 * @param verdict The verdict for one element of the clearance, or for one box of the strip.
 * @returns The verdict row.
 */
export function renderVerdict(verdict: Grade): HTMLElement {
  const lines = verdictLines(verdict);
  const row = el('div', `verdict ${lines.verdict}`);
  const answer = el('p', 'answer', lines.answer);
  const mark = verdictMark(lines.verdict);
  if (mark !== undefined) answer.append(el('span', 'mark', mark));
  row.append(el('h3', '', elementLabel(verdict.element)), answer);
  if (lines.correction !== undefined) row.append(el('p', 'expected', lines.correction));
  row.append(citationList(verdict.citations));
  return row;
}

/**
 * The clearance as it is read on frequency, and the same clearance with the route read in full.
 *
 * A route with nothing to hand over as filed is read in full on frequency, and the second block
 * would then repeat the first word for word, so it is left out.
 */
function revealPanel(spoken: SpokenClearance): HTMLElement {
  const panel = el('div', 'reveal');
  panel.append(el('h3', '', 'On frequency'), el('p', 'spoken', spoken.abbreviated));
  if (spoken.abbreviated !== spoken.fullRoute) {
    panel.append(el('h3', '', 'With the route read in full'), el('p', 'spoken', spoken.fullRoute));
  }
  return panel;
}

/** The score, a verdict per element with its citations, and the spoken reveal. */
function resultsBody(props: ResultsProps): HTMLElement[] {
  return [
    el('p', 'score', scoreLine(props.grades, 'elements')),
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
