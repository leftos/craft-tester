import swa1740 from '@fixtures/koak/worksheets/phraseology-practice-1a-swa1740.json';
import jsx201 from '@fixtures/koak/worksheets/amendment-practice-1a-jsx201.json';
import type { AirportData, AirportsIndex, Scenario, Training } from '@/data/schema.ts';
import { FixtureSchema } from '@/data/schema.ts';
import type { Box, BoxAnswer } from '@/rules/amend/grade.ts';
import { withCurrentVersions } from '@/rules/fixtureVersions.ts';
import type { ResolvedClearance } from '@/rules/types.ts';
import type { InputKind, Mode, ScenarioFilter, SessionSettings } from '@/scenario/filter.ts';
import {
  ANY_SCENARIO,
  airportFromHash,
  filterFromHash,
  fullRouteFromHash,
  hasFilterParams,
  hashFor,
  inputKindFromHash,
  modeFromHash,
  runwayGradingFromHash,
  setFromHash,
} from '@/scenario/filter.ts';
import { randomSeed, seedFromHash } from '@/scenario/rng.ts';
import type { StagedSettings } from '@/scenario/stage.ts';
import { airportLock, clampSettings, firstOpenAirport, isOpenAt } from '@/scenario/stage.ts';
import type { AnswerChoice } from '@/ui/answerChoice.ts';
import { ANSWER_OPTIONS } from '@/ui/answerChoice.ts';
import type { Panels } from '@/ui/amendPanels.ts';
import { procedureOf, renderAmendmentPanels } from '@/ui/amendPanels.ts';
import { boxInputName } from '@/ui/amendForm.ts';
import { renderAtis } from '@/ui/atis.ts';
import type { CraftFormProps } from '@/ui/craftForm.ts';
import { clearanceProcedureRow, renderCraftForm } from '@/ui/craftForm.ts';
import { button, el, PHONE_QUERY, segmentedControl } from '@/ui/dom.ts';
import type { SegmentOption } from '@/ui/dom.ts';
import { filterControls, runwayGradingControl } from '@/ui/filterControls.ts';
import type { HomeProps } from '@/ui/home.ts';
import { continueTestRow, homeTestRows, renderHome } from '@/ui/home.ts';
import type {
  FilterStore,
  FullRouteStore,
  HomeChoices,
  HomeStore,
  InputKindStore,
  RunwayGradingStore,
  StageStore,
  TourProgress,
  TourProgressStore,
  TourSeenStore,
} from '@/ui/preferences.ts';
import {
  browserFilterStore,
  browserFullRouteStore,
  browserHomeStore,
  browserInputKindStore,
  browserRunwayGradingStore,
  browserStageStore,
  browserTourProgressStore,
  browserTourSeenStore,
  rememberedFilter,
} from '@/ui/preferences.ts';
import type { Route, TutorialPart } from '@/ui/router.ts';
import { hrefOf, newSetSeed, routeOf } from '@/ui/router.ts';
import type { AnswerGrading } from '@/ui/clearanceGrading.ts';
import { clearanceOutcome } from '@/ui/clearanceGrading.ts';
import { renderResults, renderRevisit } from '@/ui/results.ts';
import { clearedPlan, listAirports, loadAirportData } from '@/ui/session.ts';
import type { Attempt, SolvedStore } from '@/ui/solved.ts';
import { browserSolvedStore } from '@/ui/solved.ts';
import type { AppState, PickKey, SetState } from '@/ui/state.ts';
import {
  newSession,
  newSessionFrom,
  phaseOf,
  routeReadingOf,
  shareLink,
  toAmendmentAnswer,
  toBoxAnswers,
  toClearanceAnswer,
  viewKey,
  withBox,
  withBoxesSubmitted,
  withFilter,
  withFullRoute,
  withInputKind,
  withMode,
  withPick,
  withRetry,
  withRunwayGrading,
  withSubmitted,
  withText,
} from '@/ui/state.ts';
import { addCopyLink, loadStripFont, renderStrip } from '@/ui/strip.ts';
import type { TextFormProps } from '@/ui/textForm.ts';
import { renderTextForm } from '@/ui/textForm.ts';
import {
  DEFAULT_SET_MINUTES,
  DEFAULT_SET_SIZE,
  END_TEST_QUESTION,
  renderSetSummary,
  renderTestBar,
  renderTestStart,
} from '@/ui/testBar.ts';
import type { SetListing, SetStore } from '@/ui/testSet.ts';
import {
  browserSetStore,
  clockReading,
  endedSet,
  isTimeUp,
  onSetStrip,
  openedSet,
  recordOf,
  setSummary,
  storedSetScore,
  withStripAnswered,
  withStripSkipped,
} from '@/ui/testSet.ts';
import type { TourDriver, TourEnd, TourStep, WrongPick } from '@/ui/tour.ts';
import { startTour } from '@/ui/tour.ts';
import { AMEND_TOUR, CLEARANCE_TOUR, HOME_TOUR, TOUR_STEPS_VERSION } from '@/ui/tourSteps.ts';

export { clearancePickGrades } from '@/ui/clearanceGrading.ts';

/** What the page's controls call back into. */
type Actions = {
  onAirport: (icao: string) => void;
  /**
   * Answers the scenario on screen another way, on the same seed, and remembers the choice: Pick
   * answers from the dropdowns, Type types it, and Full route types it held to the route read to
   * its end.
   */
  onAnswer: (answer: AnswerChoice) => void;
  onBox: (box: Box, answer: BoxAnswer) => void;
  onBoxesSubmit: () => void;
  /** Narrows the draw to what the dropdowns say; a destination forced by the hash does not survive it. */
  onFilter: (filter: ScenarioFilter) => void;
  /**
   * Grades the runway on the scenario on screen, or stops grading it, and remembers the choice.
   * Undefined on a tutorial page, which offers no Runway control: the tour always grades the runway.
   */
  onRunwayGrading: ((graded: boolean) => void) | undefined;
  onMode: (mode: Mode) => void;
  onNewScenario: () => void;
  onPick: (key: PickKey, raw: string) => void;
  onRetry: () => void;
  onSubmit: () => void;
  onText: (text: string) => void;
  /** Starts a test set of `n` strips, timed at `minutes` or untimed at 0, under the settings on screen. */
  onStartTest: (n: number, minutes: number) => void;
  /** Leaves the set's strip on screen unanswered and moves on. */
  onSkip: () => void;
  /** Opens a skipped strip of the set again, by its 0-based index. */
  onGoToStrip: (index: number) => void;
  /** Ends the set, once the student confirms it, and opens its summary. */
  onEndTest: () => void;
};

/** The two halves of the trainer, in the order the toolbar offers them. */
const MODE_OPTIONS: readonly (SegmentOption & { value: Mode })[] = [
  { value: 'clearance', label: 'Clearance', title: '' },
  { value: 'amendment', label: 'Amend', title: '' },
];

/** The way the session on screen is answered, as the toolbar shows it. */
function answerChoiceOf(state: AppState): AnswerChoice {
  if (state.input === 'dropdowns') return 'pick';
  return state.fullRoute ? 'full' : 'type';
}

/**
 * Puts the airport, the seed, the filter, the mode and the input kind in the hash, so a reload and
 * a link both restore them.
 */
function writeHash(icao: string, seed: number, settings: SessionSettings): void {
  replaceHash(hashFor(icao, seed, settings));
}

/**
 * The hash the page last opened or wrote. A `hashchange` to it opens nothing: the test DOM reports
 * the page's own `replaceState` writes as one, which a browser does not.
 */
let routedHash = '';

/** Writes a hash over the history entry on screen, which a reload and Back then read. */
function replaceHash(hash: string): void {
  globalThis.history.replaceState(null, '', hash);
  routedHash = globalThis.location.hash;
}

/** Every airport file this page has loaded or is loading, so each is parsed once. */
const airportCache = new Map<string, Promise<AirportData>>();

/**
 * Loads one airport's data, once per page: a later call gets the same promise, and a failed load is
 * forgotten so the next call tries again.
 *
 * @param icao The airport's ICAO identifier.
 * @returns The validated airport data.
 * @throws Error When the load fails, as `loadAirportData` does.
 */
function cachedAirport(icao: string): Promise<AirportData> {
  const cached = airportCache.get(icao);
  if (cached !== undefined) return cached;
  const loading = loadAirportData(icao).catch((error: unknown) => {
    airportCache.delete(icao);
    throw error;
  });
  airportCache.set(icao, loading);
  return loading;
}

/** The segmented control that picks the half of the trainer the session runs in. */
function modeControl(state: AppState, actions: Actions): HTMLElement {
  return segmentedControl({ label: 'Mode', options: MODE_OPTIONS, value: state.mode }, (raw) => {
    const mode = MODE_OPTIONS.find((option) => option.value === raw)?.value ?? 'clearance';
    actions.onMode(mode);
  });
}

/** The segmented control that picks how the clearance is answered: Pick, Type, or Full route. */
function answerControl(state: AppState, actions: Actions): HTMLElement {
  const spec = { label: 'Answer by', options: ANSWER_OPTIONS, value: answerChoiceOf(state) };
  return segmentedControl(spec, (raw) => {
    const answer = ANSWER_OPTIONS.find((option) => option.value === raw)?.value ?? 'pick';
    actions.onAnswer(answer);
  });
}

