import type { Box, BoxAnswer } from '@/rules/amend/grade.ts';
import { button, el, PHONE_QUERY } from '@/ui/dom.ts';
import type { PickKey } from '@/ui/state.ts';
import { diffWords } from '@/ui/wordDiff.ts';

/**
 * The page elements a tour step can point at. Each is carried by one element of the page as
 * `data-tour="<id>"`, so a misspelt id fails the typecheck instead of finding nothing.
 */
export type TourAnchor =
  | 'strip'
  | 'atis'
  | 'procedure'
  | 'routeTemplate'
  | 'routeFix'
  | 'altitudePhrase'
  | 'altitudeFeet'
  | 'expect'
  | 'frequency'
  | 'runway'
  | 'submit'
  | 'results'
  | 'box-type'
  | 'box-altitude'
  | 'box-route'
  | 'boxes-submit'
  | 'home-test';

/**
 * What moves a step on: the card's Next button, a pick of one dropdown to one value, an answer to
 * one box of the strip, or submitting the clearance.
 */
export type TourAdvance =
  | 'next'
  | { pick: PickKey; value: string }
  | { box: Box; answer: BoxAnswer }
  | 'submit';

/**
 * One step of a tour.
 *
 * @property anchor The element the step spotlights.
 * @property title The card's heading, and the dialog's accessible name.
 * @property body What the card says.
 * @property advance What moves the student on to the next step.
 */
export type TourStep = { anchor: TourAnchor; title: string; body: string; advance: TourAdvance };

/** How a tour ended: Finish on its last step, or Skip (the button or Escape). */
export type TourEnd = 'finish' | 'skip';

/**
 * What a wrong pick or box answer showed, for the card to set against what the step expects.
 *
 * @property said The label of what the student picked.
 * @property expected The label of what the step expects.
 * @property citations The rows that decide the expected answer, as text.
 */
export type WrongPick = { said: string; expected: string; citations: readonly string[] };

/**
 * What a tour runs on.
 *
 * @property steps The steps, in order; at least one.
 * @property from The index of the step to open on, to resume a tour left part way.
 * @property onStep Called with a step's index each time it opens, for the caller to store progress.
 * @property onEnd Called once when the tour finishes or is skipped; never after `stop()`.
 */
export type TourOptions = {
  steps: readonly TourStep[];
  from: number;
  onStep: (index: number) => void;
  onEnd: (end: TourEnd) => void;
};

/**
 * The handle the app drives a running tour through.
 *
 * @property refresh Finds the current step's anchor again and redraws around it; the app calls it
 *   after each update, since a re-render replaces the anchor's element.
 * @property picked Reports a pick of a dropdown, with what the card shows when it is wrong.
 * @property boxed Reports an answer to a box of the strip, with what the card shows when it is wrong.
 * @property submitted Reports that the student submitted.
 * @property stop Takes the tour off the page without calling `onEnd`.
 */
export type TourDriver = {
  refresh(): void;
  picked(key: PickKey, value: string, wrong: WrongPick | null): void;
  boxed(box: Box, answer: BoxAnswer, wrong: WrongPick | null): void;
  submitted(): void;
  stop(): void;
};

/** The setting under which the anchor is scrolled to without animation. */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** The space between the anchor and the card, in pixels. */
const CARD_GAP = 12;

/** The card's distance from the viewport's edge, in pixels. */
const EDGE = 16;

/** What Tab can land on inside the anchor. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** How many tours have started, which keeps each card body's id unique. */
let toursStarted = 0;

/** The parts of the card, built once per tour and updated in place. */
type CardParts = {
  card: HTMLElement;
  count: HTMLElement;
  title: HTMLElement;
  body: HTMLElement;
  acts: HTMLElement;
};

/** The state of one running tour and the nodes it draws. */
type Tour = CardParts & {
  options: TourOptions;
  index: number;
  furthest: number;
  wrong: WrongPick | null;
  anchor: HTMLElement | null;
  root: HTMLElement;
  spot: HTMLElement;
  shields: readonly HTMLElement[];
  returnFocus: Element | null;
  over: boolean;
  frame: number;
  onKey: (event: KeyboardEvent) => void;
  onFocus: (event: FocusEvent) => void;
  onMove: () => void;
};

