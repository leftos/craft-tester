import type { AirportData, AirportsIndex, Scenario } from '@/data/schema.ts';
import type { Box, BoxAnswer } from '@/rules/amend/grade.ts';
import { grade } from '@/rules/grade.ts';
import type { SpokenClearance } from '@/rules/speak.ts';
import type { RouteReading, TextGrade } from '@/rules/text/grade.ts';
import { gradeText } from '@/rules/text/grade.ts';
import type { Grade, PlayerPicks, ResolvedClearance } from '@/rules/types.ts';
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
} from '@/scenario/filter.ts';
import { randomSeed, seedFromHash } from '@/scenario/rng.ts';
import type { Panels } from '@/ui/amendPanels.ts';
import { procedureOf, renderAmendmentPanels } from '@/ui/amendPanels.ts';
import { renderAtis } from '@/ui/atis.ts';
import type { CraftFormProps } from '@/ui/craftForm.ts';
import { renderCraftForm } from '@/ui/craftForm.ts';
import { button, checkboxControl, el, selectControl } from '@/ui/dom.ts';
import type { SelectOption } from '@/ui/dom.ts';
import type { FilterStore, FullRouteStore, InputKindStore } from '@/ui/preferences.ts';
import {
  browserFilterStore,
  browserFullRouteStore,
  browserInputKindStore,
} from '@/ui/preferences.ts';
import { renderResults, renderRevisit } from '@/ui/results.ts';
import { clearedPlan, listAirports, loadAirportData, spokenFor } from '@/ui/session.ts';
import type { SolvedStore } from '@/ui/solved.ts';
import { browserSolvedStore } from '@/ui/solved.ts';
import type { AppState, ClearanceAnswer, PickKey } from '@/ui/state.ts';
import {
  newSession,
  phaseOf,
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
import { renderStrip } from '@/ui/strip.ts';
import type { TextFormProps } from '@/ui/textForm.ts';
import { renderTextForm } from '@/ui/textForm.ts';

/** What the page's controls call back into. */
type Actions = {
  onAirport: (icao: string) => void;
  onBox: (box: Box, answer: BoxAnswer) => void;
  onBoxesSubmit: () => void;
  /** Narrows the draw to what the dropdowns say; a destination forced by the hash does not survive it. */
  onFilter: (filter: ScenarioFilter) => void;
  /**
   * Holds the scenario on screen to the route read to its end, or lets it back to the reading
   * spoken on frequency, and remembers the choice. Ticking it answers by typing.
   */
  onFullRoute: (fullRoute: boolean) => void;
  /** Answers the scenario on screen the other way, on the same seed, and remembers the choice. */
  onInput: (input: InputKind) => void;
  onMode: (mode: Mode) => void;
  onNewScenario: () => void;
  onPick: (key: PickKey, raw: string) => void;
  onRetry: () => void;
  onSubmit: () => void;
  onText: (text: string) => void;
};

/** The time-of-day choices, in the order the dropdown offers them. */
const TIME_OPTIONS: readonly (SelectOption & { value: TimeFilter })[] = [
  { value: 'either', label: 'Either' },
  { value: 'day', label: 'Day' },
  { value: 'night', label: 'Night' },
];

/** The two halves of the trainer, in the order the dropdown offers them. */
const MODE_OPTIONS: readonly (SelectOption & { value: Mode })[] = [
  { value: 'clearance', label: 'Clean clearance' },
  { value: 'amendment', label: 'Amend and clear' },
];

/** The two ways to answer the clearance, in the order the dropdown offers them. */
const INPUT_OPTIONS: readonly (SelectOption & { value: InputKind })[] = [
  { value: 'dropdowns', label: 'Dropdowns' },
  { value: 'text', label: 'Typed' },
];

/**
 * Puts the airport, the seed, the filter, the mode and the input kind in the hash, so a reload and
 * a link both restore them.
 */
function writeHash(icao: string, seed: number, settings: SessionSettings): void {
  globalThis.history.replaceState(null, '', hashFor(icao, seed, settings));
}

/** The link that shares the scenario on screen, shown as the hash it adds. */
function shareControl(icao: string, seed: number, settings: SessionSettings): HTMLElement {
  const wrapper = el('p', 'share');
  const link = el('a', '', hashFor(icao, seed, settings));
  link.href = shareLink(globalThis.location.href, icao, seed, settings);
  wrapper.append(el('span', 'share-label', 'scenario link'), link);
  return wrapper;
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

/** The dropdown that picks the half of the trainer the session runs in. */
function modeControl(state: AppState, actions: Actions): HTMLElement {
  return selectControl(
    {
      label: 'mode',
      options: MODE_OPTIONS,
      value: state.mode,
      disabled: false,
      placeholder: '—',
    },
    (raw) => {
      const mode = MODE_OPTIONS.find((option) => option.value === raw)?.value ?? 'clearance';
      actions.onMode(mode);
    },
  );
}

/** The dropdown that picks how the clearance is answered: picked from dropdowns, or typed out. */
function inputControl(state: AppState, actions: Actions): HTMLElement {
  return selectControl(
    {
      label: 'answer',
      options: INPUT_OPTIONS,
      value: state.input,
      disabled: false,
      placeholder: '—',
    },
    (raw) => {
      const input = INPUT_OPTIONS.find((option) => option.value === raw)?.value ?? 'dropdowns';
      actions.onInput(input);
    },
  );
}

/** The checkbox that holds the student to the route read to its end, which is typed out. */
function fullRouteControl(state: AppState, actions: Actions): HTMLElement {
  return checkboxControl(
    {
      label: 'full route',
      checked: state.fullRoute,
      title: 'Grade the route read in full, as on a full route clearance (FRC)',
    },
    actions.onFullRoute,
  );
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

/** The title, the airport picker, the mode, answer and full route switches, the filters, the new-scenario button, and the shareable seed. */
function renderHeader(state: AppState, index: AirportsIndex, actions: Actions): HTMLElement {
  const header = el('header', 'app-header');
  const controls = el('div', 'controls');
  controls.append(
    selectControl(
      {
        label: 'airport',
        options: index.map((entry) => ({ value: entry.icao, label: entry.icao })),
        value: state.airport.airport.icao,
        disabled: false,
        placeholder: '—',
      },
      actions.onAirport,
    ),
    modeControl(state, actions),
    inputControl(state, actions),
    fullRouteControl(state, actions),
    ...filterControls(state, actions),
    button('New scenario', 'primary', actions.onNewScenario),
  );
  header.append(
    el('h1', '', 'CRAFT Clearance Trainer'),
    controls,
    shareControl(state.airport.airport.icao, state.seed, state),
  );
  return header;
}

/** The panel a seed that the engine cannot clear shows instead of the form. */
function renderUnresolved(reasons: readonly string[], onNext: () => void): HTMLElement {
  const panel = el('section', 'panel unresolved');
  const list = el('ul');
  for (const reason of reasons) list.append(el('li', '', reason));
  panel.append(
    el('h2', '', 'No clearance for this scenario'),
    list,
    button('New scenario', 'primary', onNext),
  );
  return panel;
}

/**
 * The verdicts a clearance answer earns: the picks graded as picked, or the typed clearance graded
 * against the engine's reading of the same clearance.
 */
function clearanceGrades(
  answer: ClearanceAnswer<PlayerPicks>,
  spoken: SpokenClearance,
  clearance: ResolvedClearance,
  airport: AirportData,
  routeReading: RouteReading,
): (Grade | TextGrade)[] {
  return answer.input === 'text'
    ? gradeText(answer.text, spoken, clearance, airport, routeReading)
    : grade(answer.picks, clearance);
}

/** The strip, the ATIS, and then either the form or the results. */
function renderPanels(state: AppState, actions: Actions): Panels {
  if (state.view.kind === 'unresolved') {
    return {
      nodes: [renderUnresolved(state.view.reasons, actions.onNewScenario)],
      sync: undefined,
    };
  }
  if (state.view.kind === 'amendment') {
    return renderAmendmentPanels(state, state.view, actions);
  }
  const phase = phaseOf(state);
  const { generated, clearance } = state.view;
  const panels = [
    renderStrip(generated, state.airport, state.seed, 'Flight plan'),
    renderAtis(generated, state.airport),
  ];
  const revisit = state.revisit;
  if (phase === 'clearance-revisit' && revisit?.kind === 'clearance') {
    const spoken = spokenFor(generated, generated, clearance, state.airport);
    panels.push(
      renderRevisit({
        grades: clearanceGrades(
          revisit,
          spoken,
          clearance,
          state.airport,
          state.fullRoute ? 'full' : 'abbreviated',
        ),
        spoken,
        onNext: actions.onNewScenario,
        onRetry: actions.onRetry,
      }),
    );
    return { nodes: panels, sync: undefined };
  }
  const answer = toClearanceAnswer(state);
  if (phase === 'clearance-results' && answer !== undefined) {
    const spoken = spokenFor(generated, generated, clearance, state.airport);
    panels.push(
      renderResults({
        grades: clearanceGrades(
          answer,
          spoken,
          clearance,
          state.airport,
          state.fullRoute ? 'full' : 'abbreviated',
        ),
        spoken,
        onNext: actions.onNewScenario,
        onRetry: actions.onRetry,
      }),
    );
    return { nodes: panels, sync: undefined };
  }
  const form = renderClearanceForm(state, generated, clearance, actions);
  panels.push(form.node);
  return { nodes: panels, sync: form.sync };
}

/** The answer form of a clean clearance: the node on screen, and how to write a later state into it. */
type ClearanceForm = { node: HTMLElement; sync: (state: AppState) => void };

/**
 * The form a clean clearance is answered in: the typing box where the student types it out, and the
 * CRAFT dropdowns otherwise.
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
    });
    const form = renderTextForm(typed(state));
    return { node: form.node, sync: (next) => form.sync(typed(next)) };
  }
  const picked = (next: AppState): CraftFormProps => ({
    scenario,
    airport: next.airport,
    clearance,
    picks: next.picks,
    procedure: 'given',
    onPick: actions.onPick,
    onSubmit: actions.onSubmit,
  });
  const form = renderCraftForm(picked(state));
  return { node: form.node, sync: (next) => form.sync(picked(next)) };
}

/** The whole page: the node on screen, and how to write a later state of the same panels into it. */
type Page = { node: HTMLElement; sync: ((state: AppState) => void) | undefined };

/** Renders the whole page from the state. */
function renderApp(state: AppState, index: AirportsIndex, actions: Actions): Page {
  const page = el('div', 'page');
  const main = el('main', 'layout');
  const panels = renderPanels(state, actions);
  main.append(...panels.nodes);
  page.append(renderHeader(state, index, actions), main);
  return { node: page, sync: panels.sync };
}

/** Everything `mount` remembers between renders that is not the state itself. */
type Stores = {
  solved: SolvedStore;
  filter: FilterStore;
  input: InputKindStore;
  fullRoute: FullRouteStore;
};

/**
 * Remembers the attempt the student just submitted, so a revisit of the seed shows it back.
 *
 * An amendment attempt is the strip answers and the clearance that followed them; a form still
 * missing a pick, or a typing box holding nothing but whitespace, is not an attempt at all and is
 * not written.
 */
function saveAttempt(state: AppState, store: SolvedStore): void {
  const { icao } = state.airport.airport;
  if (state.mode === 'amendment') {
    const boxes = toBoxAnswers(state.boxes);
    const answer = toAmendmentAnswer(state);
    if (boxes !== undefined && answer !== undefined) {
      store.save(icao, state.seed, { kind: 'amendment', boxes, ...answer }, state.fullRoute);
    }
    return;
  }
  const answer = toClearanceAnswer(state);
  if (answer !== undefined) {
    store.save(icao, state.seed, { kind: 'clearance', ...answer }, state.fullRoute);
  }
}

/** The panels on screen, and the view key they were built for. */
type Built = { key: string; sync: ((state: AppState) => void) | undefined };

/**
 * Holds the state, rewrites the hash, and puts every change on screen.
 *
 * The panels are built again only when the view key changes, which is when a different set of them
 * belongs on screen; every other change is written into the controls already there. A pick or a
 * keystroke therefore leaves the control it came from in place, with its focus and its caret.
 */
function mount(root: Element, index: AirportsIndex, initial: AppState, stores: Stores): void {
  const store = stores.solved;
  let state = initial;
  let actions: Actions;
  let built: Built | undefined;

  const update = (next: AppState): void => {
    state = next;
    writeHash(state.airport.airport.icao, state.seed, state);
    const key = viewKey(state);
    if (built === undefined || built.key !== key) {
      const page = renderApp(state, index, actions);
      root.replaceChildren(page.node);
      built = { key, sync: page.sync };
      return;
    }
    built.sync?.(state);
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
    },
    onFullRoute: (fullRoute) => {
      const { icao } = state.airport.airport;
      stores.fullRoute.save(fullRoute);
      if (fullRoute) stores.input.save('text');
      const scope = { mode: state.mode, input: 'text', fullRoute } as const;
      update(withFullRoute(state, fullRoute, store.load(icao, state.seed, scope)));
    },
    onInput: (input) => {
      stores.input.save(input);
      const fullRoute = input === 'text' && state.fullRoute;
      if (input === 'dropdowns') stores.fullRoute.save(false);
      const scope = { mode: state.mode, input, fullRoute };
      const previous = store.load(state.airport.airport.icao, state.seed, scope);
      update(withInputKind(state, input, previous));
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
    onSubmit: () => {
      saveAttempt(state, store);
      update(withSubmitted(state));
    },
    onText: (text) => {
      update(withText(state, text));
    },
  };

  update(state);
}

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
 * @returns True when the session opens with the full route box ticked.
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
 * the full route box to the choice this browser last made.
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
  const airport = await loadAirportData(entry.icao);
  const seed = seedFromHash(hash) ?? randomSeed();
  const mode = modeFromHash(hash);
  const stores: Stores = {
    solved: browserSolvedStore(),
    filter: browserFilterStore(),
    input: browserInputKindStore(),
    fullRoute: browserFullRouteStore(),
  };
  const filter = hasFilterParams(hash)
    ? filterFromHash(hash)
    : (stores.filter.load(entry.icao) ?? ANY_SCENARIO);
  const input = inputKindFromHash(hash) ?? stores.input.load() ?? 'dropdowns';
  const fullRoute = opensFullRoute(hash, input, stores.fullRoute.load());
  const previous = stores.solved.load(entry.icao, seed, { mode, input, fullRoute });
  const settings = { filter, mode, input, fullRoute };
  mount(root, index, newSession(airport, seed, previous, settings), stores);
}
