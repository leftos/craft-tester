import type { AirportData, Scenario } from '@/data/schema.ts';
import { altitudeLabel, expectChoiceLabel, formatFeet, routeLabel } from '@/rules/grade.ts';
import { buildOptions } from '@/rules/options.ts';
import type { ClearanceOptions } from '@/rules/options.ts';
import type { ClearanceElement, ResolvedClearance } from '@/rules/types.ts';
import type { SelectOption, SelectSpec } from '@/ui/dom.ts';
import { button, el, selectControl } from '@/ui/dom.ts';
import { elementLabel } from '@/ui/labels.ts';
import type { DraftPicks, PickKey } from '@/ui/state.ts';
import { toPlayerPicks } from '@/ui/state.ts';

/** The blank choice every dropdown opens on. */
const PLACEHOLDER = '—';

/** One dropdown of the form, and the pick it sets. */
export type CraftField = SelectSpec & { key: PickKey };

/**
 * One row of the form: an element the player answers, or one the clearance already settles.
 *
 * A `given` row is shown so the student reads the whole clearance in CRAFT order; it is neither
 * picked nor graded, because the engine resolves it and the reveal speaks it.
 */
export type CraftGroup =
  | { kind: 'picked'; element: ClearanceElement; fields: readonly CraftField[] }
  | { kind: 'given'; heading: string; value: string };

/** A row of dropdowns, which is what every group builder here returns. */
type PickedGroup = Extract<CraftGroup, { kind: 'picked' }>;

/** Everything the form needs to render and to report back. */
export type CraftFormProps = {
  scenario: Scenario;
  airport: AirportData;
  clearance: ResolvedClearance;
  picks: DraftPicks;
  onPick: (key: PickKey, raw: string) => void;
  onSubmit: () => void;
};

/** A dropdown whose choices are their own labels, e.g. a list of destinations. */
function plainOptions(values: readonly string[]): SelectOption[] {
  return values.map((value) => ({ value, label: value }));
}

/**
 * The route: the shape of the element, and the fix or airway the shape names.
 *
 * The element dropdown stays disabled until the shape is picked; the elements on offer are the
 * transitions of the filed procedure together with the first fixes of the filed route.
 */
function routeGroup(options: ClearanceOptions, picks: DraftPicks): PickedGroup {
  return {
    kind: 'picked',
    element: 'R.route',
    fields: [
      {
        key: 'routeTemplate',
        label: 'shape',
        options: options.routeTemplates.map((template) => ({
          value: template,
          label: routeLabel({ template }),
        })),
        value: picks.routeTemplate,
        disabled: false,
        placeholder: PLACEHOLDER,
      },
      {
        key: 'routeFix',
        label: 'fix or airway',
        options: plainOptions(options.routeFixes),
        value: picks.routeFix,
        disabled: picks.routeTemplate === undefined,
        placeholder: PLACEHOLDER,
      },
    ],
  };
}

/** The altitude: the phrase, and the feet every phrase but "climb via SID" speaks. */
function altitudeGroup(options: ClearanceOptions, picks: DraftPicks): PickedGroup {
  return {
    kind: 'picked',
    element: 'A.phrase',
    fields: [
      {
        key: 'altitudePhrase',
        label: 'phrase',
        options: options.altitudePhrases.map((phrase) => ({
          value: phrase,
          label: altitudeLabel({ phrase }),
        })),
        value: picks.altitudePhrase,
        disabled: false,
        placeholder: PLACEHOLDER,
      },
      {
        key: 'altitudeFeet',
        label: 'altitude',
        options: options.altitudeFeet.map((feet) => ({
          value: String(feet),
          label: formatFeet(feet),
        })),
        value: picks.altitudeFeet === undefined ? undefined : String(picks.altitudeFeet),
        disabled: picks.altitudePhrase === undefined || picks.altitudePhrase === 'climb_via',
        placeholder: PLACEHOLDER,
      },
    ],
  };
}

/** The expect clause, which the filed altitude fills in once the delay is picked. */
function expectGroup(options: ClearanceOptions, picks: DraftPicks): PickedGroup {
  return {
    kind: 'picked',
    element: 'A.expect',
    fields: [
      {
        key: 'expect',
        label: 'expect clause',
        options: options.expect.map((choice) => ({
          value: choice,
          label: expectChoiceLabel(choice),
        })),
        value: picks.expect,
        disabled: false,
        placeholder: PLACEHOLDER,
      },
    ],
  };
}