/** The airport picker, a bare dropdown the toolbar names for a screen reader. */
function airportControl(state: AppState, index: AirportsIndex, actions: Actions): HTMLElement {
  const select = el('select', 'airport');
  select.setAttribute('aria-label', 'Airport');
  for (const entry of index) {
    const option = el('option', '', entry.icao);
    option.value = entry.icao;
    select.append(option);
  }
  select.value = state.airport.airport.icao;
  select.addEventListener('change', () => {
    actions.onAirport(select.value);
  });
  return select;
}

/**
 * How many of the Filters choices differ from their defaults, which the Filters button counts: the
 * filters that narrow the draw, and the runway when it is not graded.
 */
function activeFilterCount(state: AppState): number {
  const time = state.filter.time === 'either' ? 0 : 1;
  const config = state.filter.config.kind === 'any' ? 0 : 1;
  const runway = state.gradeRunway ? 0 : 1;
  return time + config + runway;
}

/**
 * Closes an open popover on a press outside it or on Escape, and stops listening once it closes.
 *
 * @param details The popover, a `<details>` element.
 */
function closeOnOutsidePress(details: HTMLDetailsElement): void {
  const stop = (): void => {
    document.removeEventListener('pointerdown', onPress);
    document.removeEventListener('keydown', onKey);
  };
  const onPress = (event: PointerEvent): void => {
    if (!details.isConnected) {
      stop();
      return;
    }
    if (event.target instanceof Node && details.contains(event.target)) return;
    details.open = false;
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    details.open = false;
    details.querySelector('summary')?.focus();
  };
  details.addEventListener('toggle', () => {
    stop();
    if (!details.open) return;
    document.addEventListener('pointerdown', onPress);
    document.addEventListener('keydown', onKey);
  });
}

/**
 * The Filters button, with a count of the filters set, and the popover it opens, which holds the
 * time and configuration dropdowns and, where the page offers it, the runway grading after them.
 */
function filtersControl(state: AppState, actions: Actions): HTMLElement {
  const details = el('details', 'filters');
  const summary = el('summary', '', 'Filters');
  const count = activeFilterCount(state);
  if (count > 0) summary.append(el('span', 'count', String(count)));
  const popover = el('div', 'filters-popover');
  popover.append(...filterControls(state.filter, state.airport, actions.onFilter));
  if (actions.onRunwayGrading !== undefined) {
    popover.append(runwayGradingControl(state.gradeRunway, actions.onRunwayGrading));
  }
  details.append(summary, popover);
  closeOnOutsidePress(details);
  return details;
}

/** The Test button and its popover, which closes on a press outside it like Filters. */
function testControl(actions: Actions): HTMLElement {
  const details = renderTestStart(actions.onStartTest);
  closeOnOutsidePress(details);
  return details;
}

/**
 * The toolbar: the product name, which links home, the airport, the mode and answer switches and the Filters button,
 * then Test and New strip on the right. On a phone the answer switch, Filters and Test wrap to a
 * second row. While a test set runs, and over its summary, the test bar stands in for all of it.
 */
function renderToolbar(state: AppState, index: AirportsIndex, actions: Actions): HTMLElement {
  if (state.set !== undefined) return renderTestBar(state.set, actions, Date.now());
  const bar = el('header', 'toolbar');
  bar.setAttribute('aria-label', 'Trainer controls');
  const secondRow = el('div', 'toolbar-row2');
  secondRow.append(
    answerControl(state, actions),
    filtersControl(state, actions),
    testControl(actions),
  );
  const brand = el('h1', 'brand');
  const home = el('a', '', 'CRAFT trainer');
  home.href = '#/';
  brand.append(home);
  bar.append(
    brand,
    airportControl(state, index, actions),
    modeControl(state, actions),
    secondRow,
    el('span', 'toolbar-spacer'),
    button('New strip', 'primary', actions.onNewScenario),
  );
  return bar;
}

/**
 * The panel a seed that the engine cannot clear shows instead of the form, with New strip, or Skip
 * on a strip of a test set. The reasons stay in the view, which is where they are logged, so a
 * student reads only that the strip could not be loaded.
 */
function renderUnresolved(next: HTMLButtonElement): HTMLElement {
  const panel = el('section', 'panel unresolved');
  panel.append(el('h2', '', "Couldn't load a strip"), el('p', '', 'Try another strip.'), next);
  return panel;
}

/** The way on from a scenario the engine cannot clear: Skip in a test set, New strip otherwise. */
function unresolvedNext(state: AppState, actions: Actions): HTMLButtonElement {
  return state.set === undefined
    ? button('New strip', 'primary', actions.onNewScenario)
    : button('Skip', 'primary', actions.onSkip);
}

/** The Skip handler a form offers: the page's while a test set runs, none otherwise. */
function skipOf(state: AppState, actions: Actions): (() => void) | undefined {
  return state.set === undefined ? undefined : actions.onSkip;
}

/** The summary of a finished set in the work column, with no strip bay beside it. */
function summaryPanels(
  state: AppState,
  set: SetState,
  actions: Actions,
  solved: SolvedStore,
): Panels {
  const { icao } = state.airport.airport;
  const { mode, input, fullRoute, gradeRunway } = state;
  const scope = { mode, input, fullRoute, gradeRunway };
  const summary = setSummary(state, set, (seed) => solved.load(icao, seed, scope), Date.now());
  return {
    rail: [],
    pinned: [],
    work: [renderSetSummary(summary, actions.onNewScenario)],
    sync: undefined,
  };
}

/** What the clearance answer on screen is held to: the reading, and whether the runway is graded. */
function answerGradingOf(state: AppState): AnswerGrading {
  return { routeReading: routeReadingOf(state), gradeRunway: state.gradeRunway };
}

/**
 * The strip and the ATIS in the rail, and either the form or the results in the work column; a
 * finished test set shows its summary instead. The tour's results offer no way on to another strip.
 */
function renderPanels(
  state: AppState,
  actions: Actions,
  solved: SolvedStore,
  tutorial: boolean,
): Panels {
  if (phaseOf(state) === 'set-summary' && state.set !== undefined) {
    return summaryPanels(state, state.set, actions, solved);
  }
  if (state.view.kind === 'unresolved') {
    return {
      rail: [],
      pinned: [],
      work: [renderUnresolved(unresolvedNext(state, actions))],
      sync: undefined,
    };
  }
  if (state.view.kind === 'amendment') {
    return renderAmendmentPanels(state, state.view, actions, !tutorial);
  }
  const phase = phaseOf(state);
  const { generated, clearance } = state.view;
  const pinned = [
    renderStrip(generated, state.airport, state.seed, 'Flight plan', {
      revision: undefined,
      frc: state.fullRoute,
    }),
    renderAtis(generated, state.airport),
  ];
  const revisit = state.revisit;
  if (phase === 'clearance-revisit' && revisit?.kind === 'clearance') {
    const work = renderRevisit({
      ...clearanceOutcome(revisit, generated, clearance, state.airport, answerGradingOf(state)),
      routeReading: routeReadingOf(state),
      nextActions: !tutorial,
      onNext: actions.onNewScenario,
      onRetry: actions.onRetry,
    });
    return { rail: [], pinned, work: [work], sync: undefined };
  }
  const answer = toClearanceAnswer(state);
  if (phase === 'clearance-results' && answer !== undefined) {
    const work = renderResults({
      ...clearanceOutcome(answer, generated, clearance, state.airport, answerGradingOf(state)),
      routeReading: routeReadingOf(state),
      nextActions: !tutorial,
      onNext: actions.onNewScenario,
      onRetry: actions.onRetry,
    });
    return { rail: [], pinned, work: [work], sync: undefined };
  }
  const form = renderClearanceForm(state, generated, clearance, actions);
  return { rail: [], pinned, work: [form.node], sync: form.sync };
}

/** The answer form of a clean clearance: the node on screen, and how to write a later state into it. */
type ClearanceForm = { node: HTMLElement; sync: (state: AppState) => void };

/**
 * The form a clean clearance is answered in: the typing box where the student types it out, and the
 * CRAFT dropdowns otherwise, which have the student pick the procedure where the clearance names
 * none (`picksProcedure`).
 */
function renderClearanceForm(
  state: AppState,
  scenario: Scenario,
  clearance: ResolvedClearance,
  actions: Actions,
): ClearanceForm {
  if (state.input === 'text') {
    const typed = (next: AppState): TextFormProps => ({
      text: next.text,
      onText: actions.onText,
      onSubmit: actions.onSubmit,
      boxesOpen: false,
      onSkip: skipOf(next, actions),
    });
    const form = renderTextForm(typed(state));
    return { node: form.node, sync: (next) => form.sync(typed(next)) };
  }
  const picked = (next: AppState): CraftFormProps => ({
    scenario,
    airport: next.airport,
    clearance,
    picks: next.picks,
    procedure: clearanceProcedureRow(clearance),
    gradeRunway: next.gradeRunway,
    onPick: actions.onPick,
    onSubmit: actions.onSubmit,
    boxesOpen: false,
    onSkip: skipOf(next, actions),
  });
  const form = renderCraftForm(picked(state));
  return { node: form.node, sync: (next) => form.sync(picked(next)) };
}

