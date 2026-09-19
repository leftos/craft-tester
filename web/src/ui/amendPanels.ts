import type { AirportData, Scenario } from '@/data/schema.ts';
import type { Box, BoxAnswer, BoxAnswers } from '@/rules/amend/grade.ts';
import { boxGradeAsGrade, gradeBoxes } from '@/rules/amend/grade.ts';
import { grade, gradeProcedure } from '@/rules/grade.ts';
import { isSidToken } from '@/rules/route.ts';
import type { RouteReading, TextGrade } from '@/rules/text/grade.ts';
import { gradeText } from '@/rules/text/grade.ts';
import type { Grade } from '@/rules/types.ts';
import type { AmendmentScenario } from '@/scenario/amend.ts';
import type { AmendFormProps } from '@/ui/amendForm.ts';
import { renderAmendForm, renderBoxVerdicts } from '@/ui/amendForm.ts';
import { renderAtis } from '@/ui/atis.ts';
import type { CraftFormProps } from '@/ui/craftForm.ts';
import { renderCraftForm } from '@/ui/craftForm.ts';
import { renderResults, renderRevisit } from '@/ui/results.ts';
import { clearedPlan, spokenFor } from '@/ui/session.ts';
import type { ClearedPlan, ScenarioView } from '@/ui/session.ts';
import type { AmendmentPicks, AppState, ClearanceAnswer, PickKey } from '@/ui/state.ts';
import { phaseOf, toAmendmentAnswer, toBoxAnswers } from '@/ui/state.ts';
import { renderStrip } from '@/ui/strip.ts';
import type { TextFormProps } from '@/ui/textForm.ts';
import { renderTextForm } from '@/ui/textForm.ts';

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
  onText: (text: string) => void;
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
 * Everything an amendment session's verdicts are read from: the plan as filed with the amendments
 * it earned, the plan the student cleared, the airport, the box answers, the clearance they gave,
 * and the reading their typed clearance is held to.
 */
export type AmendmentAnswer = {
  drawn: AmendmentScenario;
  cleared: ClearedPlan;
  airport: AirportData;
  answers: BoxAnswers;
  answer: ClearanceAnswer<AmendmentPicks>;
  routeReading: RouteReading;
};

/**
 * Every verdict an amendment session earns, in the order it answered them.
 *
 * The three strip boxes come first, then the procedure the cleared plan assigns, then the rest of
 * the clearance, so one score line covers the whole session. The clearance is graded against the
 * plan the student cleared: every box they got right as they wrote it, every other box as the
 * engine corrected it. A typed clearance is graded against the engine's reading of that plan, under
 * the reading the student is held to, and the procedure it speaks takes the place of the procedure
 * pick.
 *
 * @param session The plans, the airport, the answers and the reading the clearance is held to.
 * @returns The box verdicts followed by the clearance verdicts.
 */
export function amendmentGrades(session: AmendmentAnswer): (Grade | TextGrade)[] {
  const { drawn, cleared, airport, answers, answer, routeReading } = session;
  const boxes = gradeBoxes(answers, drawn.result, drawn.filed, airport).map(boxGradeAsGrade);
  const { clearance } = cleared;
  if (answer.input === 'text') {
    const spoken = spokenFor(cleared.plan, drawn.filed, clearance, airport);
    return [...boxes, ...gradeText(answer.text, spoken, clearance, airport, routeReading)];
  }
  const { picks } = answer;
  return [
    ...boxes,
    gradeProcedure(picks.procedure, clearance, airport),
    ...grade(picks, clearance),
  ];
}

/**
 * The strip and the ATIS of the plan as filed, with the earlier attempt behind a spoiler, graded
 * against the plan that attempt's boxes cleared.
 */