/** The step the tour is on. */
function stepOf(tour: Tour): TourStep {
  const step = tour.options.steps[tour.index];
  if (step === undefined) throw new Error(`the tour has no step ${tour.index}`);
  return step;
}

/** The element on the page that carries this anchor, or `null` where the page has none. */
function findAnchor(anchor: TourAnchor): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
}

/** Moves focus to a node without scrolling the page to it. */
function focusOn(node: HTMLElement): void {
  node.focus({ preventScroll: true });
}

/** Whether the app lays out for a phone. */
function isPhone(): boolean {
  return globalThis.matchMedia(PHONE_QUERY).matches;
}

/** Scrolls the anchor into view, without animation where the student asked for less motion. */
function scrollToAnchor(anchor: HTMLElement): void {
  const reduced = globalThis.matchMedia(REDUCED_MOTION_QUERY).matches;
  anchor.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
}

/**
 * Finds the current step's anchor, scrolling it into view when `always` is set (a step opening) or
 * when it is not the element the last draw had.
 */
function locate(tour: Tour, always: boolean): void {
  const found = findAnchor(stepOf(tour).anchor);
  if (found !== null && (always || found !== tour.anchor)) scrollToAnchor(found);
  tour.anchor = found;
}

/** Sets a fixed node's box, in viewport pixels. */
function setBox(node: HTMLElement, left: number, top: number, width: number, height: number): void {
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
  node.style.width = `${Math.max(0, width)}px`;
  node.style.height = `${Math.max(0, height)}px`;
}

/** Lays the four shields over the viewport around the anchor's box: above, below, left, right. */
function placeShields(shields: readonly HTMLElement[], rect: DOMRect): void {
  const width = globalThis.innerWidth;
  const height = globalThis.innerHeight;
  const boxes: readonly (readonly [number, number, number, number])[] = [
    [0, 0, width, rect.top],
    [0, rect.bottom, width, height - rect.bottom],
    [0, rect.top, rect.left, rect.height],
    [rect.right, rect.top, width - rect.right, rect.height],
  ];
  shields.forEach((shield, at) => {
    const box = boxes[at];
    shield.classList.remove('full');
    if (box !== undefined) setBox(shield, ...box);
  });
}

/**
 * The card's top edge: below the anchor where it fits there, else above where it fits there, else
 * on the side with more room. The top is kept inside the viewport, so a card too tall for its side
 * sits against the viewport's far edge on that side, covering as little of the anchor as it can.
 */
function cardTop(rect: DOMRect, height: number): number {
  const view = globalThis.innerHeight;
  const below = view - rect.bottom - CARD_GAP - EDGE;
  const above = rect.top - CARD_GAP - EDGE;
  const goBelow = below >= height || (above < height && below >= above);
  const ideal = goBelow ? rect.bottom + CARD_GAP : rect.top - CARD_GAP - height;
  return Math.max(EDGE, Math.min(ideal, view - height - EDGE));
}

/** Puts the card beside the anchor; on a phone at the left edge, elsewhere lined up with it. */
function placeCard(card: HTMLElement, rect: DOMRect): void {
  card.classList.remove('centred');
  const size = card.getBoundingClientRect();
  const widest = globalThis.innerWidth - size.width - EDGE;
  const left = isPhone() ? EDGE : Math.max(EDGE, Math.min(rect.left, widest));
  card.style.top = `${cardTop(rect, size.height)}px`;
  card.style.left = `${left}px`;
}

/**
 * Dims and shields the whole viewport, with no spotlight and the card centred, for a step whose
 * anchor the page has not drawn, so the page stays inert until it does.
 */
