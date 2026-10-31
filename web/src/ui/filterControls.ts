import type { AirportData, Training } from '@/data/schema.ts';
import type { ConfigFilter, ScenarioFilter, TimeFilter } from '@/scenario/filter.ts';
import { configLock, isOpenAt } from '@/scenario/stage.ts';
import { selectControl, selectOf } from '@/ui/dom.ts';
import type { SelectOption } from '@/ui/dom.ts';

/** The time-of-day choices, in the order the dropdown offers them. */
const TIME_OPTIONS: readonly (SelectOption & { value: TimeFilter })[] = [
  { value: 'either', label: 'Either' },
  { value: 'day', label: 'Day' },
  { value: 'night', label: 'Night' },
];

/**
 * The stage a closed thing waits for.
 *
 * @param training The airport's training section.
 * @param at The stage the thing is locked at, or `undefined` when nothing locks it.
 * @param stage The viewer's stage.
 * @returns `at` while the viewer's stage has not reached it, else `undefined`.
 */
export function closedUntil(
  training: Training,
  at: string | undefined,
  stage: string | undefined,
): string | undefined {
  return isOpenAt(training, at, stage) ? undefined : at;
}

/**
 * A choice as a viewer's stage offers it.
 *
 * @param option The choice.
 * @param training The airport's training section.
 * @param at The stage the choice is locked at, or `undefined` when nothing locks it.
 * @param stage The viewer's stage.
 * @returns The choice, carrying `locked` while the viewer's stage has not reached `at`.
 */
export function stagedOption<Option extends { locked?: string }>(
  option: Option,
  training: Training,
  at: string | undefined,
  stage: string | undefined,
): Option {
  const locked = closedUntil(training, at, stage);
  return locked === undefined ? option : { ...option, locked };
}

/** The time-of-day choices at a stage: Day stays open, and the rest wait for night to open. */
function timeOptions(training: Training, stage: string | undefined): SelectOption[] {
  return TIME_OPTIONS.map((option) =>
    option.value === 'day' ? option : stagedOption(option, training, training.course.night, stage),
  );
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

/** The stage a plan opens at: the earliest of its configurations, or none when one is unlocked. */
function planLock(airport: AirportData, plan: string): string | undefined {
  const { training, runwayConfigs } = airport;
  const locks = runwayConfigs
    .filter((config) => config.plan === plan)
    .map((config) => configLock(training, config));
  if (locks.includes(undefined)) return undefined;
  return training.stages.find((entry) => locks.includes(entry.id))?.id;
}

/**
 * Every configuration choice: all of them, each plan of them, then each configuration by name, with
 * Any always open and the others locked until the stage opens them.
 */
function configOptions(airport: AirportData, stage: string | undefined): SelectOption[] {
  const { training, runwayConfigs } = airport;
  const plans = [...new Set(runwayConfigs.map((config) => config.plan))];
  return [
    { value: 'any', label: 'Any' },
    ...plans.map((plan) => {
      const option: SelectOption = { value: `plan:${plan}`, label: `Any ${plan}` };
      return stagedOption(option, training, planLock(airport, plan), stage);
    }),
    ...runwayConfigs.map((config) => {
      const option: SelectOption = {
        value: `id:${config.id}`,
        label: `${config.id} — ${config.name}`,
      };
      return stagedOption(option, training, configLock(training, config), stage);
    }),
  ];
}

/** The runway grading choices, in the order the dropdown offers them. */
const RUNWAY_GRADING_OPTIONS: readonly SelectOption[] = [
  { value: 'graded', label: 'Graded' },
  { value: 'off', label: 'Not graded' },
];

/**
 * The dropdown that turns runway grading on or off, which sits after the filters.
 *
 * @param graded Whether the runway is graded now.
 * @param onChange Called with whether the runway is graded after the dropdown changes.
 * @param locked The stage that opens runway grading, where the viewer's has not: Graded is locked at
 *   it and its blank choice, which reads as Graded, is locked too.
 * @returns The Runway dropdown.
 */
export function runwayGradingControl(
  graded: boolean,
  onChange: (graded: boolean) => void,
  locked: string | undefined,
): HTMLElement {
  const options =
    locked === undefined
      ? RUNWAY_GRADING_OPTIONS
      : RUNWAY_GRADING_OPTIONS.map((option) =>
          option.value === 'graded' ? { ...option, locked } : option,
        );
  return selectControl(
    {
      label: 'Runway',
      options,
      value: graded ? 'graded' : 'off',
      disabled: false,
      placeholder: '—',
      placeholderLocked: locked !== undefined,
    },
    (raw) => {
      onChange(raw !== 'off');
    },
  );
}

/**
 * The two dropdowns that narrow the draw: the time of day and the runway configuration.
 *
 * @param filter The filter the dropdowns show; every other member of it survives a change.
 * @param airport The airport whose configurations the second dropdown offers.
 * @param onFilter Called with the whole filter after either dropdown changes.
 * @param stage The viewer's stage, whose locks the dropdowns show.
 * @returns The time dropdown, then the configuration dropdown.
 */
export function filterControls(
  filter: ScenarioFilter,
  airport: AirportData,
  onFilter: (filter: ScenarioFilter) => void,
  stage: string | undefined,
): HTMLElement[] {
  const { training } = airport;
  return [
    selectControl(
      {
        label: 'time of day',
        options: timeOptions(training, stage),
        value: filter.time,
        disabled: false,
        placeholder: '—',
        placeholderLocked: closedUntil(training, training.course.night, stage) !== undefined,
      },
      (raw) => {
        const time = TIME_OPTIONS.find((option) => option.value === raw)?.value ?? 'either';
        onFilter({ ...filter, time });
      },
    ),
    selectControl(
      {
        label: 'runway configuration',
        options: configOptions(airport, stage),
        value: configValue(filter.config),
        disabled: false,
        placeholder: '—',
      },
      (raw) => {
        onFilter({ ...filter, config: configFromValue(raw) });
      },
    ),
  ];
}

/**
 * The dropdown that picks the training stage a viewer works at.
 *
 * @param training The training section of any airport: every file lists the same course.
 * @param stage The viewer's stage; one the course does not list shows as All topics.
 * @param onChange Called with the stage picked, `undefined` for All topics.
 * @returns The Training dropdown.
 */
export function stageControl(
  training: Training,
  stage: string | undefined,
  onChange: (stage: string | undefined) => void,
): HTMLElement {
  const { stages } = training;
  const field = selectControl(
    {
      label: 'Training',
      options: stages.map(({ id, title }) => ({ value: id, label: `${id} ${title}` })),
      value: stages.some((entry) => entry.id === stage) ? stage : undefined,
      disabled: false,
      placeholder: 'All topics',
    },
    (raw) => {
      onChange(raw === '' ? undefined : raw);
    },
  );
  selectOf(field).setAttribute('data-focus-key', 'Training');
  return field;
}