/** The whole page: the node on screen, and how to write a later state of the same panels into it. */
type Page = { node: HTMLElement; sync: ((state: AppState) => void) | undefined };

/**
 * The strip bay: the panels that scroll away on a phone, then the pinned strip and the ATIS in
 * their own group, which a phone keeps in view under the toolbar. A view with nothing in the bay
 * (a scenario the engine could not clear) has no rail at all.
 */
function renderRail(panels: Panels): HTMLElement | undefined {
  if (panels.rail.length === 0 && panels.pinned.length === 0) return undefined;
  const rail = el('aside', 'rail');
  rail.setAttribute('aria-label', 'Flight plan and ATIS');
  const pin = el('div', 'rail-pin');
  pin.append(...panels.pinned);
  rail.append(...panels.rail, pin);
  return rail;
}

/**
 * Renders the whole page from the state: the toolbar over the strip bay (rail) and the work column.
 * The first strip on the page, the one the student was handed, carries the button that copies the
 * link to it, except in a test set and in the tutorial, whose strip has no link of its own.
 */
function renderApp(
  state: AppState,
  index: AirportsIndex,
  actions: Actions,
  solved: SolvedStore,
  tutorial: boolean,
): Page {
  const page = el('div', 'page');
  const panels = renderPanels(state, actions, solved, tutorial);
  const rail = renderRail(panels);
  const main = el('main', rail === undefined ? 'layout no-rail' : 'layout');
  const strip = [...panels.rail, ...panels.pinned].find((node) =>
    node.matches('section.panel.strip'),
  );
  if (strip !== undefined && state.set === undefined && !tutorial) {
    const { icao } = state.airport.airport;
    addCopyLink(strip, shareLink(globalThis.location.href, icao, state.seed, state));
  }
  const work = el('section', 'work');
  work.append(...panels.work);
  if (rail !== undefined) main.append(rail);
  main.append(work);
  page.append(renderToolbar(state, index, actions), main);
  return { node: page, sync: panels.sync };
}

/** How far the page must scroll in one direction before the phone toolbar hides or comes back. */
const TOOLBAR_SCROLL_THRESHOLD = 8;

/**
 * Whether the phone toolbar is hidden after a scroll: a scroll down hides it, a scroll up brings it
 * back, and the top of the page always shows it.
 *
 * @param previousY The scroll offset the toolbar was last decided at.
 * @param y The scroll offset now.
 * @param threshold How far the page must move from `previousY` before the toolbar changes.
 * @returns `true` to hide it, `false` to show it, or `undefined` where the page moved less than the
 *   threshold and the toolbar stays as it is.
 */
export function toolbarHiddenAfter(
  previousY: number,
  y: number,
  threshold: number,
): boolean | undefined {
  if (y <= threshold) return false;
  if (Math.abs(y - previousY) < threshold) return undefined;
  return y > previousY;
}

/**
 * Hides the phone toolbar while the page scrolls down and brings it back on a scroll up.
 *
 * The listener marks the document root with `toolbar-hidden`, which slides the toolbar up, and sets
 * `--pin-top` to `0px` so the pinned strip moves up into its place. The mark lives on the root rather
 * than on the toolbar because the toolbar is drawn again whenever the panels are. Wider than a phone
 * the toolbar never hides. The test bar of a running set stays in place, clock and all, so while it
 * is up the pinned strip keeps its place under it.
 */
function hideToolbarOnScroll(): void {
  if (typeof globalThis.matchMedia !== 'function') return;
  const docRoot = document.documentElement;
  const phone = globalThis.matchMedia(PHONE_QUERY);
  let lastY = globalThis.scrollY;
  let hidden = false;
  const apply = (next: boolean): void => {
    hidden = next;
    docRoot.classList.toggle('toolbar-hidden', next);
    const testBarUp = document.querySelector('.testbar') !== null;
    if (next && !testBarUp) docRoot.style.setProperty('--pin-top', '0px');
    else docRoot.style.removeProperty('--pin-top');
  };
  globalThis.addEventListener(
    'scroll',
    () => {
      const y = globalThis.scrollY;
      if (!phone.matches) {
        if (hidden) apply(false);
        lastY = y;
        return;
      }
      const next = toolbarHiddenAfter(lastY, y, TOOLBAR_SCROLL_THRESHOLD);
      if (next === undefined) return;
      lastY = y;
      if (next !== hidden) apply(next);
    },
    { passive: true },
  );
  phone.addEventListener('change', () => {
    if (!phone.matches && hidden) apply(false);
  });
}

/** The key of the control that has the focus, where it is one a page drawn again can find. */
function focusKeyOf(root: Element): string | undefined {
  const active = root.ownerDocument.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active)) return undefined;
  return active.getAttribute('data-focus-key') ?? undefined;
}

/** Puts the focus back on the control of a page drawn again that carries the key. */
function restoreFocus(root: Element, key: string | undefined): void {
  if (key === undefined) return;
  const controls = [...root.querySelectorAll<HTMLElement>('[data-focus-key]')];
  controls.find((node) => node.getAttribute('data-focus-key') === key)?.focus();
}

/** Everything `mount` remembers between renders that is not the state itself. */
type Stores = {
  solved: SolvedStore;
  filter: FilterStore;
  input: InputKindStore;
  fullRoute: FullRouteStore;
  runwayGrading: RunwayGradingStore;
  stage: StageStore;
  set: SetStore;
  home: HomeStore;
  tourSeen: TourSeenStore;
  tourProgress: TourProgressStore;
};

/** How often the test bar's clock is written again, in milliseconds. */
const CLOCK_TICK_MS = 1000;

/**
 * What keeps a test set going between renders, which follows the state after every change and stops
 * its clock when the page is left.
 */
type SetFollower = { follow: (state: AppState) => void; stop: () => void };

/**
 * Stores a test set whenever it moves, so a reload resumes it, and ticks its clock while it runs:
 * every second the clock writes the test bar's `.clock` text alone, outside the state and the
 * hash, so nothing is drawn again, and at a timed set's limit it ends the set, discarding an
 * answer not yet submitted. The interval runs only while a set runs, and stops when it ends or is
 * left.
 *
 * @param root The element the page is rendered into.
 * @param current Reads the state on screen.
 * @param store The store the set is written to.
 * @param update Puts a new state on screen, which ending the set at its time limit does.
 * @returns The follower, which stores the set and starts or stops the clock as the state asks.
 */
function setFollower(
  root: Element,
  current: () => AppState,
  store: SetStore,
  update: (next: AppState) => void,
): SetFollower {
  let saved: SetState | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const tick = (): void => {
    const set = current().set;
    if (set === undefined || set.ended) {
      stop();
      return;
    }
    const now = Date.now();
    if (isTimeUp(set, now)) {
      stop();
      update(endedAt(current(), set, now));
      return;
    }
    const node = root.querySelector('.testbar .clock');
    if (node !== null) node.textContent = clockReading(set, now).text;
  };
  return {
    follow: (state) => {
      const set = state.set;
      if (set !== undefined && set !== saved) store.save(set.seed, recordOf(state, set));
      saved = set;
      if (set === undefined || set.ended) stop();
      else timer ??= setInterval(tick, CLOCK_TICK_MS);
    },
    stop,
  };
}

/** The actions a test set adds to the page, and the submit that moves a set on. */
type SetActions = Pick<
  Actions,
  'onStartTest' | 'onSkip' | 'onGoToStrip' | 'onEndTest' | 'onSubmit'
>;

/** The state with its set ended, on the set's summary. */
function endedAt(state: AppState, set: SetState, now: number): AppState {
  return { ...state, set: endedSet(set, now) };
}

/**
 * What starting, skipping, going back to a strip, ending a set and submitting a strip do.
 *
 * A submitted strip of a set is saved in the ordinary solved store and the set moves on to its next
 * open strip at once, with no results between; outside a set, submit shows the results as always.
 * A submit that comes after the time limit is discarded and the summary opens. A new set runs under
 * the viewer's stage; where that has not opened the page's airport, it starts at one it has.
 *
 * @param context The page's stores, its state and how to change it.
 * @returns The handlers.
 */
function setActions(context: ActionContext): SetActions {
  const { stores, current, update } = context;
  const { solved } = stores;
  const withSet = (act: (state: AppState, set: SetState) => void) => (): void => {
    const state = current();
    if (state.set !== undefined) act(state, state.set);
  };
  return {
    onStartTest: (n, minutes) => {
      const state = current();
      const open = airportToLeaveFor(context.index, stores, state.airport);
      if (open === undefined) {
        update(startedSet(state, stores, n, minutes));
        return;
      }
      void cachedAirport(open).then((airport) => {
        update(startedSet(sessionAt(airport, current(), stores), stores, n, minutes));
      });
    },
    onSkip: withSet((state, set) => {
      update(onSetStrip(state, withStripSkipped(set, Date.now())));
    }),
    onGoToStrip: (index) => {
      withSet((state, set) => {
        update(onSetStrip(state, { ...set, index }));
      })();
    },
    onEndTest: withSet((state, set) => {
      if (globalThis.confirm(END_TEST_QUESTION)) update(endedAt(state, set, Date.now()));
    }),
    onSubmit: () => {
      const state = current();
      const set = state.set;
      if (set === undefined) {
        saveAttempt(state, solved);
        update(withSubmitted(state));
        return;
      }
      if (isTimeUp(set, Date.now())) {
        update(endedAt(state, set, Date.now()));
        return;
      }
      const submitted = withSubmitted(withBoxesIn(state));
      if (!submitted.submitted) return;
      const attempt = saveAttempt(submitted, solved);
      if (attempt === undefined) return;
      update(onSetStrip(state, withStripAnswered(set, Date.now(), attempt)));
    },
  };
}

