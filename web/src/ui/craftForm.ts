import type { AirportData, NonDpHeading, Scenario } from '@/data/schema.ts';
import {
  altitudeLabel,
  expectChoiceLabel,
  formatAltitude,
  headingPick,
  routeLabel,
} from '@/rules/grade.ts';
import { buildOptions } from '@/rules/options.ts';
import type { ClearanceOptions } from '@/rules/options.ts';
import type { ClearanceElement, ExpectClause, ResolvedClearance } from '@/rules/types.ts';
import { headingLabel } from '@/rules/types.ts';
import type { SelectOption, SelectSpec } from '@/ui/dom.ts';
import { button, el, selectControl, selectOf, syncButton, syncSelect } from '@/ui/dom.ts';
import { elementLabel } from '@/ui/labels.ts';
import type { DraftPicks, PickKey } from '@/ui/state.ts';
import { templateNamesFix, toAmendmentPicks, toPlayerPicks } from '@/ui/state.ts';

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

/**
 * How the form treats the procedure row.
 *
 * A clean clearance is read as filed, so the procedure is a given row; a clearance on a plan the
 * student has just corrected assigns the procedure the corrected route carries, so the student
 * picks it and it is graded.
 */
export type ProcedureRow = 'given' | 'picked';

/** Everything the form needs to render and to report back. */
export type CraftFormProps = {
  scenario: Scenario;
  airport: AirportData;
  clearance: ResolvedClearance;
  picks: DraftPicks;
  procedure: ProcedureRow;
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
 * The element dropdown stays disabled until the shape is picked, and on the one shape that names no
 * element, "radar vectors direct"; the elements on offer are the transitions of the filed procedure
 * together with the first fixes of the filed route.
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
        disabled: picks.routeTemplate === undefined || !templateNamesFix(picks.routeTemplate),
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
          label: formatAltitude(feet),
        })),
        value: picks.altitudeFeet === undefined ? undefined : String(picks.altitudeFeet),
        disabled: picks.altitudePhrase === undefined || picks.altitudePhrase === 'climb_via',
        placeholder: PLACEHOLDER,
      },
    ],
  };
}

/**
 * The expect clause, which the altitude on the strip fills in once the delay is picked.
 *
 * The clause the engine resolved says whether that altitude is the amended one rather than the
 * filed one, which is what the delays are named after; `finalFeet` is the altitude the "will be
 * your final" choice names, which is the altitude the strip in front of the player reads.
 */
