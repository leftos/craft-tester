import type { AirportData, AirportsIndex, Scenario } from '@/data/schema.ts';
import type { Box, BoxAnswer } from '@/rules/amend/grade.ts';
import type { ResolvedClearance } from '@/rules/types.ts';
import type {
  ConfigFilter,
  InputKind,
  Mode,
  ScenarioFilter,
  SessionSettings,
  TimeFilter,
} from '@/scenario/filter.ts';
import {
  ANY_SCENARIO,
  airportFromHash,
  filterFromHash,
  fullRouteFromHash,
  hasFilterParams,
  hashFor,
  inputKindFromHash,
  modeFromHash,
  setFromHash,
} from '@/scenario/filter.ts';
import { randomSeed, seedFromHash } from '@/scenario/rng.ts';
import type { Panels } from '@/ui/amendPanels.ts';
import { procedureOf, renderAmendmentPanels } from '@/ui/amendPanels.ts';
import { renderAtis } from '@/ui/atis.ts';
import type { CraftFormProps } from '@/ui/craftForm.ts';
import { clearanceProcedureRow, renderCraftForm } from '@/ui/craftForm.ts';
import { button, el, segmentedControl, selectControl } from '@/ui/dom.ts';
import type { SegmentOption, SelectOption } from '@/ui/dom.ts';
import type { FilterStore, FullRouteStore, InputKindStore } from '@/ui/preferences.ts';
import {
  browserFilterStore,
  browserFullRouteStore,
  browserInputKindStore,
} from '@/ui/preferences.ts';
import { clearanceOutcome } from '@/ui/clearanceGrading.ts';
import { renderResults, renderRevisit } from '@/ui/results.ts';
import { clearedPlan, listAirports, loadAirportData } from '@/ui/session.ts';
import type { Attempt, SolvedStore } from '@/ui/solved.ts';
import { browserSolvedStore } from '@/ui/solved.ts';
import type { AppState, PickKey, SetState } from '@/ui/state.ts';
import {
  newSession,
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
  withSubmitted,
  withText,
} from '@/ui/state.ts';
import { addCopyLink, loadStripFont, renderStrip } from '@/ui/strip.ts';
import type { TextFormProps } from '@/ui/textForm.ts';
import { renderTextForm } from '@/ui/textForm.ts';
import {
  END_TEST_QUESTION,
  renderSetSummary,
  renderTestBar,
  renderTestStart,
} from '@/ui/testBar.ts';
import type { SetStore } from '@/ui/testSet.ts';
import {
  browserSetStore,
  clockReading,
  endedSet,
  isTimeUp,
  onSetStrip,
  openedSet,
  recordOf,
  setSummary,
  withStripAnswered,
  withStripSkipped,
} from '@/ui/testSet.ts';

export { clearancePickGrades } from '@/ui/clearanceGrading.ts';

/**
 * How the clearance is answered, as the toolbar offers it: picked from dropdowns, typed, or typed
 * and held to the route read to its end.
 */
type AnswerChoice = 'pick' | 'type' | 'full';

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

/** The time-of-day choices, in the order the dropdown offers them. */
const TIME_OPTIONS: readonly (SelectOption & { value: TimeFilter })[] = [
  { value: 'either', label: 'Either' },
  { value: 'day', label: 'Day' },
  { value: 'night', label: 'Night' },
];

/** The two halves of the trainer, in the order the toolbar offers them. */
const MODE_OPTIONS: readonly (SegmentOption & { value: Mode })[] = [
  { value: 'clearance', label: 'Clearance', title: '' },
  { value: 'amendment', label: 'Amend', title: '' },
];

/** The three ways to answer the clearance, in the order the toolbar offers them. */
const ANSWER_OPTIONS: readonly (SegmentOption & { value: AnswerChoice })[] = [
  { value: 'pick', label: 'Pick', title: 'Pick each element from dropdowns' },
  { value: 'type', label: 'Type', title: 'Type the clearance as spoken' },
  {
    value: 'full',
    label: 'Full route',
    title: 'Type it with the route read in full, as on a full route clearance (FRC)',
  },
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
  globalThis.history.replaceState(null, '', hashFor(icao, seed, settings));
}