/**
 * The boxes of a test set's amendment strip taken in with its clearance, since one Submit stands for
 * both; the student's own procedure pick stays as they made it. Boxes still open are not taken in,
 * so the submit that follows is refused.
 */
function withBoxesIn(state: AppState): AppState {
  if (state.mode !== 'amendment' || toBoxAnswers(state.boxes) === undefined) return state;
  return { ...state, boxesSubmitted: true };
}

/** The attempt the answers on screen make, or `undefined` while one is still incomplete. */
function attemptOf(state: AppState): Attempt | undefined {
  if (state.mode === 'amendment') {
    const boxes = toBoxAnswers(state.boxes);
    const answer = toAmendmentAnswer(state);
    return boxes === undefined || answer === undefined
      ? undefined
      : { kind: 'amendment', boxes, ...answer };
  }
  const answer = toClearanceAnswer(state);
  return answer === undefined ? undefined : { kind: 'clearance', ...answer };
}

/**
 * Remembers the attempt the student just submitted, so a revisit of the seed shows it back.
 *
 * An amendment attempt is the strip answers and the clearance that followed them; a form still
 * missing a pick, or a typing box holding nothing but whitespace, is not an attempt at all and is
 * not written.
 *
 * @returns The attempt, or `undefined` where there was none to write.
 */
function saveAttempt(state: AppState, store: SolvedStore): Attempt | undefined {
  const attempt = attemptOf(state);
  if (attempt !== undefined) {
    const { icao } = state.airport.airport;
    store.save(icao, state.seed, attempt, state.fullRoute, state.gradeRunway);
  }
  return attempt;
}

/** The panels on screen, and the view key they were built for. */
type Built = { key: string; sync: ((state: AppState) => void) | undefined };

/**
 * Puts a state on screen: the page built again where the view key changed, with the focus kept on
 * the control that had it, and the state written into the controls already there otherwise.
 *
 * @param root The element the page is rendered into.
 * @param built The panels on screen, or `undefined` before the first render.
 * @param state The state to show.
 * @param build Builds the whole page for the state.
 * @returns The panels now on screen.
 */
function show(root: Element, built: Built | undefined, state: AppState, build: () => Page): Built {
  const key = viewKey(state);
  if (built?.key === key) {
    built.sync?.(state);
    return built;
  }
  const focused = focusKeyOf(root);
  const page = build();
  root.replaceChildren(page.node);
  restoreFocus(root, focused);
  return { key, sync: page.sync };
}

/** A tutorial part on screen: which part, its steps, and the index of the step the tour opens on. */
type TutorialRun = { part: TutorialPart; steps: readonly TourStep[]; from: number };

/** What `mount` runs: a tutorial part, or `undefined` for the trainer itself. */
type MountOptions = { tutorial: TutorialRun | undefined };

/** The options of every page but the tutorial's. */
const TRAINER: MountOptions = { tutorial: undefined };

/**
 * What the page tells the tour of a tutorial part: the start, each redraw, each pick, box answer and
 * submit the student makes, and the page being left.
 */
type TourLink = {
  start: (actions: Actions) => void;
  refresh: () => void;
  picked: (key: PickKey, raw: string) => void;
  boxed: (box: Box, answer: BoxAnswer) => void;
  submitted: () => void;
  stop: () => void;
};

/** How the tour's card writes a box left as filed. */
const AS_FILED_LABEL = 'correct as filed';

/** How the tour's card writes the choice to amend a box. */
const AMEND_TO_LABEL = 'amend to';

/** The boxes of the amend form, whose text boxes a typed answer is committed in. */
const BOXES: readonly Box[] = ['type', 'altitude', 'route'];

/** The label of one choice of a dropdown the tour points at, or the value where it offers none. */
function choiceLabel(root: Element, key: PickKey, value: string): string {
  const node = root.querySelector(`[data-tour="${key}"]`);
  const select = node instanceof HTMLSelectElement ? node : node?.querySelector('select');
  const option = [...(select?.options ?? [])].find((candidate) => candidate.value === value);
  return option?.textContent ?? value;
}

/**
 * What the tour's card shows for a pick, set against the step: `null` where the step expects no
 * pick of this dropdown or the pick is the one it expects.
 */
function wrongPick(
  root: Element,
  step: TourStep | undefined,
  key: PickKey,
  raw: string,
): WrongPick | null {
  const advance = step?.advance;
  if (typeof advance !== 'object' || !('pick' in advance) || advance.pick !== key) return null;
  if (advance.value === raw) return null;
  const expected = choiceLabel(root, key, advance.value);
  return { said: choiceLabel(root, key, raw), expected, citations: [] };
}

/** A box answer as the tour's card writes it: "correct as filed", or the value typed. */
function boxAnswerLabel(answer: BoxAnswer): string {
  return answer.kind === 'as_filed' ? AS_FILED_LABEL : answer.value;
}

/**
 * What the tour's card shows for a box answer, set against the step: `null` where the step expects
 * no answer to this box or the answer is the one it expects.
 */
function wrongBox(step: TourStep | undefined, box: Box, answer: BoxAnswer): WrongPick | null {
  const advance = step?.advance;
  if (typeof advance !== 'object' || !('box' in advance) || advance.box !== box) return null;
  const expected = advance.answer;
  const same =
    answer.kind === 'as_filed' || expected.kind === 'as_filed'
      ? answer.kind === expected.kind
      : answer.value === expected.value;
  if (same) return null;
  return { said: boxAnswerLabel(answer), expected: boxAnswerLabel(expected), citations: [] };
}

/**
 * What the tour's card shows for the choice to amend a box: wrong at once where the step keeps the
 * box as filed, and `null` otherwise, since an amendment is judged only once its value is committed.
 */
function wrongAmend(step: TourStep | undefined, box: Box): WrongPick | null {
  const advance = step?.advance;
  if (typeof advance !== 'object' || !('box' in advance) || advance.box !== box) return null;
  if (advance.answer.kind !== 'as_filed') return null;
  return { said: AMEND_TO_LABEL, expected: AS_FILED_LABEL, citations: [] };
}

/** The box a text box of the amend form writes in, and what it holds, or `undefined` for any other. */
function typedBox(target: EventTarget | null): { box: Box; value: string } | undefined {
  if (!(target instanceof HTMLInputElement)) return undefined;
  const box = BOXES.find((candidate) => boxInputName(candidate) === target.name);
  return box === undefined ? undefined : { box, value: target.value };
}

/** The box whose answer dropdown was just set to amend it, or `undefined` for any other control. */
function amendChosen(target: EventTarget | null): Box | undefined {
  if (!(target instanceof HTMLSelectElement) || target.value !== 'amended') return undefined;
  return BOXES.find((box) => target.closest(`[data-tour="box-${box}"]`) !== null);
}

/**
 * Makes the answer a step already done expects through the action its control calls, so a part
 * resumed after it holds that answer.
 */
function replayStep(step: TourStep, actions: Actions): void {
  const advance = step.advance;
  if (advance === 'next') return;
  if (advance === 'submit') {
    if (step.anchor === 'boxes-submit') actions.onBoxesSubmit();
    else actions.onSubmit();
    return;
  }
  if ('pick' in advance) actions.onPick(advance.pick, advance.value);
  else actions.onBox(advance.box, advance.answer);
}

/** Whether the home tour waits for home's next render, which the Amend part moving on to it sets. */
let homeTourPending = false;

/**
 * Ends a tutorial part: its progress is forgotten, and its page is put out of reach while the next
 * page loads. Moving on from the clearance part opens the Amend part; anything else marks the tour
 * seen and opens home, with home's tour waiting for it where the Amend part moved on.
 */
function endTutorial(root: Element, part: TutorialPart, how: TourEnd, stores: Stores): void {
  stores.tourProgress.clear();
  root.setAttribute('inert', '');
  if (how === 'continue' && part === 'clearance') {
    globalThis.location.hash = hrefOf({ kind: 'tutorial', part: 'amend' });
    return;
  }
  stores.tourSeen.save(true);
  homeTourPending = how === 'continue';
  globalThis.location.hash = hrefOf({ kind: 'home' });
}

/**
 * The link to the tour of a tutorial part.
 *
 * Starting it replays the expected answer of every step before the one it opens on, then opens the
 * tour, storing each step it reaches. A box left as filed is reported at once, and so is the choice
 * to amend a box the step keeps as filed; a value typed in a box only once it is committed, by the
 * box's `change` or Enter, never per keystroke. Stopping it gives the page back its pointer.
 *
 * @param root The element the page is rendered into.
 * @param run The part, its steps, and the step it opens on.
 * @param stores What this browser remembers, where the progress and the "tour seen" mark go.
 * @returns The link the page reports to.
 */
