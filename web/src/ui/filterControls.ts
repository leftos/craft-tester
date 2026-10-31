import type { AirportData } from '@/data/schema.ts';
import type { ConfigFilter, ScenarioFilter, TimeFilter } from '@/scenario/filter.ts';
import { selectControl } from '@/ui/dom.ts';
import type { SelectOption } from '@/ui/dom.ts';

/** The time-of-day choices, in the order the dropdown offers them. */
const TIME_OPTIONS: readonly (SelectOption & { value: TimeFilter })[] = [
  { value: 'either', label: 'Either' },
  { value: 'day', label: 'Day' },
  { value: 'night', label: 'Night' },
];

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
 * @returns The Runway dropdown.
 */
export function runwayGradingControl(
  graded: boolean,
  onChange: (graded: boolean) => void,
): HTMLElement {
  return selectControl(
    {
      label: 'Runway',
      options: RUNWAY_GRADING_OPTIONS,
      value: graded ? 'graded' : 'off',
      disabled: false,
      placeholder: '—',
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
 * @returns The time dropdown, then the configuration dropdown.
 */
export function filterControls(
  filter: ScenarioFilter,
  airport: AirportData,
  onFilter: (filter: ScenarioFilter) => void,
): HTMLElement[] {
  return [
    selectControl(
      {
        label: 'time of day',
        options: TIME_OPTIONS,
        value: filter.time,
        disabled: false,
        placeholder: '—',
      },
      (raw) => {
        const time = TIME_OPTIONS.find((option) => option.value === raw)?.value ?? 'either';
        onFilter({ ...filter, time });
      },
    ),
    selectControl(
      {
        label: 'runway configuration',
        options: configOptions(airport),
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