function drawWithoutAnchor(tour: Tour): void {
  tour.spot.remove();
  const [whole, ...rest] = tour.shields;
  for (const shield of rest) shield.remove();
  if (whole !== undefined) {
    whole.removeAttribute('style');
    whole.classList.add('full');
    tour.root.prepend(whole);
  }
  tour.card.style.removeProperty('top');
  tour.card.style.removeProperty('left');
  tour.card.classList.add('centred');
}

/** Draws the spotlight, the shields and the card around the current anchor. */
function draw(tour: Tour): void {
  tour.card.classList.toggle('phone', isPhone());
  if (tour.anchor === null || !tour.anchor.isConnected) {
    drawWithoutAnchor(tour);
    return;
  }
  const rect = tour.anchor.getBoundingClientRect();
  tour.spot.dataset['anchor'] = stepOf(tour).anchor;
  setBox(tour.spot, rect.left, rect.top, rect.width, rect.height);
  placeShields(tour.shields, rect);
  tour.root.prepend(tour.spot, ...tour.shields);
  placeCard(tour.card, rect);
}

/** The line a step that waits on the student shows in place of Next. */
function waitText(advance: Exclude<TourAdvance, 'next'>): string {
  if (advance === 'submit') return 'Waiting for Submit…';
  return 'pick' in advance ? 'Waiting for your pick…' : 'Waiting for your answer…';
}

/** What the student picked set against what the step expects, as the results view sets a wrong row. */
function wrongNode(wrong: WrongPick): HTMLElement {
  const runs = diffWords(wrong.said, wrong.expected);
  const said = el('p', 'tour-said');
  said.append(el('span', 'tour-term', 'You picked '));
  for (const run of runs.said) said.append(run.differs ? el('span', 'wrong', run.text) : run.text);
  const expected = el('p', 'tour-expected');
  expected.append(el('span', 'tour-term', 'Reads as '));
  for (const run of runs.expected) {
    expected.append(run.differs ? el('strong', 'missed', run.text) : run.text);
  }
  const citations = el('ul', 'citations');
  for (const citation of wrong.citations) citations.append(el('li', '', citation));
  const node = el('div', 'tour-wrong');
  node.append(said, expected, citations);
  return node;
}

/** Whether Back shows: past the first step, and not after a submit, since the page has moved on. */
function canGoBack(tour: Tour): boolean {
  const previous = tour.options.steps[tour.index - 1];
  return previous !== undefined && previous.advance !== 'submit';
}

/**
 * Next (Finish on the last step), or the wait line on a step that waits on the student and has not
 * been done yet; a step below the furthest one reached was done, so it moves on with Next.
 */
function forwardNode(tour: Tour, step: TourStep): HTMLElement {
  const waits = tour.index >= tour.furthest || tour.wrong !== null;
  if (step.advance !== 'next' && waits) {
    return el('span', 'wait', waitText(step.advance));
  }
  const last = tour.index === tour.options.steps.length - 1;
  return button(last ? 'Finish' : 'Next', 'primary', () => moveTo(tour, tour.index + 1));
}

/** Writes the card's buttons: Back where it applies, Skip, and Next or the wait line. */
function fillActions(tour: Tour, step: TourStep): void {
  const back = canGoBack(tour)
    ? [button('Back', 'secondary', () => moveTo(tour, tour.index - 1))]
    : [];
  tour.acts.replaceChildren(
    ...back,
    button('Skip', 'tour-skip', () => end(tour, 'skip')),
    el('span', 'tour-spacer'),
    forwardNode(tour, step),
  );
}

/** Writes the current step into the card's parts. */
function renderCard(tour: Tour): void {
  const step = stepOf(tour);
  tour.card.setAttribute('aria-label', step.title);
  tour.count.textContent = `${tour.index + 1} of ${tour.options.steps.length}`;
  tour.title.textContent = step.title;
  tour.body.replaceChildren(el('p', '', step.body));
  if (tour.wrong !== null) tour.body.append(wrongNode(tour.wrong));
  fillActions(tour, step);
}

/** Opens one step: writes the card, finds and spotlights its anchor, and focuses the card. */
function openStep(tour: Tour, index: number): void {
  tour.index = index;
  tour.furthest = Math.max(tour.furthest, index);
  tour.wrong = null;
  renderCard(tour);
  locate(tour, true);
  draw(tour);
  focusOn(tour.card);
  tour.options.onStep(index);
}