function expectGroup(
  options: ClearanceOptions,
  picks: DraftPicks,
  clause: ExpectClause | null,
  finalFeet: number,
): PickedGroup {
  return {
    kind: 'picked',
    element: 'A.expect',
    fields: [
      {
        key: 'expect',
        label: 'expect clause',
        options: options.expect.map((choice) => ({
          value: choice,
          label: expectChoiceLabel(choice, clause, finalFeet),
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
  const procedure = clearance.procedure.value;
  const named =
    procedure.kind === 'sid'
      ? (airport.sids.find((sid) => sid.id === procedure.id)?.chartName ?? procedure.id)
      : headingLabel(procedure.heading);
  return {
    kind: 'given',
    heading: elementLabel('R.sid'),
    value: named,
  };
}

/**
 * Every heading the assignment table clears a flight on, the runway heading first and the
 * numbered headings after it in ascending order, each listed once however many rows name it.
 */
function nonDpHeadings(airport: AirportData): NonDpHeading[] {
  const named = new Set<NonDpHeading>();
  for (const rule of airport.assignmentRules) {
    if (rule.nonDpHeading !== undefined) named.add(rule.nonDpHeading);
  }
  const degrees = [...named]
    .filter((heading): heading is number => heading !== 'runway heading')
    .sort((a, b) => a - b);
  return named.has('runway heading') ? ['runway heading', ...degrees] : degrees;
}

/**
 * The procedure as a pick: every procedure the airport publishes, named as its chart names it,
 * and after them the headings the SOP sends flights off on without a procedure at all.
 */
function procedureGroup(airport: AirportData, picks: DraftPicks): PickedGroup {
  return {
    kind: 'picked',
    element: 'R.sid',
    fields: [
      {
        key: 'procedure',
        label: 'procedure',
        options: [
          ...airport.sids.map((sid) => ({ value: sid.id, label: sid.chartName })),
          ...nonDpHeadings(airport).map((heading) => ({
            value: headingPick(heading),
            label: headingLabel(heading),
          })),
        ],
        value: picks.procedure,
        disabled: false,
        placeholder: PLACEHOLDER,
      },
    ],
  };
}

/**
 * Builds the eight rows of the form, the five of them the player answers the clearance with.
 *
 * The clearance limit and the squawk are given rows: the engine resolved them and the reveal speaks
 * them, and they sit in their CRAFT positions so the whole clearance reads in order. The procedure
 * is a given row on a clean clearance and a picked one on a corrected plan, in the same position
 * either way.
 *
 * @param scenario The scenario being cleared, which contributes the filed route, altitude and squawk.
 * @param airport The airport data.
 * @param clearance The clearance the engine resolved, which fills the given rows.
 * @param picks What the player has picked so far, which settles the dependent dropdowns.
 * @param procedure Whether the procedure row is given or picked.
 * @returns The rows, in the order CRAFT speaks them.
 */
export function craftGroups(
  scenario: Scenario,
  airport: AirportData,
  clearance: ResolvedClearance,
  picks: DraftPicks,
  procedure: ProcedureRow,
): readonly CraftGroup[] {
  const options = buildOptions(scenario, airport, clearance);
  return [
    clearanceLimitRow(clearance, airport),
    procedure === 'given' ? procedureRow(clearance, airport) : procedureGroup(airport, picks),
    routeGroup(options, picks),
    altitudeGroup(options, picks),
    expectGroup(options, picks, clearance.expect.value, scenario.filedAltitude),
    frequencyGroup(options, airport, picks),
    { kind: 'given', heading: 'T — transponder', value: scenario.squawk },
    runwayGroup(options, picks),
  ];
}

/** The dropdown built for each pick the form offers; a pick it does not offer has none. */
type FieldControls = Partial<Record<PickKey, HTMLSelectElement>>;

/**
 * One row of the form: its heading, and then its dropdowns or the value the clearance settles.
 *
 * Each dropdown is recorded under the pick it sets, so a later state of the same form is written
 * into it rather than building it again. The handler reads the props when the change arrives rather
 * than the ones it was built with, because the dropdown outlives them.
 */
function renderGroup(
  group: CraftGroup,
  controls: FieldControls,
  current: () => CraftFormProps,
): HTMLElement {
  const row = el('div', 'craft-group');
  if (group.kind === 'given') {
    row.append(el('h3', '', group.heading), el('div', 'craft-given', group.value));
    return row;
  }
  row.append(el('h3', '', elementLabel(group.element)));
  for (const field of group.fields) {
    const control = selectControl(field, (value) => {
      current().onPick(field.key, value);
    });
    controls[field.key] = selectOf(control);
    row.append(control);
  }
  return row;
}

/** Writes a later state of the form into the dropdowns it already built. */
function syncGroups(groups: readonly CraftGroup[], controls: FieldControls): void {
  for (const group of groups) {
    if (group.kind === 'given') continue;
    for (const field of group.fields) {
      const control = controls[field.key];
      if (control !== undefined) syncSelect(control, field.value, field.disabled);
    }
  }
}

/**
 * Whether the form still has a dropdown to fill before it can be submitted.
 *
 * A form whose procedure row is picked needs that pick too, which an ordinary clearance is given.
 *
 * @param picks What the player has picked so far.
 * @param procedure Whether the procedure row is given or picked.
 * @returns True while a required dropdown is blank.
 */
export function submitDisabled(picks: DraftPicks, procedure: ProcedureRow): boolean {
  const read = procedure === 'picked' ? toAmendmentPicks : toPlayerPicks;
  return read(picks) === undefined;
}

/** The CRAFT form: the panel on screen, and how to write a later pick into the dropdowns it built. */
export type CraftForm = { node: HTMLElement; sync: (props: CraftFormProps) => void };

/** The rows of the form, which both the build and every later sync are derived from. */
function groupsOf(props: CraftFormProps): readonly CraftGroup[] {
  return craftGroups(props.scenario, props.airport, props.clearance, props.picks, props.procedure);
}

/**
 * Renders the CRAFT form.
 *
 * The panel is built once and every later pick is written into the dropdowns it already holds: the
 * choices each one offers are a function of the scenario, so only the value picked and which
 * dropdowns the pick enables change while the form is on screen.
 *
 * @param props The scenario, the airport, the resolved clearance, the picks so far, whether the
 *   procedure is picked, and the handlers for change and submit.
 * @returns The form panel, whose submit button is disabled while a required dropdown is blank, and
 *   the sync that writes a later state of the same form into it.
 */
export function renderCraftForm(props: CraftFormProps): CraftForm {
  let current = props;
  const panel = el('section', 'panel craft');
  panel.append(el('h2', '', 'Your clearance'));
  const controls: FieldControls = {};
  for (const group of groupsOf(props)) {
    panel.append(renderGroup(group, controls, () => current));
  }
  const submit = button('Submit clearance', 'primary', () => {
    current.onSubmit();
  });
  submit.disabled = submitDisabled(props.picks, props.procedure);
  panel.append(submit);
  return {
    node: panel,
    sync: (next) => {
      current = next;
      syncGroups(groupsOf(next), controls);
      syncButton(submit, submitDisabled(next.picks, next.procedure));
    },
  };
}
