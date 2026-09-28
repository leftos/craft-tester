import { button, el, segmentedControl } from '@/ui/dom.ts';
import type { SegmentOption } from '@/ui/dom.ts';
import type { SetState } from '@/ui/state.ts';
import type { ClockReading, SetSummary } from '@/ui/testSet.ts';
import { clockReading, formatClock, squareOf, timeUsed } from '@/ui/testSet.ts';

/** The strip counts a set is started with, in the order the Test popover offers them. */
const SET_SIZES: readonly number[] = [5, 10, 20];

/** The strip count the Test popover starts on. */
const DEFAULT_SET_SIZE = 10;

/** The time limits a set is started with, in minutes; 0 is untimed. */
const SET_MINUTES: readonly number[] = [10, 20, 30, 0];

/** The time limit the Test popover starts on, in minutes. */
const DEFAULT_SET_MINUTES = 20;

/** The question End test asks before it ends the set. */
export const END_TEST_QUESTION = 'End the test now? Unanswered strips count as zero.';

/** What the test bar calls back into. */
export type TestBarHandlers = {
  /** Opens a skipped strip again, by its 0-based index. */
  onGoToStrip: (index: number) => void;
  onEndTest: () => void;
};

/**
 * A form's submit button, with a Skip button beside it where a test set offers one.
 *
 * @param submit The form's submit button.
 * @param onSkip Leaves the strip unanswered, or `undefined` outside a test set.
 * @returns The submit button alone outside a set, or a row holding it and Skip.
 */
export function withSkip(submit: HTMLButtonElement, onSkip: (() => void) | undefined): HTMLElement {
  if (onSkip === undefined) return submit;
  const row = el('div', 'form-actions');
  row.append(submit, button('Skip', 'secondary', onSkip));
  return row;
}

/** The strip-count choices of the Test popover. */
const SIZE_OPTIONS: readonly SegmentOption[] = SET_SIZES.map((n) => ({
  value: String(n),
  label: String(n),
  title: `${n} strips`,
}));

/** The time-limit choices of the Test popover. */
const MINUTE_OPTIONS: readonly SegmentOption[] = SET_MINUTES.map((minutes) => ({
  value: String(minutes),
  label: minutes === 0 ? 'Untimed' : `${minutes} min`,
  title: '',
}));

/**
 * The Test button and the popover it opens: how many strips, how long, and Start.
 *
 * The choices live in the popover until Start reads them; nothing about them is in the state or
 * the hash until a set starts.
 *
 * @param onStart Called with the strip count and the minutes (0 for untimed) when Start is pressed.
 * @returns The popover, a `<details>` element the caller closes on an outside press.
 */
export function renderTestStart(onStart: (n: number, minutes: number) => void): HTMLDetailsElement {
  let n = DEFAULT_SET_SIZE;
  let minutes = DEFAULT_SET_MINUTES;
  const details = el('details', 'test-start');
  const popover = el('div', 'test-popover');
  const sizes = segmentedControl(
    { label: 'Strips', options: SIZE_OPTIONS, value: String(n) },
    (raw) => {
      n = Number(raw);
    },
  );
  const limits = segmentedControl(
    { label: 'Time', options: MINUTE_OPTIONS, value: String(minutes) },
    (raw) => {
      minutes = Number(raw);
    },
  );
  popover.append(
    labelled('Strips', sizes),
    labelled('Time', limits),
    button('Start', 'primary', () => {
      details.open = false;
      onStart(n, minutes);
    }),
  );
  const summary = el('summary', '', 'Test');
  summary.setAttribute('role', 'button');
  summary.setAttribute('aria-expanded', 'false');
  details.addEventListener('toggle', () => {
    summary.setAttribute('aria-expanded', String(details.open));
  });
  details.append(summary, popover);
  return details;
}

/** A control of the Test popover under the word that names it. */
function labelled(label: string, control: HTMLElement): HTMLElement {
  const row = el('div', 'test-choice');
  row.append(el('span', 'field-label', label), control);
  return row;
}

/**
 * The progress squares: answered, on screen, skipped, and not reached. A skipped square is a button
 * that opens its strip again while the set runs; every other square is decoration.
 */
function renderDots(set: SetState, handlers: TestBarHandlers): HTMLElement {
  const dots = el('span', 'dots');
  for (let index = 0; index < set.n; index += 1) {
    const square = squareOf(set, index);
    if (square === 'skipped' && !set.ended) {
      const node = button('', 'skipped', () => {
        handlers.onGoToStrip(index);
      });
      node.setAttribute('aria-label', `Strip ${index + 1}, skipped`);
      dots.append(node);
      continue;
    }
    const node = el('i', square === 'open' ? '' : square);
    node.setAttribute('aria-hidden', 'true');
    dots.append(node);
  }
  return dots;
}

/**
 * The test bar, which stands in for the toolbar while a set runs and over its summary: the strip on
 * screen out of the count, the progress squares, the clock, and End test while the set runs.
 *
 * The clock is written once here; the page ticks it every second by writing the `.clock` node's
 * text alone.
 *
 * @param set The set.
 * @param handlers What the squares and End test call back into.
 * @param now The time now, which the clock reads.
 * @returns The bar.
 */
export function renderTestBar(set: SetState, handlers: TestBarHandlers, now: number): HTMLElement {
  const bar = el('div', 'toolbar testbar');
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-label', set.ended ? 'Test finished' : 'Test in progress');
  const reading: ClockReading = set.ended
    ? { text: formatClock(timeUsed(set, now)), label: 'Time used' }
    : clockReading(set, now);
  const clock = el('span', 'clock', reading.text);
  clock.setAttribute('aria-label', reading.label);
  const where = set.ended ? 'Finished' : `Strip ${set.index + 1} of ${set.n}`;
  bar.append(
    el('strong', '', 'Test'),
    el('span', 'where', where),
    renderDots(set, handlers),
    clock,
    el('span', 'toolbar-spacer'),
  );
  if (!set.ended) bar.append(button('End test', 'secondary', handlers.onEndTest));
  return bar;
}

/**
 * The summary of a finished set: both totals, the time used, and one row per strip with its score
 * line and a link that opens the strip in the revisit view, in a tab of its own so the summary
 * stays.
 *
 * @param summary The totals, the time used and the rows.
 * @param onNewStrip Leaves the set for a fresh strip.
 * @returns The summary panel.
 */
export function renderSetSummary(summary: SetSummary, onNewStrip: () => void): HTMLElement {
  const panel = el('section', 'panel set-summary');
  const { fullyCorrect, percent } = summary.totals;
  const list = el('ol', 'set-rows');
  for (const row of summary.rows) {
    const item = el('li', row.answered ? '' : 'unanswered');
    const link = el('a', '', 'Open');
    link.href = row.hash;
    link.target = '_blank';
    link.rel = 'noopener';
    link.setAttribute('aria-label', `Open strip ${row.number}`);
    item.append(
      el('span', 'set-strip', `Strip ${row.number}`),
      el('span', 'set-line', row.line),
      link,
    );
    list.append(item);
  }
  const actions = el('div', 'actions');
  actions.append(button('New strip', 'primary', onNewStrip));
  panel.append(
    el('h2', '', 'Test results'),
    el(
      'p',
      'score',
      `${fullyCorrect} of ${summary.n} strips fully correct · ${percent}% of elements`,
    ),
    el('p', 'muted', `Time used ${summary.timeUsed}`),
    list,
    actions,
  );
  return panel;
}