/** Opens a step, or finishes the tour when the index runs past its last one. */
function moveTo(tour: Tour, index: number): void {
  if (index >= tour.options.steps.length) end(tour, 'finish');
  else openStep(tour, index);
}

/** Takes everything the tour drew and listens to off the page, and gives focus back. */
function teardown(tour: Tour): void {
  if (tour.over) return;
  tour.over = true;
  document.removeEventListener('keydown', tour.onKey, { capture: true });
  document.removeEventListener('focusin', tour.onFocus, { capture: true });
  globalThis.removeEventListener('resize', tour.onMove);
  globalThis.removeEventListener('scroll', tour.onMove, { capture: true });
  if (tour.frame !== 0) globalThis.cancelAnimationFrame(tour.frame);
  tour.root.remove();
  if (tour.returnFocus instanceof HTMLElement) focusOn(tour.returnFocus);
}

/** Ends the tour and tells the caller how. */
function end(tour: Tour, how: TourEnd): void {
  if (tour.over) return;
  teardown(tour);
  tour.options.onEnd(how);
}

/** Whether an element of the anchor is shown: on the page, not inside a closed `<details>`, sized. */
function shown(node: HTMLElement): boolean {
  if (!node.isConnected) return false;
  const closed = node.parentElement?.closest('details:not([open])');
  if (closed !== null && closed !== undefined) {
    const isItsSummary = node.matches('summary') && node.parentElement === closed;
    if (!isItsSummary) return false;
  }
  const rect = node.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

/** What Tab cycles through while the tour runs: the anchor's shown controls, then the card's buttons. */
function focusRing(tour: Tour): HTMLElement[] {
  const inAnchor =
    tour.anchor === null
      ? []
      : [tour.anchor, ...tour.anchor.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          (node) => node.matches(FOCUSABLE) && shown(node),
        );
  return [...inAnchor, ...tour.card.querySelectorAll<HTMLElement>('button')];
}

/** Moves focus to the next (or, with Shift, the previous) stop of the ring, wrapping at its ends. */
function cycleFocus(tour: Tour, event: KeyboardEvent): void {
  const ring = focusRing(tour);
  if (ring.length === 0) return;
  event.preventDefault();
  const at = ring.findIndex((node) => node === document.activeElement);
  const step = event.shiftKey ? -1 : 1;
  const first = event.shiftKey ? ring.length - 1 : 0;
  const next = ring[at === -1 ? first : (at + step + ring.length) % ring.length];
  if (next !== undefined) focusOn(next);
}

/** Escape skips the tour; Tab and Shift+Tab stay among the anchor and the card. */
function onKeydown(tour: Tour, event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    end(tour, 'skip');
  } else if (event.key === 'Tab') {
    cycleFocus(tour, event);
  }
}

/** Sends focus that lands outside the anchor and the card back to the card. */
function onFocusin(tour: Tour, event: FocusEvent): void {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (tour.card.contains(target) || (tour.anchor?.contains(target) ?? false)) return;
  focusOn(tour.card);
}

/** Redraws on the next frame, at most once per frame, after the app's own scroll handling. */
function scheduleDraw(tour: Tour): void {
  if (tour.frame !== 0) return;
  tour.frame = globalThis.requestAnimationFrame(() => {
    tour.frame = 0;
    if (!tour.over) draw(tour);
  });
}

/** Keeps the step and shows on the card what was wrong with the student's answer. */
function showWrong(tour: Tour, wrong: WrongPick | null): void {
  tour.wrong = wrong;
  renderCard(tour);
  draw(tour);
}

/** Whether two answers to a box are the same: the same kind, and for an amendment the same value. */
function sameAnswer(a: BoxAnswer, b: BoxAnswer): boolean {
  if (a.kind === 'as_filed' || b.kind === 'as_filed') return a.kind === b.kind;
  return a.value === b.value;
}