/** The value a configuration filter reads back as in the dropdown. */
function configValue(config: ConfigFilter): string {
  if (config.kind === 'any') return 'any';
  return config.kind === 'plan' ? `plan:${config.plan}` : `id:${config.id}`;
}

/** Reads the configuration dropdown, which offers every configuration and every plan of them. */
function configFromValue(raw: string): ConfigFilter {
  const plan = raw.startsWith('plan:') ? raw.slice('plan:'.length) : '';
  if (plan.length > 0) return { kind: 'plan', plan };
  const id = raw.startsWith('id:') ? raw.slice('id:'.length) : '';
  return id.length > 0 ? { kind: 'id', id } : { kind: 'any' };
}

/** Every configuration choice: all of them, each plan of them, then each configuration by name. */
function configOptions(airport: AirportData): SelectOption[] {
  const plans = [...new Set(airport.runwayConfigs.map((config) => config.plan))];
  return [
    { value: 'any', label: 'Any' },
    ...plans.map((plan) => ({ value: `plan:${plan}`, label: `Any ${plan}` })),
    ...airport.runwayConfigs.map((config) => ({
      value: `id:${config.id}`,
      label: `${config.id} — ${config.name}`,
    })),
  ];
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

/** How many of the filters differ from drawing anything, which the Filters button counts. */
function activeFilterCount(filter: ScenarioFilter): number {
  const time = filter.time === 'either' ? 0 : 1;
  const config = filter.config.kind === 'any' ? 0 : 1;
  return time + config;
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
 * time and configuration dropdowns.
 */
function filtersControl(state: AppState, actions: Actions): HTMLElement {
  const details = el('details', 'filters');
  const summary = el('summary', '', 'Filters');
  const count = activeFilterCount(state.filter);
  if (count > 0) summary.append(el('span', 'count', String(count)));
  const popover = el('div', 'filters-popover');
  popover.append(...filterControls(state, actions));
  details.append(summary, popover);
  closeOnOutsidePress(details);
  return details;
}

/** The two dropdowns that narrow the draw: the time of day and the runway configuration. */
function filterControls(state: AppState, actions: Actions): HTMLElement[] {
  return [
    selectControl(
      {
        label: 'time',
        options: TIME_OPTIONS,
        value: state.filter.time,
        disabled: false,
        placeholder: '—',
      },
      (raw) => {
        const time = TIME_OPTIONS.find((option) => option.value === raw)?.value ?? 'either';
        actions.onFilter({ ...state.filter, time });
      },
    ),
    selectControl(
      {
        label: 'configuration',
        options: configOptions(state.airport),
        value: configValue(state.filter.config),
        disabled: false,
        placeholder: '—',
      },
      (raw) => {
        actions.onFilter({ ...state.filter, config: configFromValue(raw) });
      },
    ),
  ];
}

/** The Test button and its popover, which closes on a press outside it like Filters. */
function testControl(actions: Actions): HTMLElement {
  const details = renderTestStart(actions.onStartTest);
  closeOnOutsidePress(details);
  return details;
}

/**
 * The toolbar: the product name, the airport, the mode and answer switches and the Filters button,
 * then Test and New strip on the right. On a phone the answer switch, Filters and Test wrap to a
 * second row. While a test set runs, and over its summary, the test bar stands in for all of it.
 */
function renderToolbar(state: AppState, index: AirportsIndex, actions: Actions): HTMLElement {
  if (state.set !== undefined) return renderTestBar(state.set, actions, Date.now());
  const bar = el('header', 'toolbar');
  bar.setAttribute('aria-label', 'Session');
  const secondRow = el('div', 'toolbar-row2');
  secondRow.append(
    answerControl(state, actions),
    filtersControl(state, actions),
    testControl(actions),
  );
  bar.append(
    el('h1', 'brand', 'CRAFT trainer'),
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
 * on a strip of a test set.
 */
function renderUnresolved(reasons: readonly string[], next: HTMLButtonElement): HTMLElement {
  const panel = el('section', 'panel unresolved');
  const list = el('ul');
  for (const reason of reasons) list.append(el('li', '', reason));
  panel.append(el('h2', '', 'No clearance for this scenario'), list, next);
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
  const scope = { mode: state.mode, input: state.input, fullRoute: state.fullRoute };
  const summary = setSummary(state, set, (seed) => solved.load(icao, seed, scope), Date.now());
  return {
    rail: [],
    pinned: [],
    work: [renderSetSummary(summary, actions.onNewScenario)],
    sync: undefined,
  };
}

/**
 * The strip and the ATIS in the rail, and either the form or the results in the work column; a
 * finished test set shows its summary instead.
 */
function renderPanels(state: AppState, actions: Actions, solved: SolvedStore): Panels {
  if (phaseOf(state) === 'set-summary' && state.set !== undefined) {
    return summaryPanels(state, state.set, actions, solved);
  }
  if (state.view.kind === 'unresolved') {
    return {
      rail: [],
      pinned: [],
      work: [renderUnresolved(state.view.reasons, unresolvedNext(state, actions))],
      sync: undefined,
    };
  }
  if (state.view.kind === 'amendment') {
    return renderAmendmentPanels(state, state.view, actions);
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
      ...clearanceOutcome(revisit, generated, clearance, state.airport, routeReadingOf(state)),
      routeReading: routeReadingOf(state),
      onNext: actions.onNewScenario,
      onRetry: actions.onRetry,
    });
    return { rail: [], pinned, work: [work], sync: undefined };
  }
  const answer = toClearanceAnswer(state);
  if (phase === 'clearance-results' && answer !== undefined) {
    const work = renderResults({
      ...clearanceOutcome(answer, generated, clearance, state.airport, routeReadingOf(state)),
      routeReading: routeReadingOf(state),
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
 * link to it.
 */
function renderApp(
  state: AppState,
  index: AirportsIndex,
  actions: Actions,
  solved: SolvedStore,
): Page {
  const page = el('div', 'page');
  const panels = renderPanels(state, actions, solved);
  const rail = renderRail(panels);
  const main = el('main', rail === undefined ? 'layout no-rail' : 'layout');
  const strip = [...panels.rail, ...panels.pinned].find((node) =>
    node.matches('section.panel.strip'),
  );
  if (strip !== undefined && state.set === undefined) {
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

/** The widths the phone layout applies to, which is where the toolbar hides on scroll. */
const PHONE_QUERY = '(max-width: 899.98px)';

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
  set: SetStore;
};

/** How often the test bar's clock is written again, in milliseconds. */
const CLOCK_TICK_MS = 1000;

/** What keeps a test set going between renders, which follows the state after every change. */
type SetFollower = { follow: (state: AppState) => void };

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
 * A submit that comes after the time limit is discarded and the summary opens.
 *
 * @param current Reads the state on screen.
 * @param update Puts a new state on screen.
 * @param solved The store a submitted attempt is saved in.
 * @returns The handlers.
 */
function setActions(
  current: () => AppState,
  update: (next: AppState) => void,
  solved: SolvedStore,
): SetActions {
  const withSet = (act: (state: AppState, set: SetState) => void) => (): void => {
    const state = current();
    if (state.set !== undefined) act(state, state.set);
  };
  return {
    onStartTest: (n, minutes) => {
      const params = { seed: randomSeed(), n, minutes, index: 0 };
      update(openedSet(current(), params, undefined, Date.now()));
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
    store.save(state.airport.airport.icao, state.seed, attempt, state.fullRoute);
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

/**
 * Holds the state, rewrites the hash, and puts every change on screen.
 *
 * The panels are built again only when the view key changes, which is when a different set of them
 * belongs on screen; every other change is written into the controls already there. A pick or a
 * keystroke therefore leaves the control it came from in place, with its focus and its caret. A
 * test set is stored whenever it moves, so a reload resumes it, and its clock follows every change.
 */
function mount(root: Element, index: AirportsIndex, initial: AppState, stores: Stores): void {
  const store = stores.solved;
  let state = initial;
  let actions: Actions;
  let built: Built | undefined;

  const follower = setFollower(
    root,
    () => state,
    stores.set,
    (next) => {
      update(next);
    },
  );
  const update = (next: AppState): void => {
    state = next;
    writeHash(state.airport.airport.icao, state.seed, state);
    built = show(root, built, state, () => renderApp(state, index, actions, store));
    follower.follow(state);
  };

  actions = {
    onAirport: (icao) => {
      void loadAirportData(icao).then((airport) => {
        const filter: ScenarioFilter = { time: state.filter.time, config: { kind: 'any' } };
        const { mode, input, fullRoute } = state;
        const previous = store.load(icao, state.seed, { mode, input, fullRoute });
        update(newSession(airport, state.seed, previous, { filter, mode, input, fullRoute }));
      });
    },
    onBox: (box, answer) => {
      update(withBox(state, box, answer));
    },
    onBoxesSubmit: () => {
      if (state.view.kind !== 'amendment') return;
      const answers = toBoxAnswers(state.boxes);
      if (answers === undefined) return;
      const { plan } = clearedPlan(state.view, answers, state.airport);
      update(withBoxesSubmitted(state, procedureOf(plan, state.airport)));
    },
    onFilter: ({ time, config }) => {
      const { icao } = state.airport.airport;
      const filter: ScenarioFilter = { time, config };
      stores.filter.save(icao, filter);
      const seed = randomSeed();
      const { mode, input, fullRoute } = state;
      update(withFilter(state, filter, seed, store.load(icao, seed, { mode, input, fullRoute })));
      const popover = root.querySelector('details.filters');
      if (popover instanceof HTMLDetailsElement) popover.open = true;
    },
    onAnswer: (answer) => {
      const input: InputKind = answer === 'pick' ? 'dropdowns' : 'text';
      const fullRoute = answer === 'full';
      stores.input.save(input);
      stores.fullRoute.save(fullRoute);
      const scope = { mode: state.mode, input, fullRoute };
      const previous = store.load(state.airport.airport.icao, state.seed, scope);
      update(
        input === 'text'
          ? withFullRoute(state, fullRoute, previous)
          : withInputKind(state, input, previous),
      );
    },
    onMode: (mode) => {
      const seed = randomSeed();
      const { input, fullRoute } = state;
      const previous = store.load(state.airport.airport.icao, seed, { mode, input, fullRoute });
      update(withMode(state, mode, seed, previous));
    },
    onNewScenario: () => {
      const seed = randomSeed();
      const { icao } = state.airport.airport;
      const { mode, input, fullRoute } = state;
      const previous = store.load(icao, seed, { mode, input, fullRoute });
      update(newSession(state.airport, seed, previous, state));
    },
    onPick: (key, raw) => {
      update(withPick(state, key, raw));
    },
    onRetry: () => {
      update(withRetry(state));
    },
    onText: (text) => {
      update(withText(state, text));
    },
    ...setActions(() => state, update, store),
  };

  update(state);
}

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
 * Starts the trainer: loads the airport the URL names, or the first of the index when it names
 * none, and renders the scenario the URL asks for, or a fresh one when the URL carries no seed.
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
 * @throws Error When the airports index is empty, or its airport file fails to load or validate.
 */
export async function startApp(root: Element): Promise<void> {
  const index = listAirports();
  const first = index[0];
  if (first === undefined) throw new Error('airports.json lists no airports');
  const hash = globalThis.location.hash;
  const named = airportFromHash(hash);
  const entry = index.find((candidate) => candidate.icao === named) ?? first;
  const [airport] = await Promise.all([loadAirportData(entry.icao), loadStripFont()]);
  const seed = seedFromHash(hash) ?? randomSeed();
  const mode = modeFromHash(hash);
  const stores: Stores = {
    solved: browserSolvedStore(),
    filter: browserFilterStore(),
    input: browserInputKindStore(),
    fullRoute: browserFullRouteStore(),
    set: browserSetStore(),
  };
  const filter = hasFilterParams(hash)
    ? filterFromHash(hash)
    : (stores.filter.load(entry.icao) ?? ANY_SCENARIO);
  const input = inputKindFromHash(hash) ?? stores.input.load() ?? 'dropdowns';
  const fullRoute = opensFullRoute(hash, input, stores.fullRoute.load());
  const previous = stores.solved.load(entry.icao, seed, { mode, input, fullRoute });
  const settings = { filter, mode, input, fullRoute };
  const session = newSession(airport, seed, previous, settings);
  const set = setFromHash(hash);
  const initial =
    set === undefined ? session : openedSet(session, set, stores.set.load(set.seed), Date.now());
  mount(root, index, initial, stores);
  if (!toolbarListening) {
    toolbarListening = true;
    hideToolbarOnScroll();
  }
}