function tourLink(root: Element, run: TutorialRun, stores: Stores): TourLink {
  let driver: TourDriver | undefined;
  let at = run.from;
  const boxed = (box: Box, answer: BoxAnswer): void => {
    driver?.boxed(box, answer, wrongBox(run.steps[at], box, answer));
  };
  const onCommit = (event: Event): void => {
    if (event instanceof KeyboardEvent && event.key !== 'Enter') return;
    const typed = typedBox(event.target);
    if (typed !== undefined) boxed(typed.box, { kind: 'amended', value: typed.value });
  };
  const onAmend = (event: Event): void => {
    const box = amendChosen(event.target);
    const wrong = box === undefined ? null : wrongAmend(run.steps[at], box);
    if (box !== undefined && wrong !== null)
      driver?.boxed(box, { kind: 'amended', value: '' }, wrong);
  };
  return {
    start: (actions) => {
      for (const done of run.steps.slice(0, run.from)) replayStep(done, actions);
      root.addEventListener('change', onAmend, { capture: true });
      root.addEventListener('change', onCommit);
      root.addEventListener('keydown', onCommit);
      driver = startTour({
        steps: run.steps,
        from: run.from,
        onStep: (index) => {
          at = index;
          stores.tourProgress.save({ version: TOUR_STEPS_VERSION, part: run.part, step: index });
        },
        onEnd: (how) => {
          endTutorial(root, run.part, how, stores);
        },
      });
    },
    refresh: () => driver?.refresh(),
    picked: (key, raw) => driver?.picked(key, raw, wrongPick(root, run.steps[at], key, raw)),
    boxed: (box, answer) => {
      if (answer.kind === 'as_filed') boxed(box, answer);
    },
    submitted: () => driver?.submitted(),
    stop: () => {
      root.removeEventListener('change', onAmend, { capture: true });
      root.removeEventListener('change', onCommit);
      root.removeEventListener('keydown', onCommit);
      root.removeAttribute('inert');
      driver?.stop();
    },
  };
}

/** What the page's actions work on: its root, the stores, the state on screen and how to change it. */
type ActionContext = {
  root: Element;
  index: AirportsIndex;
  stores: Stores;
  current: () => AppState;
  update: (next: AppState) => void;
};

/** The way of answering a choice of the toolbar's answer switch stands for. */
function inputKindOf(answer: AnswerChoice): InputKind {
  return answer === 'pick' ? 'dropdowns' : 'text';
}

/** The scenario on screen answered another way, on the same seed, with the attempt held for it. */
function answeredAs(state: AppState, answer: AnswerChoice, solved: SolvedStore): AppState {
  const input = inputKindOf(answer);
  const fullRoute = answer === 'full';
  const scope = { mode: state.mode, input, fullRoute, gradeRunway: state.gradeRunway };
  const previous = solved.load(state.airport.airport.icao, state.seed, scope);
  return input === 'text'
    ? withFullRoute(state, fullRoute, previous)
    : withInputKind(state, input, previous);
}

/** The scenario on screen with the runway graded or not, with the attempt held for that choice. */
function gradedAs(state: AppState, gradeRunway: boolean, solved: SolvedStore): AppState {
  const { mode, input, fullRoute } = state;
  const scope = { mode, input, fullRoute, gradeRunway };
  const previous = solved.load(state.airport.airport.icao, state.seed, scope);
  return withRunwayGrading(state, gradeRunway, previous);
}

/** Settings narrowed to the training stage this browser remembers, for a draw under it. */
function clampedToViewer<Settings extends StagedSettings>(
  settings: Settings,
  airport: AirportData,
  stores: Stores,
): Settings {
  return clampSettings(settings, airport, stores.stage.load());
}

/**
 * The airport a new draw has to move to, because the viewer's stage has not opened the page's.
 *
 * @param index The airports the trainer lists.
 * @param stores What this browser remembers, the viewer's stage among it.
 * @param page The data of the airport the draw would run at.
 * @returns The first open airport, or `undefined` when the draw stays, as it does at an open airport
 *   and where the stage opens none.
 */
function airportToLeaveFor(
  index: AirportsIndex,
  stores: Stores,
  page: AirportData,
): string | undefined {
  const { training, airport } = page;
  const stage = stores.stage.load();
  if (isOpenAt(training, airportLock(training, airport.icao), stage)) return undefined;
  return firstOpenAirport(index, training, stage);
}

/**
 * A session at another airport on the same seed, under the viewer's stage, with the configuration
 * filter dropped: a configuration belongs to one airport, and a forced destination to its routes.
 *
 * @param airport The airport to move to.
 * @param state The state on screen.
 * @param stores What this browser remembers.
 * @returns The session.
 */
function sessionAt(airport: AirportData, state: AppState, stores: Stores): AppState {
  const filter: ScenarioFilter = { time: state.filter.time, config: { kind: 'any' } };
  const carried = { ...sessionSettings(state), filter };
  const settings = clampedToViewer(carried, airport, stores);
  const { mode, input, fullRoute, gradeRunway } = settings;
  const scope = { mode, input, fullRoute, gradeRunway };
  const previous = stores.solved.load(airport.airport.icao, state.seed, scope);
  return newSession(airport, state.seed, previous, settings);
}

/** Moves the page to another airport, on a strip drawn under the viewer's stage. */
function switchAirport(context: ActionContext, icao: string): void {
  const { stores, current, update } = context;
  void cachedAirport(icao).then((airport) => {
    const session = sessionAt(airport, current(), stores);
    rememberPractice(stores, icao, session.mode, airport.training);
    update(session);
  });
}

/** A new test set from the session given, under the viewer's stage, remembered for home. */
function startedSet(state: AppState, stores: Stores, n: number, minutes: number): AppState {
  const { airport, training } = state.airport;
  const clamped = clampedToViewer(state, state.airport, stores);
  const params = { seed: newSetSeed(randomSeed), n, minutes, index: 0 };
  const focus = homeFocusOf(stores, airport.icao, clamped.mode, training);
  stores.home.save({ ...focus, format: 'test', n, minutes });
  return openedSet(clamped, params, undefined, Date.now());
}

/**
 * Remembers a filter change. Under a stage only the member the student changed moves, because what
 * is on screen may be clamped; at All topics on an unstaged page the whole filter is the choice.
 */
function saveFilter(stores: Stores, state: AppState, filter: ScenarioFilter): void {
  const { icao } = state.airport.airport;
  const staged = stores.stage.load() !== undefined || state.filter.stage !== undefined;
  const stored = stores.filter.load(icao);
  stores.filter.save(icao, staged ? rememberedFilter(stored, state.filter, filter) : filter);
}

/** The settings of the state on screen, without what belongs to the strip on it. */
function sessionSettings(state: AppState): Omit<SessionSettings, 'set'> {
  const { filter, mode, input, fullRoute, gradeRunway } = state;
  return { filter, mode, input, fullRoute, gradeRunway };
}

/** Draws a new strip under the viewer's stage, moving first to an airport the stage has opened. */
function drawNewStrip(context: ActionContext): void {
  const { stores, current, update } = context;
  const state = current();
  const open = airportToLeaveFor(context.index, stores, state.airport);
  if (open !== undefined) {
    switchAirport(context, open);
    return;
  }
  const seed = randomSeed();
  const clamped = clampedToViewer(state, state.airport, stores);
  const { mode, input, fullRoute, gradeRunway } = clamped;
  const scope = { mode, input, fullRoute, gradeRunway };
  const previous = stores.solved.load(state.airport.airport.icao, seed, scope);
  update(newSession(state.airport, seed, previous, clamped));
}

/**
 * What the trainer's controls do: each makes the next state from the one on screen and puts it up,
 * remembering for home and for later visits what the student chose. A control that draws a new strip
 * draws under the viewer's training stage.
 */
function trainerActions(context: ActionContext): Actions {
  const { root, stores, current, update } = context;
  const solved = stores.solved;
  return {
    onAirport: (icao) => {
      switchAirport(context, icao);
    },
    onBox: (box, answer) => {
      update(withBox(current(), box, answer));
    },
    onBoxesSubmit: () => {
      const state = current();
      if (state.view.kind !== 'amendment') return;
      const answers = toBoxAnswers(state.boxes);
      if (answers === undefined) return;
      const { plan } = clearedPlan(state.view, answers, state.airport);
      update(withBoxesSubmitted(state, procedureOf(plan, state.airport)));
    },
    onFilter: ({ time, config }) => {
      const state = current();
      const { icao } = state.airport.airport;
      const filter: ScenarioFilter = { time, config };
      saveFilter(stores, state, filter);
      const seed = randomSeed();
      const clamped = clampedToViewer({ ...state, filter }, state.airport, stores);
      const { mode, input, fullRoute, gradeRunway } = clamped;
      const previous = solved.load(icao, seed, { mode, input, fullRoute, gradeRunway });
      update(withFilter(clamped, clamped.filter, seed, previous));
      const popover = root.querySelector('details.filters');
      if (popover instanceof HTMLDetailsElement) popover.open = true;
    },
    onAnswer: (answer) => {
      stores.input.save(inputKindOf(answer));
      stores.fullRoute.save(answer === 'full');
      update(answeredAs(current(), answer, solved));
    },
    onRunwayGrading: (graded) => {
      stores.runwayGrading.save(graded);
      update(gradedAs(current(), graded, solved));
      const popover = root.querySelector('details.filters');
      if (popover instanceof HTMLDetailsElement) popover.open = true;
    },
    onMode: (picked) => {
      const state = current();
      const seed = randomSeed();
      const clamped = clampedToViewer({ ...state, mode: picked }, state.airport, stores);
      const { mode, input, fullRoute, gradeRunway } = clamped;
      const scope = { mode, input, fullRoute, gradeRunway };
      const previous = solved.load(state.airport.airport.icao, seed, scope);
      rememberPractice(stores, state.airport.airport.icao, mode, state.airport.training);
      update(withMode(clamped, mode, seed, previous));
    },
    onNewScenario: () => {
      drawNewStrip(context);
    },
    onPick: (key, raw) => {
      update(withPick(current(), key, raw));
    },
    onRetry: () => {
      update(withRetry(current()));
    },
    onText: (text) => {
      update(withText(current(), text));
    },
    ...setActions(context),
  };
}

