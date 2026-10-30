// @vitest-environment happy-dom
import swa1740 from '@fixtures/koak/worksheets/phraseology-practice-1a-swa1740.json';
import jsx201 from '@fixtures/koak/worksheets/amendment-practice-1a-jsx201.json';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AirportData, Fixture } from '@/data/schema.ts';
import { FixtureSchema } from '@/data/schema.ts';
import { withCurrentVersions } from '@/rules/fixtureVersions.ts';
import type { Mode } from '@/scenario/filter.ts';
import { ANY_SCENARIO } from '@/scenario/filter.ts';
import type { AmendmentHandlers } from '@/ui/amendPanels.ts';
import { procedureOf, renderAmendmentPanels } from '@/ui/amendPanels.ts';
import { renderAtis } from '@/ui/atis.ts';
import { clearanceOutcome } from '@/ui/clearanceGrading.ts';
import type { CraftFormProps } from '@/ui/craftForm.ts';
import { clearanceProcedureRow, renderCraftForm } from '@/ui/craftForm.ts';
import { renderResults } from '@/ui/results.ts';
import { clearedPlan, loadAirportData } from '@/ui/session.ts';
import type { AppState } from '@/ui/state.ts';
import {
  newSessionFrom,
  routeReadingOf,
  toBoxAnswers,
  toClearanceAnswer,
  withBox,
  withBoxesSubmitted,
  withPick,
  withSubmitted,
} from '@/ui/state.ts';
import { renderStrip } from '@/ui/strip.ts';
import type { TourAnchor, TourStep } from '@/ui/tour.ts';
import { AMEND_TOUR, CLEARANCE_TOUR, HOME_TOUR } from '@/ui/tourSteps.ts';

let koak: AirportData;

beforeAll(async () => {
  koak = await loadAirportData('KOAK');
});

beforeEach(() => {
  document.body.replaceChildren();
});

/** A fixture as the tour runs it: parsed, and stamped with the current SID versions. */
function tourFixture(json: unknown): Fixture {
  return withCurrentVersions(FixtureSchema.parse(json), koak);
}

/** A session on a fixture's plan, answered with the dropdowns. */
function sessionOn(fixture: Fixture, mode: Mode): AppState {
  return newSessionFrom(koak, fixture.scenario, {
    filter: ANY_SCENARIO,
    mode,
    input: 'dropdowns',
    fullRoute: false,
  });
}

/** Puts these panels on the page in place of whatever was there. */
function show(nodes: readonly HTMLElement[]): void {
  const main = document.createElement('main');
  main.append(...nodes);
  document.body.replaceChildren(main);
}

