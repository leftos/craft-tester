import type { SpokenClearance } from '@/rules/speak.ts';
import type { Grade, RuleCitation } from '@/rules/types.ts';
import { button, el } from '@/ui/dom.ts';
import { elementLabel } from '@/ui/labels.ts';

/** Everything the results view shows after the form is submitted. */
export type ResultsProps = {
  grades: readonly Grade[];
  spoken: SpokenClearance;
  onNext: () => void;
  onRetry: () => void;
};

/**
 * The line that says how many elements were right.
 *
 * @param grades The verdict for every element.
 * @returns The score, e.g. `4 of 5 elements correct`.
 */
export function scoreLine(grades: readonly Grade[]): string {
  const correct = grades.filter((verdict) => verdict.ok).length;
  return `${correct} of ${grades.length} elements correct`;
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
 * The lines one verdict reads as: the player's answer, and the correction a wrong answer earns.
 *
 * @param verdict The verdict for one element.
 * @returns The answer line, whether it was right, and the correction line when it was not.
 */
export function verdictLines(verdict: Grade): {
  answer: string;
  correct: boolean;
  correction: string | undefined;
} {
  return {
    answer: `you said: ${verdict.actualLabel}`,
    correct: verdict.ok,
    correction: verdict.ok ? undefined : `correction: ${verdict.expectedLabel}`,
  };
}

/** One element's verdict: what the player said, the correction where it was wrong, and why. */
function gradeRow(verdict: Grade): HTMLElement {
  const lines = verdictLines(verdict);
  const row = el('div', `verdict ${verdict.ok ? 'ok' : 'bad'}`);
  const answer = el('p', 'answer', lines.answer);
  if (lines.correct) answer.append(el('span', 'mark', '✓'));
  row.append(el('h3', '', elementLabel(verdict.element)), answer);
  if (lines.correction !== undefined) row.append(el('p', 'expected', lines.correction));
  row.append(citationList(verdict.citations));
  return row;
}

/** The clearance as it is read on frequency, abbreviated and with the filed route in full. */
function revealPanel(spoken: SpokenClearance): HTMLElement {
  const panel = el('div', 'reveal');
  panel.append(
    el('h3', '', 'On frequency'),
    el('p', 'spoken', spoken.abbreviated),
    el('h3', '', 'With the route read in full'),
    el('p', 'spoken', spoken.fullRoute),
  );
  return panel;
}

/** The score, a verdict per element with its citations, and the spoken reveal. */
function resultsBody(props: ResultsProps): HTMLElement[] {
  return [
    el('p', 'score', scoreLine(props.grades)),
    ...props.grades.map((verdict) => gradeRow(verdict)),
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
