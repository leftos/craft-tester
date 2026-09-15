import type { AirportData, Scenario } from '@/data/schema.ts';
import { altitudeLabel, expectChoiceLabel, formatFeet, routeLabel } from '@/rules/grade.ts';
import { buildOptions } from '@/rules/options.ts';
import type { ClearanceOptions } from '@/rules/options.ts';
import type { ClearanceElement } from '@/rules/types.ts';
import type { SelectOption, SelectSpec } from '@/ui/dom.ts';
import { button, el, selectControl } from '@/ui/dom.ts';
import { elementLabel } from '@/ui/labels.ts';
import type { DraftPicks, PickKey } from '@/ui/state.ts';
import { NO_SID, toPlayerPicks } from '@/ui/state.ts';

/** The blank choice every dropdown opens on. */
const PLACEHOLDER = '—';

/** One dropdown of the form, and the pick it sets. */
export type CraftField = SelectSpec & { key: PickKey };

/** One element of CRAFT, with the dropdowns the player answers it with. */
export type CraftGroup = { element: ClearanceElement; fields: readonly CraftField[] };

/** Everything the form needs to render and to report back. */
export type CraftFormProps = {
  scenario: Scenario;
  airport: AirportData;
  picks: DraftPicks;
  onPick: (key: PickKey, raw: string) => void;
  onSubmit: () => void;
};

/** A dropdown whose choices are their own labels, e.g. a list of destinations. */
function plainOptions(values: readonly string[]): SelectOption[] {
  return values.map((value) => ({ value, label: value }));
}

/** The clearance limit: every destination the route library flies to, plus the field itself. */
function limitGroup(options: ClearanceOptions, picks: DraftPicks): CraftGroup {
  return {
    element: 'C',
    fields: [
      {
        key: 'clearedTo',
        label: 'cleared to',
        options: plainOptions(options.clearedTo),
        value: picks.clearedTo,
        disabled: false,
        placeholder: PLACEHOLDER,
      },
    ],
  };
}

/** The procedure: every published SID of the field, and the choice to issue none. */
function procedureGroup(options: ClearanceOptions, picks: DraftPicks): CraftGroup {
  const sids = options.sids.map((sid) => ({ value: sid.id, label: sid.label }));
  return {
    element: 'R.sid',
    fields: [
      {
        key: 'sidId',
        label: 'departure procedure',
        options: [...sids, { value: NO_SID, label: 'no SID' }],
        value: picks.sidId,
        disabled: false,
        placeholder: PLACEHOLDER,
      },
    ],
  };
}

/**
 * The route: the shape of the element, and the fix or airway the shape names.
 *
 * The element dropdown stays disabled until a procedure is picked, because the elements on offer
 * are that procedure's transitions together with the first fixes of the filed route.
 */
function routeGroup(options: ClearanceOptions, picks: DraftPicks): CraftGroup {
  return {
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
        disabled: picks.sidId === undefined || picks.routeTemplate === undefined,
        placeholder: PLACEHOLDER,
      },
    ],
  };
}

/** The altitude: the phrase, and the feet every phrase but "climb via SID" speaks. */
function altitudeGroup(options: ClearanceOptions, picks: DraftPicks): CraftGroup {
  return {
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
function expectGroup(options: ClearanceOptions, picks: DraftPicks): CraftGroup {
  return {
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
): CraftGroup {
  return {
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

/**
 * Builds the six groups of dropdowns the player answers the clearance with.
 *
 * @param scenario The scenario being cleared, which contributes the filed route and altitude.
 * @param airport The airport data.
 * @param picks What the player has picked so far, which settles the dependent dropdowns.
 * @returns The groups, in the order CRAFT speaks them.
 */
export function craftGroups(
  scenario: Scenario,
  airport: AirportData,
  picks: DraftPicks,
): readonly CraftGroup[] {
  const options = buildOptions(scenario, airport, picks.sidId);
  return [
    limitGroup(options, picks),
    procedureGroup(options, picks),
    routeGroup(options, picks),
    altitudeGroup(options, picks),
    expectGroup(options, picks),
    frequencyGroup(options, airport, picks),
  ];
}

/**
 * Renders the CRAFT form.
 *
 * @param props The scenario, the airport, the picks so far, and the handlers for change and submit.
 * @returns The form panel; its submit button is disabled while a required dropdown is blank.
 */
export function renderCraftForm(props: CraftFormProps): HTMLElement {
  const panel = el('section', 'panel craft');
  panel.append(el('h2', '', 'Your clearance'));
  for (const group of craftGroups(props.scenario, props.airport, props.picks)) {
    const row = el('div', 'craft-group');
    row.append(el('h3', '', elementLabel(group.element)));
    for (const field of group.fields) {
      row.append(
        selectControl(field, (value) => {
          props.onPick(field.key, value);
        }),
      );
    }
    panel.append(row);
  }
  const submit = button('Submit clearance', 'primary', props.onSubmit);
  submit.disabled = toPlayerPicks(props.picks) === undefined;
  panel.append(submit);
  return panel;
}
