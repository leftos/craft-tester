import type { AirportsIndex } from '@/data/schema.ts';
import { grade } from '@/rules/grade.ts';
import { randomSeed, seedFromHash, seedToHash } from '@/scenario/rng.ts';
import { renderAtis } from '@/ui/atis.ts';
import { renderCraftForm } from '@/ui/craftForm.ts';
import { button, el, selectControl } from '@/ui/dom.ts';
import { renderResults } from '@/ui/results.ts';
import { listAirports, loadAirportData, spokenFor } from '@/ui/session.ts';
import type { AppState, PickKey } from '@/ui/state.ts';
import { newSession, shareLink, toPlayerPicks, withPick, withSubmitted } from '@/ui/state.ts';
import { renderStrip } from '@/ui/strip.ts';

/** What the page's controls call back into. */
type Actions = {
  onAirport: (icao: string) => void;
  onNewScenario: () => void;
  onPick: (key: PickKey, raw: string) => void;
  onSubmit: () => void;
};

/** Puts the current seed in the URL hash, so a reload and a copied link both restore the scenario. */
function writeHash(seed: number): void {
  globalThis.history.replaceState(null, '', seedToHash(seed));
}

/** The link that shares the scenario on screen, shown as the hash it adds. */
function shareControl(seed: number): HTMLElement {
  const wrapper = el('p', 'share');
  const link = el('a', '', seedToHash(seed));
  link.href = shareLink(globalThis.location.href, seed);
  wrapper.append(el('span', 'share-label', 'scenario link'), link);
  return wrapper;
}

/** The title, the airport picker, the new-scenario button, and the shareable seed. */
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
    button('New scenario', 'primary', actions.onNewScenario),
  );
  header.append(el('h1', '', 'CRAFT Clearance Trainer'), controls, shareControl(state.seed));
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
  const panels = [renderStrip(generated), renderAtis(generated.scenario, state.airport)];
  const picks = toPlayerPicks(state.picks);
  if (state.submitted && picks !== undefined) {
    panels.push(
      renderResults({
        grades: grade(picks, clearance, state.airport.sids),
        spoken: spokenFor(generated.scenario, clearance, state.airport),
        onNext: actions.onNewScenario,
      }),
    );
    return panels;
  }
  panels.push(
    renderCraftForm({
      scenario: generated.scenario,
      airport: state.airport,
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

/** Holds the state, rewrites the hash, and renders the page after every change. */
function mount(root: Element, index: AirportsIndex, initial: AppState): void {
  let state = initial;
  let actions: Actions;

  const update = (next: AppState): void => {
    state = next;
    writeHash(state.seed);
    root.replaceChildren(renderApp(state, index, actions));
  };

  actions = {
    onAirport: (icao) => {
      void loadAirportData(icao).then((airport) => {
        update(newSession(airport, state.seed));
      });
    },
    onNewScenario: () => {
      update(newSession(state.airport, randomSeed()));
    },
    onPick: (key, raw) => {
      update(withPick(state, key, raw));
    },
    onSubmit: () => {
      update(withSubmitted(state));
    },
  };

  update(state);
}

/**
 * Starts clearance mode: loads the first airport of the index and renders the scenario the URL asks
 * for, or a fresh one when the URL carries no seed.
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
  const seed = seedFromHash(globalThis.location.hash) ?? randomSeed();
  mount(root, index, newSession(airport, seed));
}