/** The departure frequency, each choice named by the sector the data labels it with. */
function frequencyGroup(
  options: ClearanceOptions,
  airport: AirportData,
  picks: DraftPicks,
): PickedGroup {
  return {
    kind: 'picked',
    element: 'F',
    fields: [
      {
        key: 'frequency',
        label: 'departure frequency',
        options: options.frequencies.map((value) => {
          const label = airport.frequencies.find((row) => row.value === value)?.label;
          return { value, label: label === undefined ? value : `${value} — ${label}` };
        }),
        value: picks.frequency,
        disabled: false,
        placeholder: PLACEHOLDER,
      },
    ],
  };
}

/** The runway the flight expects, which is every runway its configuration departs. */
function runwayGroup(options: ClearanceOptions, picks: DraftPicks): PickedGroup {
  return {
    kind: 'picked',
    element: 'RWY',
    fields: [
      {
        key: 'runway',
        label: 'expect runway',
        options: plainOptions(options.runways),
        value: picks.runway,
        disabled: false,
        placeholder: PLACEHOLDER,
      },
    ],
  };
}

/** The clearance limit: the destination's identifier, with its spoken name when the data has one. */
function clearanceLimitRow(clearance: ResolvedClearance, airport: AirportData): CraftGroup {
  const icao = clearance.clearedTo.value;
  const spoken = airport.routeLibrary.destinations.find((row) => row.icao === icao)?.spoken;
  return {
    kind: 'given',
    heading: 'C — clearance limit',
    value: spoken === undefined ? icao : `${icao} — ${spoken}`,
  };
}

/** The assigned procedure, named as the chart names it, falling back to its identifier. */
function procedureRow(clearance: ResolvedClearance, airport: AirportData): CraftGroup {
  const id = clearance.sid.value.id;
  return {
    kind: 'given',
    heading: elementLabel('R.sid'),
    value: airport.sids.find((sid) => sid.id === id)?.chartName ?? id,
  };
}

/**
 * Builds the eight rows of the form, the five of them the player answers the clearance with.
 *
 * The clearance limit, the procedure and the squawk are given rows: the engine resolved them and
 * the reveal speaks them, and they sit in their CRAFT positions so the whole clearance reads in
 * order.
 *
 * @param scenario The scenario being cleared, which contributes the filed route, altitude and squawk.
 * @param airport The airport data.
 * @param clearance The clearance the engine resolved, which fills the given rows.
 * @param picks What the player has picked so far, which settles the dependent dropdowns.
 * @returns The rows, in the order CRAFT speaks them.
 */
export function craftGroups(
  scenario: Scenario,
  airport: AirportData,
  clearance: ResolvedClearance,
  picks: DraftPicks,
): readonly CraftGroup[] {
  const options = buildOptions(scenario, airport);
  return [
    clearanceLimitRow(clearance, airport),
    procedureRow(clearance, airport),
    routeGroup(options, picks),
    altitudeGroup(options, picks),
    expectGroup(options, picks),
    frequencyGroup(options, airport, picks),
    { kind: 'given', heading: 'T — transponder', value: scenario.squawk },
    runwayGroup(options, picks),
  ];
}

/** One row of the form: its heading, and then its dropdowns or the value the clearance settles. */
function renderGroup(group: CraftGroup, onPick: CraftFormProps['onPick']): HTMLElement {
  const row = el('div', 'craft-group');
  if (group.kind === 'given') {
    row.append(el('h3', '', group.heading), el('div', 'craft-given', group.value));
    return row;
  }
  row.append(el('h3', '', elementLabel(group.element)));
  for (const field of group.fields) {
    row.append(
      selectControl(field, (value) => {
        onPick(field.key, value);
      }),
    );
  }
  return row;
}

/**
 * Renders the CRAFT form.
 *
 * @param props The scenario, the airport, the resolved clearance, the picks so far, and the
 *   handlers for change and submit.
 * @returns The form panel; its submit button is disabled while a required dropdown is blank.
 */
export function renderCraftForm(props: CraftFormProps): HTMLElement {
  const panel = el('section', 'panel craft');
  panel.append(el('h2', '', 'Your clearance'));
  for (const group of craftGroups(props.scenario, props.airport, props.clearance, props.picks)) {
    panel.append(renderGroup(group, props.onPick));
  }
  const submit = button('Submit clearance', 'primary', props.onSubmit);
  submit.disabled = toPlayerPicks(props.picks) === undefined;
  panel.append(submit);
  return panel;
}