/** Builds the card frame: the dialog, its caption, heading, live body and button row. */
function cardParts(): CardParts {
  toursStarted += 1;
  const card = el('div', 'tour-card');
  card.setAttribute('role', 'dialog');
  card.tabIndex = -1;
  const count = el('p', 'tour-count');
  const title = el('h4');
  const body = el('div', 'tour-body');
  body.id = `tour-body-${toursStarted}`;
  body.setAttribute('aria-live', 'polite');
  card.setAttribute('aria-describedby', body.id);
  const acts = el('div', 'tour-acts');
  card.append(count, title, body, acts);
  return { card, count, title, body, acts };
}

/** Builds the overlay's nodes: the root, the spotlight, four shields, and the card. */
function overlayNodes(): Pick<Tour, 'root' | 'spot' | 'shields' | keyof CardParts> {
  const root = el('div', 'tour');
  const spot = el('div', 'tour-spot');
  const shields = [0, 1, 2, 3].map(() => el('div', 'tour-shield'));
  const parts = cardParts();
  root.append(parts.card);
  return { root, spot, shields, ...parts };
}

/** The driver the app holds for a running tour. */
function driverOf(tour: Tour): TourDriver {
  return {
    refresh: () => {
      if (tour.over) return;
      locate(tour, false);
      draw(tour);
    },
    picked: (key, value, wrong) => {
      const advance = stepOf(tour).advance;
      if (tour.over || typeof advance !== 'object' || !('pick' in advance) || advance.pick !== key)
        return;
      if (advance.value === value) moveTo(tour, tour.index + 1);
      else showWrong(tour, wrong);
    },
    boxed: (box, answer, wrong) => {
      const advance = stepOf(tour).advance;
      if (tour.over || typeof advance !== 'object' || !('box' in advance) || advance.box !== box)
        return;
      if (sameAnswer(advance.answer, answer)) moveTo(tour, tour.index + 1);
      else showWrong(tour, wrong);
    },
    submitted: () => {
      if (!tour.over && stepOf(tour).advance === 'submit') moveTo(tour, tour.index + 1);
    },
    stop: () => {
      teardown(tour);
    },
  };
}

/** Adds the tour's listeners to the document and the window. */
function listen(tour: Tour): void {
  document.addEventListener('keydown', tour.onKey, { capture: true });
  document.addEventListener('focusin', tour.onFocus, { capture: true });
  globalThis.addEventListener('resize', tour.onMove, { passive: true });
  globalThis.addEventListener('scroll', tour.onMove, { passive: true, capture: true });
}

/**
 * Starts a tour over the page: a spotlight and a card over each step's `data-tour` anchor.
 *
 * While it runs only the spotlit anchor and the card take the pointer, Tab and focus; the rest of
 * the page sits behind transparent shields. The overlay lives in `document.body`, outside the app's
 * root, and finds its anchor again on every `refresh()`.
 *
 * @param options The steps, the step to open on, and the callbacks.
 * @returns The driver the app reports picks, box answers and submits through.
 * @throws Error when `from` is not the index of one of the steps, and whatever `onStep` throws on
 *   the first step, after taking the tour off the page.
 */
export function startTour(options: TourOptions): TourDriver {
  if (!Number.isInteger(options.from) || options.from < 0 || options.from >= options.steps.length) {
    throw new Error(
      `startTour: from ${options.from} is not a step of a ${options.steps.length}-step tour`,
    );
  }
  const tour: Tour = {
    options,
    index: options.from,
    furthest: options.from,
    wrong: null,
    anchor: null,
    ...overlayNodes(),
    returnFocus: document.activeElement,
    over: false,
    frame: 0,
    onKey: (event) => {
      onKeydown(tour, event);
    },
    onFocus: (event) => {
      onFocusin(tour, event);
    },
    onMove: () => {
      scheduleDraw(tour);
    },
  };
  document.body.append(tour.root);
  listen(tour);
  try {
    openStep(tour, options.from);
  } catch (error) {
    teardown(tour);
    throw error;
  }
  return driverOf(tour);
}
