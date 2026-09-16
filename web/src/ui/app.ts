import type { AirportData, AirportsIndex } from '@/data/schema.ts';
import { grade } from '@/rules/grade.ts';
import type { ConfigFilter, ScenarioFilter, TimeFilter } from '@/scenario/filter.ts';
import { ANY_SCENARIO, filterFromHash, hasFilterParams, hashFor } from '@/scenario/filter.ts';
import { randomSeed, seedFromHash } from '@/scenario/rng.ts';
import { renderAtis } from '@/ui/atis.ts';
import { renderCraftForm } from '@/ui/craftForm.ts';
import { button, el, selectControl } from '@/ui/dom.ts';
import type { SelectOption } from '@/ui/dom.ts';
import type { FilterStore } from '@/ui/preferences.ts';
import { browserFilterStore } from '@/ui/preferences.ts';
import { renderResults, renderRevisit } from '@/ui/results.ts';
import { listAirports, loadAirportData, spokenFor } from '@/ui/session.ts';
import type { SolvedStore } from '@/ui/solved.ts';
import { browserSolvedStore } from '@/ui/solved.ts';
import type { AppState, PickKey } from '@/ui/state.ts';
import {
  newSession,
  shareLink,
  toPlayerPicks,
  withFilter,
  withPick,
  withRetry,
  withSubmitted,
} from '@/ui/state.ts';
import { renderStrip } from '@/ui/strip.ts';

/** What the page's controls call back into. */
type Actions = {
  onAirport: (icao: string) => void;
  onFilter: (filter: ScenarioFilter) => void;
  onNewScenario: () => void;
  onPick: (key: PickKey, raw: string) => void;
  onRetry: () => void;
  onSubmit: () => void;
};

/** The time-of-day choices, in the order the dropdown offers them. */
const TIME_OPTIONS: readonly (SelectOption & { value: TimeFilter })[] = [
  { value: 'either', label: 'Either' },
  { value: 'day', label: 'Day' },
  { value: 'night', label: 'Night' },
];

/** Puts the seed and the filter in the URL hash, so a reload and a copied link both restore them. */
function writeHash(seed: number, filter: ScenarioFilter): void {
  globalThis.history.replaceState(null, '', hashFor(seed, filter));
}

/** The link that shares the scenario on screen, shown as the hash it adds. */
function shareControl(seed: number, filter: ScenarioFilter): HTMLElement {
  const wrapper = el('p', 'share');
  const link = el('a', '', hashFor(seed, filter));
  link.href = shareLink(globalThis.location.href, seed, filter);
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

/** The title, the airport picker, the filters, the new-scenario button, and the shareable seed. */
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
    ...filterControls(state, actions),
    button('New scenario', 'primary', actions.onNewScenario),
  );
  header.append(
    el('h1', '', 'CRAFT Clearance Trainer'),
    controls,
    shareControl(state.seed, state.filter),
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

/** The strip, the ATIS, and then either the form or the results. */
function renderPanels(state: AppState, actions: Actions): HTMLElement[] {
  if (state.view.kind === 'unresolved') {
    return [renderUnresolved(state.view.reasons, actions.onNewScenario)];
  }
  const { generated, clearance } = state.view;
  const panels = [renderStrip(generated), renderAtis(generated, state.airport)];
  if (state.revisit !== undefined && !state.submitted) {
    panels.push(
      renderRevisit({
        grades: grade(state.revisit, clearance),
        spoken: spokenFor(generated, clearance, state.airport),
        onNext: actions.onNewScenario,
        onRetry: actions.onRetry,
      }),
    );
    return panels;
  }
  const picks = toPlayerPicks(state.picks);
  if (state.submitted && picks !== undefined) {
    panels.push(
      renderResults({
        grades: grade(picks, clearance),
        spoken: spokenFor(generated, clearance, state.airport),
        onNext: actions.onNewScenario,
        onRetry: actions.onRetry,
      }),
    );
    return panels;
  }
  panels.push(
    renderCraftForm({
      scenario: generated,
      airport: state.airport,
      clearance,
      picks: state.picks,
      onPick: actions.onPick,
      onSubmit: actions.onSubmit,
    }),
  );
  return panels;
}

/** Renders the whole page from the state. */
function renderApp(state: AppState, index: AirportsIndex, actions: Actions): HTMLElement {
  const page = el('div', 'page');
  const main = el('main', 'layout');
  main.append(...renderPanels(state, actions));
  page.append(renderHeader(state, index, actions), main);
  return page;
}

/** Everything `mount` remembers between renders that is not the state itself. */
type Stores = { solved: SolvedStore; filter: FilterStore };

/** Holds the state, rewrites the hash, and renders the page after every change. */
function mount(root: Element, index: AirportsIndex, initial: AppState, stores: Stores): void {
  const store = stores.solved;
  let state = initial;
  let actions: Actions;

  const update = (next: AppState): void => {
    state = next;
    writeHash(state.seed, state.filter);
    root.replaceChildren(renderApp(state, index, actions));
  };

  actions = {
    onAirport: (icao) => {
      void loadAirportData(icao).then((airport) => {
        const filter: ScenarioFilter = { time: state.filter.time, config: { kind: 'any' } };
        update(newSession(airport, state.seed, store.load(icao, state.seed), filter));
      });
    },
    onFilter: (filter) => {
      const { icao } = state.airport.airport;
      stores.filter.save(icao, filter);
      const seed = randomSeed();
      update(withFilter(state, filter, seed, store.load(icao, seed)));
    },
    onNewScenario: () => {
      const seed = randomSeed();
      const { icao } = state.airport.airport;
      update(newSession(state.airport, seed, store.load(icao, seed), state.filter));
    },
    onPick: (key, raw) => {
      update(withPick(state, key, raw));
    },
    onRetry: () => {
      update(withRetry(state));
    },
    onSubmit: () => {
      const picks = toPlayerPicks(state.picks);
      if (picks !== undefined) store.save(state.airport.airport.icao, state.seed, picks);
      update(withSubmitted(state));
    },
  };

  update(state);
}

/**
 * Starts clearance mode: loads the first airport of the index and renders the scenario the URL asks
 * for, or a fresh one when the URL carries no seed.
 *
 * A link that names a filter opens under that filter, so a shared scenario reads the same to
 * whoever opens it; a link that names none falls back to the filter this browser last chose.
 *
 * @param root The element the page is rendered into.
 * @returns Nothing, once the first render is on screen.
 * @throws Error When the airports index is empty, or its airport file fails to load or validate.
 */
export async function startApp(root: Element): Promise<void> {
  const index = listAirports();
  const first = index[0];
  if (first === undefined) throw new Error('airports.json lists no airports');
  const airport = await loadAirportData(first.icao);
  const hash = globalThis.location.hash;
  const seed = seedFromHash(hash) ?? randomSeed();
  const stores = { solved: browserSolvedStore(), filter: browserFilterStore() };
  const filter = hasFilterParams(hash)
    ? filterFromHash(hash)
    : (stores.filter.load(first.icao) ?? ANY_SCENARIO);
  mount(
    root,
    index,
    newSession(airport, seed, stores.solved.load(first.icao, seed), filter),
    stores,
  );
}