/**
 * The trainer's actions as a tutorial part runs them: each pick, box answer and submit that happened
 * is told to the part's tour, a submit is graded without being saved, the way of answering is not
 * remembered, and no Runway control is offered.
 */
function withTutorial(trainer: Actions, context: ActionContext, tour: TourLink): Actions {
  const { stores, current, update } = context;
  return {
    ...trainer,
    onAnswer: (answer) => {
      update(answeredAs(current(), answer, stores.solved));
    },
    onRunwayGrading: undefined,
    onBox: (box, answer) => {
      trainer.onBox(box, answer);
      tour.boxed(box, answer);
    },
    onBoxesSubmit: () => {
      const before = current().boxesSubmitted;
      trainer.onBoxesSubmit();
      if (!before && current().boxesSubmitted) tour.submitted();
    },
    onPick: (key, raw) => {
      trainer.onPick(key, raw);
      tour.picked(key, raw);
    },
    onSubmit: () => {
      const state = current();
      update(withSubmitted(state));
      if (!state.submitted && current().submitted) tour.submitted();
    },
  };
}

/**
 * Holds the state, rewrites the hash, and puts every change on screen.
 *
 * The panels are built again only when the view key changes, which is when a different set of them
 * belongs on screen; every other change is written into the controls already there. A pick or a
 * keystroke therefore leaves the control it came from in place, with its focus and its caret. A
 * test set is stored whenever it moves, so a reload resumes it, and its clock follows every change.
 * Once the page is disposed its clock stops and nothing it still has under way reaches the screen.
 *
 * A tutorial part writes no hash, so the address bar keeps its `#/tutorial` link, saves no attempt,
 * offers no copy link and no way on from its results, and leaves the remembered way of answering
 * alone; its tour starts after the first render, hears every pick, box answer and submit, and comes
 * off the page with it.
 */
function mount(
  root: Element,
  index: AirportsIndex,
  initial: AppState,
  stores: Stores,
  options: MountOptions,
): Mounted {
  const run = options.tutorial;
  const tour = run === undefined ? undefined : tourLink(root, run, stores);
  let state = initial;
  let actions: Actions;
  let built: Built | undefined;
  let disposed = false;

  const follower = setFollower(
    root,
    () => state,
    stores.set,
    (next) => {
      update(next);
    },
  );
  const update = (next: AppState): void => {
    if (disposed) return;
    state = next;
    if (tour === undefined) writeHash(state.airport.airport.icao, state.seed, state);
    const tutorial = tour !== undefined;
    built = show(root, built, state, () =>
      renderApp(state, index, actions, stores.solved, tutorial),
    );
    follower.follow(state);
    tour?.refresh();
  };
  const context: ActionContext = { root, index, stores, current: () => state, update };
  const trainer = trainerActions(context);
  actions = tour === undefined ? trainer : withTutorial(trainer, context, tour);

  update(state);
  tour?.start(actions);
  return {
    dispose: () => {
      disposed = true;
      follower.stop();
      tour?.stop();
    },
  };
}

/** A page on screen, and how to tear it down before another takes its root. */
type Mounted = { dispose: () => void };

/** The teardown of a page that leaves nothing running: home, and the root before its first page. */
const NOTHING_TO_DISPOSE = (): void => {
  // Nothing of the page outlives its nodes.
};

/** Whether the scroll listener of the phone toolbar is installed, which `startApp` does once. */
let toolbarListening = false;

/**
 * Whether a session opens held to the route read to its end.
 *
 * A link that asks for a full route clearance opens on one; a link that names typed answers without
 * asking for one opens on the reading spoken on frequency, so a shared link reads the same to
 * whoever opens it; a link that names no input kind at all follows what this browser last chose.
 * The dropdowns cannot be held to the full route, so they never open on one.
 *
 * @param hash The hash the page opened on, with or without its leading `#`.
 * @param input The input kind the session opens in.
 * @param remembered What this browser last chose, or `undefined` where it remembers nothing.
 * @returns True when the session opens on Full route.
 */
function opensFullRoute(hash: string, input: InputKind, remembered: boolean | undefined): boolean {
  if (input !== 'text') return false;
  if (fullRouteFromHash(hash)) return true;
  return inputKindFromHash(hash) === undefined && (remembered ?? false);
}

/**
 * The settings a session opens under, from the settings a link carries and what this browser last
 * chose where the link names none.
 *
 * @param hash The hash or route query the page opened on, with or without its leading `#`.
 * @param icao The airport the session opens at, whose remembered filter applies.
 * @param stores What this browser remembers.
 * @returns The filter, the mode, the input kind, whether Full route holds, and whether the runway is
 *   graded, which the link alone decides: home writes `rwy=off` into its links when this browser
 *   chose not to grade it.
 */
function settingsFrom(
  hash: string,
  icao: string,
  stores: Stores,
): Omit<SessionSettings, 'set'> & { mode: Mode } {
  const mode = modeFromHash(hash);
  const filter = hasFilterParams(hash)
    ? filterFromHash(hash)
    : (stores.filter.load(icao) ?? ANY_SCENARIO);
  const input = inputKindFromHash(hash) ?? stores.input.load() ?? 'dropdowns';
  const fullRoute = opensFullRoute(hash, input, stores.fullRoute.load());
  return { filter, mode, input, fullRoute, gradeRunway: runwayGradingFromHash(hash) };
}

/** Whether the page listens for hash changes, which `startApp` installs once. */
let routeListening = false;

/**
 * The page `startApp` runs: its root, the airports index, what this browser remembers, the teardown
 * of the page on screen, and the number of the newest route opened into it.
 */
type Active = {
  root: Element;
  index: AirportsIndex;
  stores: Stores;
  dispose: () => void;
  generation: number;
};

/** The page the hash listener opens routes into, once `startApp` has run. */
let active: Active | undefined;

/** A route on its way to the screen: the page it opens into, and the number it was opened as. */
type Opening = { target: Active; generation: number };

/** Whether no newer route, and no newer `startApp`, has started since this one. */
function isCurrent(opening: Opening): boolean {
  return active === opening.target && opening.target.generation === opening.generation;
}

/** Hands the root to a new page: the page on screen is torn down first, then the new one drawn. */
function takeOver(opening: Opening, draw: () => Mounted): void {
  opening.target.dispose();
  opening.target.dispose = NOTHING_TO_DISPOSE;
  opening.target.dispose = draw().dispose;
}

/**
 * The first airport of the index, which a link that names none opens.
 *
 * @throws Error When the index lists no airports.
 */
function firstAirport(index: AirportsIndex): AirportsIndex[number] {
  const first = index[0];
  if (first === undefined) throw new Error('airports.json lists no airports');
  return first;
}

/** Whether the index lists an airport. */
function lists(index: AirportsIndex, icao: string): boolean {
  return index.some((entry) => entry.icao === icao);
}

/**
 * The airport and mode home keeps for a session: the session's own where the viewer's stage has
 * opened both it and the remembered value, else the remembered one. A locked remembered value comes
 * back at a later stage or All topics, and a link opened as written never replaces it.
 */
function homeFocusOf(
  stores: Stores,
  icao: string,
  mode: Mode,
  training: Training,
): Pick<HomeChoices, 'icao' | 'mode'> {
  const stage = stores.stage.load();
  const stored = stores.home.load();
  if (stored === undefined) return { icao, mode };
  const airportOpen = (candidate: string): boolean =>
    isOpenAt(training, airportLock(training, candidate), stage);
  return {
    icao: airportOpen(stored.icao) && airportOpen(icao) ? icao : stored.icao,
    mode: isOpenAt(training, training.course.amendment, stage) ? mode : stored.mode,
  };
}

/** Remembers a practice session for home, keeping the test size and time home last had. */
function rememberPractice(stores: Stores, icao: string, mode: Mode, training: Training): void {
  const remembered = stores.home.load();
  const n = remembered?.n ?? DEFAULT_SET_SIZE;
  const minutes = remembered?.minutes ?? DEFAULT_SET_MINUTES;
  const focus = homeFocusOf(stores, icao, mode, training);
  stores.home.save({ ...focus, format: 'practice', n, minutes });
}