function revisitPanels(
  state: AppState,
  view: AmendmentView,
  handlers: AmendmentHandlers,
  attempt: Extract<AppState['revisit'], { kind: 'amendment' }>,
): Panels {
  const { drawn } = view;
  const cleared = clearedPlan(view, attempt.boxes, state.airport);
  return {
    nodes: [
      renderStrip(drawn.filed, state.airport, state.seed, 'Flight plan'),
      renderAtis(drawn.filed, state.airport),
      renderRevisit({
        grades: amendmentGrades({
          drawn,
          cleared,
          airport: state.airport,
          answers: attempt.boxes,
          answer: attempt,
          routeReading: state.fullRoute ? 'full' : 'abbreviated',
        }),
        spoken: spokenFor(cleared.plan, drawn.filed, cleared.clearance, state.airport),
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

/** The answer form of a corrected plan: the node on screen, and how to write a later state into it. */
type ClearingForm = { node: HTMLElement; sync: (state: AppState) => void };

/**
 * The form the student's corrected plan is cleared in: the typing box where the student types the
 * clearance out, and otherwise the CRAFT dropdowns with the procedure among the picks.
 */
function renderClearingForm(
  state: AppState,
  cleared: ClearedPlan,
  handlers: AmendmentHandlers,
): ClearingForm {
  if (state.input === 'text') {
    const typed = (next: AppState): TextFormProps => ({
      text: next.text,
      onText: handlers.onText,
      onSubmit: handlers.onSubmit,
    });
    const form = renderTextForm(typed(state));
    return { node: form.node, sync: (next) => form.sync(typed(next)) };
  }
  const picked = (next: AppState): CraftFormProps => ({
    scenario: cleared.plan,
    airport: next.airport,
    clearance: cleared.clearance,
    picks: next.picks,
    procedure: 'picked',
    onPick: handlers.onPick,
    onSubmit: handlers.onSubmit,
  });
  const form = renderCraftForm(picked(state));
  return { node: form.node, sync: (next) => form.sync(picked(next)) };
}

/**
 * Both strips with the box verdicts between them, the ATIS, and the form for the plan the student
 * clears: every box they got right as they wrote it, every other box as the engine corrected it.
 */
function clearingPanels(
  state: AppState,
  view: AmendmentView,
  handlers: AmendmentHandlers,
  answers: BoxAnswers,
): Panels {
  const cleared = clearedPlan(view, answers, state.airport);
  const form = renderClearingForm(state, cleared, handlers);
  return {
    nodes: [
      renderStrip(view.drawn.filed, state.airport, state.seed, 'Flight plan as filed'),
      renderBoxVerdicts(
        gradeBoxes(answers, view.drawn.result, view.drawn.filed, state.airport).map(
          boxGradeAsGrade,
        ),
      ),
      renderStrip(cleared.plan, state.airport, state.seed, 'Amended flight plan', 1),
      renderAtis(cleared.plan, state.airport),
      form.node,
    ],
    sync: form.sync,
  };
}

/**
 * Both strips, the ATIS of the plan the student cleared, and the verdicts for the whole session,
 * the clearance graded against that plan.
 */
function resultPanels(
  state: AppState,
  view: AmendmentView,
  handlers: AmendmentHandlers,
  answers: BoxAnswers,
  answer: ClearanceAnswer<AmendmentPicks>,
): Panels {
  const { drawn } = view;
  const cleared = clearedPlan(view, answers, state.airport);
  return {
    nodes: [
      renderStrip(drawn.filed, state.airport, state.seed, 'Flight plan as filed'),
      renderStrip(cleared.plan, state.airport, state.seed, 'Amended flight plan', 1),
      renderAtis(cleared.plan, state.airport),
      renderResults({
        grades: amendmentGrades({
          drawn,
          cleared,
          airport: state.airport,
          answers,
          answer,
          routeReading: state.fullRoute ? 'full' : 'abbreviated',
        }),
        spoken: spokenFor(cleared.plan, drawn.filed, cleared.clearance, state.airport),
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
  const answer = toAmendmentAnswer(state);
  if (phase === 'clearing' || answer === undefined) {
    return clearingPanels(state, view, handlers, answers);
  }
  return resultPanels(state, view, handlers, answers, answer);
}
