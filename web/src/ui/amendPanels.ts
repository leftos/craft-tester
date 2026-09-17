import type { AirportData, Scenario } from '@/data/schema.ts';
import type { Box, BoxAnswer, BoxAnswers } from '@/rules/amend/grade.ts';
import { boxGradeAsGrade, gradeBoxes } from '@/rules/amend/grade.ts';
import { grade, gradeProcedure } from '@/rules/grade.ts';
import { isSidToken } from '@/rules/route.ts';
import type { Grade, ResolvedClearance } from '@/rules/types.ts';
import type { AmendmentScenario } from '@/scenario/amend.ts';
import type { AmendFormProps } from '@/ui/amendForm.ts';
import { renderAmendForm, renderBoxVerdicts } from '@/ui/amendForm.ts';
import { renderAtis } from '@/ui/atis.ts';
import type { CraftFormProps } from '@/ui/craftForm.ts';
import { renderCraftForm } from '@/ui/craftForm.ts';
import { renderResults, renderRevisit } from '@/ui/results.ts';
import { spokenFor } from '@/ui/session.ts';
import type { ScenarioView } from '@/ui/session.ts';
import type { AmendmentPicks, AppState, PickKey } from '@/ui/state.ts';
import { phaseOf, toAmendmentPicks, toBoxAnswers } from '@/ui/state.ts';
import { renderStrip } from '@/ui/strip.ts';

/** The view an amendment session renders from. */
type AmendmentView = Extract<ScenarioView, { kind: 'amendment' }>;

/**
 * A built panel set: the panels on screen, and how to write a later state of the same phase into
 * them.
 *
 * A set whose panels are all read-only — an earlier attempt, the verdicts — syncs nothing, because
 * nothing on it answers to a state the phase still allows to change.
 */
export type Panels = { nodes: HTMLElement[]; sync: ((state: AppState) => void) | undefined };

/** What the amendment panels call back into. */
export type AmendmentHandlers = {
  onBox: (box: Box, answer: BoxAnswer) => void;
  onBoxesSubmit: () => void;
  onNewScenario: () => void;
  onPick: (key: PickKey, raw: string) => void;
  onRetry: () => void;
  onSubmit: () => void;
};

/**
 * The SID a corrected plan files, which is the procedure the clearance then assigns.
 *
 * @param scenario The plan the clearance is read for.
 * @param airport The airport data, which names the published procedures.
 * @returns The identifier of the leading procedure, or `undefined` where the route files none the
 *   airport publishes.
 */
export function procedureOf(scenario: Scenario, airport: AirportData): string | undefined {
  const token = scenario.filedRoute.split(/\s+/)[0];
  if (token === undefined || !isSidToken(token)) return undefined;
  return airport.sids.some((sid) => sid.id === token) ? token : undefined;
}

/**
 * Every verdict an amendment session earns, in the order it answered them.
 *
 * The three strip boxes come first, then the procedure the corrected plan assigns, then the rest of
 * the clearance, so one score line covers the whole session.
 *
 * @param drawn The plan as filed, with the amendments the engine raised for it.
 * @param clearance The clearance the engine resolved for the corrected plan.
 * @param airport The airport data.
 * @param answers What the student answered for every box.
 * @param picks What the student cleared the corrected plan with.
 * @returns The box verdicts followed by the clearance verdicts.
 */
export function amendmentGrades(
  drawn: AmendmentScenario,
  clearance: ResolvedClearance,
  airport: AirportData,
  answers: BoxAnswers,
  picks: AmendmentPicks,
): Grade[] {
  return [
    ...gradeBoxes(answers, drawn.result, drawn.filed, airport).map(boxGradeAsGrade),
    gradeProcedure(picks.procedure, clearance, airport),
    ...grade(picks, clearance),
  ];
}

/** The strip and the ATIS of the plan as filed, with the earlier attempt behind a spoiler. */
function revisitPanels(
  state: AppState,
  view: AmendmentView,
  handlers: AmendmentHandlers,
  attempt: Extract<AppState['revisit'], { kind: 'amendment' }>,
): Panels {
  const { drawn, clearance } = view;
  return {
    nodes: [
      renderStrip(drawn.filed, state.airport, state.seed, 'Flight plan'),
      renderAtis(drawn.filed, state.airport),
      renderRevisit({
        grades: amendmentGrades(drawn, clearance, state.airport, attempt.boxes, attempt.picks),
        spoken: spokenFor(drawn.result.corrected, drawn.filed, clearance, state.airport),
        onNext: handlers.onNewScenario,
        onRetry: handlers.onRetry,
      }),
    ],
    sync: undefined,
  };
}