/**
 * Opens a `#s=…` strip link as the trainer always has: the airport it names, or the first; its seed,
 * or a fresh one; its settings, or what this browser last chose; and its test set where it names one.
 */
async function openStrip(opening: Opening, hash: string): Promise<void> {
  const { root, index, stores } = opening.target;
  const named = airportFromHash(hash);
  const entry = index.find((candidate) => candidate.icao === named) ?? firstAirport(index);
  const airport = await cachedAirport(entry.icao);
  if (!isCurrent(opening)) return;
  const seed = seedFromHash(hash) ?? randomSeed();
  const settings = settingsFrom(hash, entry.icao, stores);
  const { mode, input, fullRoute, gradeRunway } = settings;
  const previous = stores.solved.load(entry.icao, seed, { mode, input, fullRoute, gradeRunway });
  const session = newSession(airport, seed, previous, settings);
  const set = setFromHash(hash);
  const initial =
    set === undefined ? session : openedSet(session, set, stores.set.load(set.seed), Date.now());
  takeOver(opening, () => mount(root, index, initial, stores, TRAINER));
}

/** A route that opens a fresh strip at an airport: practice, or a new test. */
type FreshRoute = Extract<Route, { kind: 'practice' | 'newTest' }>;

/**
 * A fresh session at a route's airport, under the route's mode and the settings its query carries.
 * A query that names a stage opens as written, airport included; any other draws under the viewer's
 * stage, at the first open airport where that has not opened the route's, and any configuration or
 * destination the query names for the route's airport stays behind.
 */
async function routeSession(opening: Opening, route: FreshRoute): Promise<AppState> {
  const { index, stores } = opening.target;
  const named = await cachedAirport(route.icao);
  const namesStage = filterFromHash(route.query).stage !== undefined;
  const open = namesStage ? undefined : airportToLeaveFor(index, stores, named);
  const airport = open === undefined ? named : await cachedAirport(open);
  const from = settingsFrom(route.query, airport.airport.icao, stores);
  const moved = open !== undefined && hasFilterParams(route.query);
  const filter: ScenarioFilter = moved
    ? { time: from.filter.time, config: { kind: 'any' } }
    : from.filter;
  const carried = { ...from, filter, mode: route.mode };
  const settings = namesStage ? carried : clampedToViewer(carried, airport, stores);
  return newSession(airport, randomSeed(), undefined, settings);
}

/** Opens home in place of a link that names nothing this browser can open, with `#/` written over it. */
async function openHomeInstead(opening: Opening): Promise<void> {
  replaceHash('#/');
  return openHome(opening);
}

/** Opens a practice link on a fresh strip and remembers its airport and mode for home. */
async function openPractice(
  opening: Opening,
  route: Extract<Route, { kind: 'practice' }>,
): Promise<void> {
  const { root, index, stores } = opening.target;
  if (!lists(index, route.icao)) return openHomeInstead(opening);
  const session = await routeSession(opening, route);
  if (!isCurrent(opening)) return;
  const { airport, training } = session.airport;
  rememberPractice(stores, airport.icao, session.mode, training);
  takeOver(opening, () => mount(root, index, session, stores, TRAINER));
}

/** The airport the tutorial runs at. */
const TUTORIAL_AIRPORT = 'KOAK';

/** What one tutorial part runs on: the worksheet whose plan it shows, the trainer's half, its steps. */
type TutorialSpec = { fixture: unknown; mode: Mode; steps: readonly TourStep[] };

/** Each tutorial part's worksheet, mode and steps. */
const TUTORIAL_PARTS: Readonly<Record<TutorialPart, TutorialSpec>> = {
  clearance: { fixture: swa1740, mode: 'clearance', steps: CLEARANCE_TOUR },
  amend: { fixture: jsx201, mode: 'amendment', steps: AMEND_TOUR },
};

/**
 * The step a tutorial part opens on: the stored one, kept within the part, where it was stored for
 * this part under the current step lists; the first step otherwise.
 */
function tutorialFrom(
  progress: TourProgress | undefined,
  part: TutorialPart,
  steps: number,
): number {
  if (progress?.part !== part || progress.version !== TOUR_STEPS_VERSION) return 0;
  return Math.min(progress.step, steps - 1);
}

/**
 * Opens a tutorial part on its worksheet's plan at KOAK, answered from the dropdowns, resumed on the
 * step this browser stored for it. The runway is graded whatever this browser chose, since the tour
 * has a step on the runway row.
 */
async function openTutorial(
  opening: Opening,
  route: Extract<Route, { kind: 'tutorial' }>,
): Promise<void> {
  const { root, index, stores } = opening.target;
  const airport = await cachedAirport(TUTORIAL_AIRPORT);
  if (!isCurrent(opening)) return;
  const { fixture, mode, steps } = TUTORIAL_PARTS[route.part];
  const { scenario } = withCurrentVersions(FixtureSchema.parse(fixture), airport);
  const settings: SessionSettings = {
    filter: ANY_SCENARIO,
    mode,
    input: 'dropdowns',
    fullRoute: false,
    gradeRunway: true,
  };
  const session = newSessionFrom(airport, scenario, settings);
  const from = tutorialFrom(stores.tourProgress.load(), route.part, steps.length);
  const tutorial = { part: route.part, steps, from };
  takeOver(opening, () => mount(root, index, session, stores, { tutorial }));
}

/** Starts the new test a link asks for and remembers it for home. */
async function openNewTest(
  opening: Opening,
  route: Extract<Route, { kind: 'newTest' }>,
): Promise<void> {
  const { root, index, stores } = opening.target;
  if (!lists(index, route.icao)) return openHomeInstead(opening);
  const session = await routeSession(opening, route);
  if (!isCurrent(opening)) return;
  const { n, minutes } = route;
  const params = { seed: newSetSeed(randomSeed), n, minutes, index: 0 };
  const { airport, training } = session.airport;
  const focus = homeFocusOf(stores, airport.icao, session.mode, training);
  stores.home.save({ ...focus, format: 'test', n, minutes });
  const initial = openedSet(session, params, undefined, Date.now());
  takeOver(opening, () => mount(root, index, initial, stores, TRAINER));
}

/**
 * Continues the set a link names, under the airport and settings this browser stored for it, which
 * win over the link's own; a set this browser does not hold opens home.
 */
async function openContinueTest(
  opening: Opening,
  route: Extract<Route, { kind: 'continueTest' }>,
): Promise<void> {
  const { root, index, stores } = opening.target;
  const record = stores.set.load(route.setSeed);
  if (record === undefined || !lists(index, record.icao)) return openHomeInstead(opening);
  const airport = await cachedAirport(record.icao);
  if (!isCurrent(opening)) return;
  const { filter, mode, input, fullRoute, gradeRunway } = record;
  const settings = { filter, mode, input, fullRoute, gradeRunway };
  const session = newSession(airport, randomSeed(), undefined, settings);
  const params = { seed: route.setSeed, n: record.n, minutes: record.minutes, index: 0 };
  const initial = openedSet(session, params, record, Date.now());
  takeOver(opening, () => mount(root, index, initial, stores, TRAINER));
}

/**
 * The score line home shows for a finished set, or `undefined` where its airport is not loaded.
 *
 * @param listing The set and its stored record.
 * @param airports The loaded airports, by ICAO code.
 * @param solved The store the set's answers were saved in.
 * @returns The line, e.g. `3 of 10 strips fully correct · 72%`.
 */
function scoreOf(
  listing: SetListing,
  airports: ReadonlyMap<string, AirportData>,
  solved: SolvedStore,
): string | undefined {
  const { icao, mode, input, fullRoute, gradeRunway } = listing.record;
  const airport = airports.get(icao);
  if (airport === undefined) return undefined;
  const load = (seed: number): Attempt | undefined =>
    solved.load(icao, seed, { mode, input, fullRoute, gradeRunway });
  return storedSetScore(airport, listing, load);
}

/**
 * The choices home opens on: the ones this browser remembers, or practice in clearance mode at the
 * first airport where it remembers none or remembers an airport the index no longer lists.
 */
function homeChoicesOf(home: HomeStore, index: AirportsIndex): HomeChoices {
  const remembered = home.load();
  if (remembered !== undefined && lists(index, remembered.icao)) return remembered;
  const { icao } = firstAirport(index);
  const minutes = DEFAULT_SET_MINUTES;
  return { icao, mode: 'clearance', format: 'practice', n: DEFAULT_SET_SIZE, minutes };
}

/** The way this browser last chose to answer, as home's switch shows it. */
function rememberedAnswer(stores: Stores): AnswerChoice {
  if (stores.input.load() !== 'text') return 'pick';
  return stores.fullRoute.load() === true ? 'full' : 'type';
}

/** Copies a link home shows; a refusal is logged, since home shows the link to copy by hand anyway. */
async function copyLink(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error: unknown) {
    console.warn('The clipboard refused the link; home shows it to copy by hand.', error);
  }
}

/** Puts a home page on screen, keeping the focus and an open Filters as they were. */
function redrawHome(root: Element, page: HTMLElement): void {
  const focused = focusKeyOf(root);
  const moreOpen = root.querySelector<HTMLDetailsElement>('details.home-more')?.open === true;
  root.replaceChildren(page);
  const more = root.querySelector<HTMLDetailsElement>('details.home-more');
  if (moreOpen && more !== null) more.open = true;
  restoreFocus(root, focused);
}

