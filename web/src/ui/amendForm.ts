import type { Scenario } from '@/data/schema.ts';
import type { Box, BoxAnswer } from '@/rules/amend/grade.ts';
import { formatAltitude } from '@/rules/grade.ts';
import type { Grade } from '@/rules/types.ts';
import type { SelectOption } from '@/ui/dom.ts';
import { button, el, selectControl, textControl } from '@/ui/dom.ts';
import { aircraftLabel } from '@/ui/labels.ts';
import { renderVerdict, scoreLine } from '@/ui/results.ts';
import type { DraftBoxes } from '@/ui/state.ts';
import { toBoxAnswers } from '@/ui/state.ts';

/** The blank choice the answer dropdown opens on. */
const PLACEHOLDER = '—';

/** The boxes the student answers, in the order the strip prints them. */
const ANSWERABLE: readonly Box[] = ['type', 'altitude', 'route'];

/** The two things the student can do with a box. */
const ANSWER_OPTIONS: readonly SelectOption[] = [
  { value: 'as_filed', label: 'correct as filed' },
  { value: 'amended', label: 'amend to' },
];

/** One answerable box: what it is, what the pilot filed in it, and what the student answered. */
export type BoxRow = {
  box: Box;
  label: string;
  filed: string;
  answer: BoxAnswer | undefined;
};

/** Everything the amend form needs to render and to report back. */
export type AmendFormProps = {
  scenario: Scenario;
  boxes: DraftBoxes;
  onBox: (box: Box, answer: BoxAnswer) => void;
  onSubmit: () => void;
};

/** The value one answerable box reads as filed, written the way the strip writes it. */
function filedValue(scenario: Scenario, box: Box): string {
  if (box === 'type') return aircraftLabel(scenario.aircraftType, scenario.equipmentSuffix);
  if (box === 'altitude') return formatAltitude(scenario.filedAltitude);
  return scenario.filedRoute;
}

/**
 * The three boxes of the strip the student answers, in strip order.
 *
 * @param scenario The plan as filed, which the boxes read the filed values from.
 * @param boxes What the student has answered so far.
 * @returns One row per answerable box: type, altitude, route.
 */
export function boxRows(scenario: Scenario, boxes: DraftBoxes): BoxRow[] {
  return ANSWERABLE.map((box) => ({
    box,
    label: box,
    filed: filedValue(scenario, box),
    answer: boxes[box],
  }));
}

/**
 * Whether the strip still has a box to answer before it can be submitted.
 *
 * @param boxes What the student has answered so far.
 * @returns True while a box is unanswered or amended to nothing.
 */
export function amendSubmitDisabled(boxes: DraftBoxes): boolean {
  return toBoxAnswers(boxes) === undefined;
}

/**
 * The answer one dropdown choice stands for.
 *
 * Choosing "amend to" on a box nobody has typed in starts the box holding the filed value, so the
 * student edits it in place rather than writing the whole box out again, and deletes it to write
 * from scratch. A box the student has already typed in keeps whatever they left in it, the empty
 * string included, so picking "amend to" again after a detour through "correct as filed" does not
 * throw the typed value away.
 *
 * @param raw The dropdown choice the student made.
 * @param answer What the box already held, which is nothing while the box is unanswered.
 * @param filed The box as the pilot filed it, written the way the strip writes it.
 * @returns The answer the choice stands for, or `undefined` for the blank choice.
 */
export function answerFor(
  raw: string,
  answer: BoxAnswer | undefined,
  filed: string,
): BoxAnswer | undefined {
  if (raw === 'as_filed') return { kind: 'as_filed' };
  if (raw !== 'amended') return undefined;
  return { kind: 'amended', value: answer?.kind === 'amended' ? answer.value : filed };
}

/** What the student typed into a box, which is nothing at all while the box is not amended. */
function typedValue(answer: BoxAnswer | undefined): string {
  return answer?.kind === 'amended' ? answer.value : '';
}

/**
 * The name the text box of one answerable box carries, which is what focus is restored by.
 *
 * @param box The box the text box amends.
 * @returns The name attribute of that box's text box, unique within the page.
 */
export function boxInputName(box: Box): string {
  return `amend-${box}`;
}

/** The text box the student writes a new value in, marked apart from the answer dropdown. */
function renderValueBox(row: BoxRow, onBox: AmendFormProps['onBox']): HTMLElement {
  const field = textControl(
    {
      label: 'new value',
      name: boxInputName(row.box),
      value: typedValue(row.answer),
      disabled: row.answer?.kind !== 'amended',
      placeholder: row.filed,
    },
    (value) => {
      onBox(row.box, { kind: 'amended', value });
    },
  );
  field.classList.add('amend-value');
  return field;
}

/** One box the student answers: its name, the filed value, the answer, and the value it amends to. */
function renderBox(row: BoxRow, onBox: AmendFormProps['onBox']): HTMLElement {
  const node = el('div', `amend-box ${row.box}`);
  node.append(
    el('h3', '', row.label),
    el('div', 'amend-filed', row.filed),
    selectControl(
      {
        label: 'answer',
        options: ANSWER_OPTIONS,
        value: row.answer?.kind,
        disabled: false,
        placeholder: PLACEHOLDER,
      },
      (raw) => {
        const answer = answerFor(raw, row.answer, row.filed);
        if (answer !== undefined) onBox(row.box, answer);
      },
    ),
    renderValueBox(row, onBox),
  );
  return node;
}

/**
 * Renders the three boxes the student answers before the clearance is read.
 *
 * The strip beside the form is read-only paper, so the form asks for the three boxes in full
 * rather than leaving part of the plan to be edited in place.
 *
 * @param props The plan as filed, the answers so far, and the handlers for answer and submit.
 * @returns The amend panel; its submit button is disabled while a box is still open.
 */
export function renderAmendForm(props: AmendFormProps): HTMLElement {
  const panel = el('section', 'panel amend');
  panel.append(el('h2', '', 'Amend the flight plan'));
  for (const row of boxRows(props.scenario, props.boxes)) {
    panel.append(renderBox(row, props.onBox));
  }
  const submit = button('Submit amendments', 'primary', props.onSubmit);
  submit.disabled = amendSubmitDisabled(props.boxes);
  panel.append(submit);
  return panel;
}

/**
 * Renders the verdicts for the three boxes, which the student sees before clearing the plan.
 *
 * @param grades The verdict for every box, read as a verdict on a clearance element.
 * @returns The panel of box verdicts, with the count of the boxes answered right.
 */
export function renderBoxVerdicts(grades: readonly Grade[]): HTMLElement {
  const panel = el('section', 'panel results');
  panel.append(
    el('h2', '', 'Amendments'),
    ...grades.map((verdict) => renderVerdict(verdict)),
    el('p', 'score', scoreLine(grades, 'boxes')),
  );
  return panel;
}