/**
 * The strip as filed beside the ATIS, with the boxes to answer in their own panel under both.
 *
 * The strip is read-only paper, so every box it prints is answered in the panel below rather than
 * on the strip itself, where the boxes take the full width and a route reads without wrapping.
 */
function amendingPanels(state: AppState, view: AmendmentView, handlers: AmendmentHandlers): Panels {
  const props = (next: AppState): AmendFormProps => ({
    scenario: view.drawn.filed,
    boxes: next.boxes,
    onBox: handlers.onBox,
    onSubmit: handlers.onBoxesSubmit,
  });
  const form = renderAmendForm(props(state));
  return {
    nodes: [
      renderStrip(view.drawn.filed, state.airport, state.seed, 'Flight plan'),
      renderAtis(view.drawn.filed, state.airport),
      form.node,
    ],
    sync: (next) => {
      form.sync(props(next));
    },
  };
}

/** Both strips with the box verdicts between them, the ATIS, and the form for the corrected plan. */
function clearingPanels(
  state: AppState,
  view: AmendmentView,
  handlers: AmendmentHandlers,
  answers: BoxAnswers,
): Panels {
  const corrected = view.drawn.result.corrected;
  const props = (next: AppState): CraftFormProps => ({
    scenario: corrected,
    airport: next.airport,
    clearance: view.clearance,
    picks: next.picks,
    procedure: 'picked',
    onPick: handlers.onPick,
    onSubmit: handlers.onSubmit,
  });
  const form = renderCraftForm(props(state));
  return {
    nodes: [
      renderStrip(view.drawn.filed, state.airport, state.seed, 'Flight plan as filed'),
      renderBoxVerdicts(
        gradeBoxes(answers, view.drawn.result, view.drawn.filed, state.airport).map(
          boxGradeAsGrade,
        ),
      ),
      renderStrip(corrected, state.airport, state.seed, 'Amended flight plan', 1),
      renderAtis(corrected, state.airport),
      form.node,
    ],
    sync: (next) => {
      form.sync(props(next));
    },
  };
}

/** Both strips, the ATIS of the corrected plan, and the verdicts for the whole session. */
function resultPanels(
  state: AppState,
  view: AmendmentView,
  handlers: AmendmentHandlers,
  answers: BoxAnswers,
  picks: AmendmentPicks,
): Panels {
  const { drawn, clearance } = view;
  const corrected = drawn.result.corrected;
  return {
    nodes: [
      renderStrip(drawn.filed, state.airport, state.seed, 'Flight plan as filed'),
      renderStrip(corrected, state.airport, state.seed, 'Amended flight plan', 1),
      renderAtis(corrected, state.airport),
      renderResults({
        grades: amendmentGrades(drawn, clearance, state.airport, answers, picks),
        spoken: spokenFor(corrected, view.drawn.filed, clearance, state.airport),
        onNext: handlers.onNewScenario,
        onRetry: handlers.onRetry,
      }),
    ],
    sync: undefined,
  };
}

/**
 * The panels of an amendment session, which answers the strip first and the clearance after it.
 *
 * @param state The state the page renders from.
 * @param view The plan to amend, and the clearance its corrected form earns.
 * @param handlers What the panels call back into.
 * @returns The panels, in the order the page lays them out, with the sync of the form among them.
 */
export function renderAmendmentPanels(
  state: AppState,
  view: AmendmentView,
  handlers: AmendmentHandlers,
): Panels {
  const phase = phaseOf(state);
  const revisit = state.revisit;
  if (phase === 'amendment-revisit' && revisit?.kind === 'amendment') {
    return revisitPanels(state, view, handlers, revisit);
  }
  const answers = toBoxAnswers(state.boxes);
  if (phase === 'amending' || answers === undefined) {
    return amendingPanels(state, view, handlers);
  }
  const picks = toAmendmentPicks(state.picks);
  if (phase === 'clearing' || picks === undefined) {
    return clearingPanels(state, view, handlers, answers);
  }
  return resultPanels(state, view, handlers, answers, picks);
}