/** The airports, tests and links home lists, which no choice on home changes. */
type HomeListing = Pick<
  HomeProps,
  'airports' | 'tests' | 'resume' | 'offerTour' | 'onDismissTour' | 'linkBase' | 'copy'
>;

/**
 * What home lists: the airports in index order, the remembered sets, whether the tour is offered,
 * and the base of its links.
 */
function homeListing(airports: readonly AirportData[], stores: Stores): HomeListing {
  const byIcao = new Map(airports.map((data) => [data.airport.icao, data]));
  const listings = stores.set.list();
  const now = Date.now();
  const tests = homeTestRows(listings, now, (listing) => scoreOf(listing, byIcao, stores.solved));
  const { origin, pathname, search } = globalThis.location;
  return {
    airports: airports.map((data) => ({ icao: data.airport.icao, spoken: data.airport.spoken })),
    tests,
    resume: continueTestRow(listings, now),
    offerTour: stores.tourSeen.load() !== true,
    onDismissTour: () => {
      stores.tourSeen.save(true);
    },
    linkBase: origin + pathname + search,
    copy: (text) => {
      void copyLink(text);
    },
  };
}

/**
 * Puts home on screen and draws it again after every choice, each remembered as it is made: the
 * airport, mode and format for home itself, the answer and the filter as the trainer remembers them.
 *
 * @param root The element the page is rendered into.
 * @param airports Every airport of the index, loaded, in index order.
 * @param stores What this browser remembers.
 * @param initial The choices home opens on.
 * @returns Home's teardown, which takes home's tour off the page where one runs.
 */
function mountHome(
  root: Element,
  airports: readonly AirportData[],
  stores: Stores,
  initial: HomeChoices,
): Mounted {
  let tour: TourDriver | undefined;
  let choices = initial;
  let answer = rememberedAnswer(stores);
  let filter = stores.filter.load(choices.icao) ?? ANY_SCENARIO;
  let gradeRunway = stores.runwayGrading.load() ?? true;
  const draw = (): void => {
    const airport = airports.find((data) => data.airport.icao === choices.icao);
    if (airport === undefined) throw new Error(`home has no data loaded for ${choices.icao}`);
    const page = renderHome({
      ...homeListing(airports, stores),
      airport,
      choices,
      answer,
      filter,
      gradeRunway,
      onChoices: (next) => {
        stores.home.save(next);
        if (next.icao !== choices.icao) filter = stores.filter.load(next.icao) ?? ANY_SCENARIO;
        choices = next;
        draw();
      },
      onAnswer: (next) => {
        stores.input.save(next === 'pick' ? 'dropdowns' : 'text');
        stores.fullRoute.save(next === 'full');
        answer = next;
        draw();
      },
      onFilter: (next) => {
        stores.filter.save(choices.icao, next);
        filter = next;
        draw();
      },
      onRunwayGrading: (next) => {
        stores.runwayGrading.save(next);
        gradeRunway = next;
        draw();
      },
    });
    redrawHome(root, page);
    tour?.refresh();
  };
  draw();
  if (homeTourPending) tour = startHomeTour(stores);
  return {
    dispose: () => {
      tour?.stop();
    },
  };
}

/** Starts the tour's last part over home, once; Finish and Skip there mark the tour seen. */
function startHomeTour(stores: Stores): TourDriver {
  homeTourPending = false;
  return startTour({
    steps: HOME_TOUR,
    from: 0,
    onStep: () => {
      // Home's part is one step, with no progress worth resuming.
    },
    onEnd: () => {
      stores.tourSeen.save(true);
    },
  });
}

/**
 * Opens home once every airport of the index is loaded, since its cards name each one. A tour of
 * home waiting for it is dropped where another route overtakes it or the load fails.
 */
async function openHome(opening: Opening): Promise<void> {
  const { root, index, stores } = opening.target;
  let airports: AirportData[];
  try {
    airports = await Promise.all(index.map((entry) => cachedAirport(entry.icao)));
  } catch (error) {
    homeTourPending = false;
    throw error;
  }
  if (!isCurrent(opening)) {
    homeTourPending = false;
    return;
  }
  const choices = homeChoicesOf(stores.home, index);
  takeOver(opening, () => mountHome(root, airports, stores, choices));
}

/**
 * Opens the route a hash names into the page, in place of the page on screen. A route that a newer
 * one overtakes while it loads renders nothing.
 *
 * @param target The page to open the route into.
 * @param hash The hash, with or without its leading `#`.
 * @returns Nothing, once the route is on screen or overtaken.
 * @throws Error When an airport file the route needs fails to load or validate.
 */
async function openRoute(target: Active, hash: string): Promise<void> {
  target.generation += 1;
  routedHash = hash;
  const opening = { target, generation: target.generation };
  const route = routeOf(hash);
  switch (route.kind) {
    case 'strip':
      return openStrip(opening, hash);
    case 'practice':
      return openPractice(opening, route);
    case 'newTest':
      return openNewTest(opening, route);
    case 'continueTest':
      return openContinueTest(opening, route);
    case 'tutorial':
      return openTutorial(opening, route);
    case 'home':
      return openHome(opening);
  }
}

/**
 * Opens the route the page loaded on. Its failure is the trainer's failure to start, which the
 * caller writes into the page, unless a newer route has taken the page over since: then it is
 * logged and the newer page stays.
 */
async function openFirstRoute(target: Active, hash: string): Promise<void> {
  const opened = openRoute(target, hash);
  const generation = target.generation;
  try {
    await opened;
  } catch (error) {
    if (isCurrent({ target, generation })) throw error;
    console.error(`The trainer could not open ${hash}.`, error);
  }
}

/**
 * Opens the route of a hash the page moved to, from a link or Back. A route that fails to load is
 * written into the page and logged, unless a newer route has taken the page over since.
 */
function onHashChange(): void {
  const target = active;
  const hash = globalThis.location.hash;
  if (target === undefined || hash === routedHash) return;
  const opened = openRoute(target, hash);
  const generation = target.generation;
  void opened.catch((error: unknown) => {
    console.error(`The trainer could not open ${hash}.`, error);
    if (!isCurrent({ target, generation })) return;
    target.dispose();
    target.dispose = NOTHING_TO_DISPOSE;
    target.root.textContent =
      "The trainer couldn't load. Reload the page; if it keeps happening, please report it.";
  });
}

/**
 * Starts the trainer on the route the URL names: home on an empty hash or `#/`, a practice strip or
 * a test from an `#/<ICAO>/<mode>/…` link, a part of the tour from `#/tutorial` or
 * `#/tutorial/amend`, and a strip from every other hash, as before. A change of hash afterwards,
 * from a link or Back, opens its route in place of the page on screen, even where it arrives while
 * the first route is still loading. Home offers the tour to a browser that has not seen it, and
 * nothing opens the tour by itself.
 *
 * A strip link loads the airport the URL names, or the first of the index when it names none, and
 * renders the scenario the URL asks for, or a fresh one when the URL carries no seed.
 *
 * A link that names an airport the index does not list opens on the first one, the way a link that
 * names no airport does. A link that names a filter opens under that filter, so a shared scenario
 * reads the same to whoever opens it; a link that names none falls back to the filter this browser
 * last chose. The hash names the half of the trainer the link opens in, which is clearance mode
 * unless it says so. It names typed answers too; a link that does not falls back to the way this
 * browser last chose to answer, and to the dropdowns where it remembers none. A link asking for a
 * full route clearance opens typed and held to it, and one that names no input kind at all leaves
 * Full route to the choice this browser last made. A link that names a test set (`x=`) opens on
 * the set's strip, resumed where this browser stored the set and started fresh where it did not.
 *
 * @param root The element the page is rendered into.
 * @returns Nothing, once the first render is on screen.
 * @throws Error When the airports index is empty, or an airport file the first route needs fails to
 *   load or validate.
 */
export async function startApp(root: Element): Promise<void> {
  routedHash = globalThis.location.hash;
  const index = listAirports();
  firstAirport(index);
  await loadStripFont();
  const stores: Stores = {
    solved: browserSolvedStore(),
    filter: browserFilterStore(),
    input: browserInputKindStore(),
    fullRoute: browserFullRouteStore(),
    runwayGrading: browserRunwayGradingStore(),
    stage: browserStageStore(),
    set: browserSetStore(),
    home: browserHomeStore(),
    tourSeen: browserTourSeenStore(),
    tourProgress: browserTourProgressStore(),
  };
  active?.dispose();
  const target: Active = { root, index, stores, dispose: NOTHING_TO_DISPOSE, generation: 0 };
  active = target;
  // The listener goes in before the first route loads, so a link followed, or Back, while that load
  // is still running overtakes it through the same check every later route uses, and the first route
  // never writes its hash over the newer one.
  if (!routeListening) {
    routeListening = true;
    globalThis.addEventListener('hashchange', onHashChange);
  }
  await openFirstRoute(target, globalThis.location.hash);
  if (!toolbarListening) {
    toolbarListening = true;
    hideToolbarOnScroll();
  }
}