/** The elements on the page carrying one tour anchor. */
function anchored(anchor: TourAnchor): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`)];
}

/** The one element on the page carrying a tour anchor. */
function anchorOf(anchor: TourAnchor): HTMLElement {
  const found = anchored(anchor);
  expect(found, `elements carrying data-tour="${anchor}"`).toHaveLength(1);
  const [node] = found;
  if (node === undefined) throw new Error(`no element carries data-tour="${anchor}"`);
  return node;
}

/** The dropdown inside an anchored element. */
function selectIn(anchor: TourAnchor): HTMLSelectElement {
  const select = anchorOf(anchor).querySelector('select');
  if (select === null) throw new Error(`data-tour="${anchor}" holds no dropdown`);
  return select;
}

/** Chooses a value in a dropdown as the student does, which fires its `change` handler. */
function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

/** The anchored element as a button. */
function buttonAt(anchor: TourAnchor): HTMLButtonElement {
  const node = anchorOf(anchor);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`data-tour="${anchor}" is no button`);
  return node;
}

/** The steps up to and including the first that waits on a submit. */
function stepsThroughSubmit(steps: readonly TourStep[]): readonly TourStep[] {
  const at = steps.findIndex((step) => step.advance === 'submit');
  if (at === -1) throw new Error('the tour has no submit step');
  return steps.slice(0, at + 1);
}

/** A handler the page under test never expects to be called. */
function unexpected(name: string): () => void {
  return () => {
    throw new Error(`${name} was called`);
  };
}

describe('the clearance part of the tour, over swa1740', () => {
  it('finds every anchor, takes the fixture expected picks, and ends on the results', () => {
    const fixture = tourFixture(swa1740);
    let state = sessionOn(fixture, 'clearance');
    const view = state.view;
    if (view.kind !== 'clearance') throw new Error(`swa1740 resolved to ${view.kind}`);
    const { generated, clearance } = view;
    const props = (next: AppState): CraftFormProps => ({
      scenario: generated,
      airport: next.airport,
      clearance,
      picks: next.picks,
      procedure: clearanceProcedureRow(clearance),
      onPick: (key, raw) => {
        state = withPick(state, key, raw);
        form.sync(props(state));
      },
      onSubmit: () => {
        state = withSubmitted(state);
      },
      boxesOpen: false,
    });
    const form = renderCraftForm(props(state));
    show([
      renderStrip(generated, koak, state.seed, 'Flight plan', { revision: undefined, frc: false }),
      renderAtis(generated, koak),
      form.node,
    ]);

    for (const step of stepsThroughSubmit(CLEARANCE_TOUR)) anchorOf(step.anchor);
    for (const step of CLEARANCE_TOUR) {
      const advance = step.advance;
      if (typeof advance === 'object' && 'pick' in advance) {
        choose(selectIn(advance.pick), advance.value);
      }
    }

    const expected = fixture.expected;
    if (expected === undefined || !('route' in expected)) {
      throw new Error('swa1740 expects no clearance');
    }
    expect(state.picks.routeTemplate).toBe(expected.route.template);
    expect(state.picks.routeFix).toBe(expected.route.fix);
    expect(state.picks.altitudePhrase).toBe(expected.altitude.phrase);
    expect(state.picks.expect).toBe(expected.expect ?? 'none');
    expect(state.picks.frequency).toBe(expected.frequency);
    expect(state.picks.runway).toBe(fixture.scenario.departureRunway);

    const submit = buttonAt('submit');
    expect(submit.disabled).toBe(false);
    submit.click();
    expect(state.submitted).toBe(true);

    const answer = toClearanceAnswer(state);
    if (answer === undefined) throw new Error('the submitted clearance has no answer');
    const routeReading = routeReadingOf(state);
    show([
      renderResults({
        ...clearanceOutcome(answer, generated, clearance, koak, routeReading),
        routeReading,
        nextActions: false,
        onNext: unexpected('onNext'),
        onRetry: unexpected('onRetry'),
      }),
    ]);
    anchorOf('results');
  });
});

describe('the Amend part of the tour, over jsx201', () => {
  it('finds the boxes and their submit, then the procedure once the boxes are in', () => {
    const fixture = tourFixture(jsx201);
    let state = sessionOn(fixture, 'amendment');
    const view = state.view;
    if (view.kind !== 'amendment') throw new Error(`jsx201 resolved to ${view.kind}`);
    let sync: ((next: AppState) => void) | undefined;
    const handlers: AmendmentHandlers = {
      onBox: (box, answer) => {
        state = withBox(state, box, answer);
        sync?.(state);
      },
      onBoxesSubmit: () => {
        const answers = toBoxAnswers(state.boxes);
        if (answers === undefined) return;
        const { plan } = clearedPlan(view, answers, koak);
        state = withBoxesSubmitted(state, procedureOf(plan, koak));
        render();
      },
      onNewScenario: unexpected('onNewScenario'),
      onPick: (key, raw) => {
        state = withPick(state, key, raw);
        sync?.(state);
      },
      onRetry: unexpected('onRetry'),
      onSubmit: unexpected('onSubmit'),
      onText: unexpected('onText'),
      onSkip: unexpected('onSkip'),
    };
    const render = (): void => {
      const panels = renderAmendmentPanels(state, view, handlers, false);
      sync = panels.sync;
      show([...panels.rail, ...panels.pinned, ...panels.work]);
    };
    render();

    for (const step of stepsThroughSubmit(AMEND_TOUR)) anchorOf(step.anchor);
    for (const step of AMEND_TOUR) {
      const advance = step.advance;
      if (typeof advance === 'object' && 'box' in advance) {
        choose(selectIn(step.anchor), advance.answer.kind);
        expect(state.boxes[advance.box]).toStrictEqual(advance.answer);
      }
    }

    const submit = buttonAt('boxes-submit');
    expect(submit.disabled).toBe(false);
    submit.click();
    expect(state.boxesSubmitted).toBe(true);
    anchorOf('procedure');
  });
});

describe('the home part of the tour', () => {
  it('points at the Test card', () => {
    expect(HOME_TOUR[0]?.anchor).toBe('home-test');
  });
});
