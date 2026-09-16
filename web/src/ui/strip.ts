import type { Scenario } from '@/data/schema.ts';
import { formatAltitude } from '@/rules/grade.ts';
import { el, rowList } from '@/ui/dom.ts';
import { aircraftLabel, timeLabel } from '@/ui/labels.ts';

/**
 * The boxes of the flight progress strip, in the order it prints them.
 *
 * A flight that filed remarks, such as the `REQ RWY 28` of a freighter asking for the 28s while the
 * ATIS advertises the 01s, gets a remarks box under the beacon code; one that filed none has no
 * such box at all.
 *
 * @param scenario The drawn flight plan.
 * @returns The label and value of every box.
 */
export function stripRows(scenario: Scenario): readonly (readonly [string, string])[] {
  const remarks = scenario.remarks;
  const remarksRow: readonly (readonly [string, string])[] =
    remarks === undefined || remarks.length === 0 ? [] : [['remarks', remarks]];
  return [
    ['callsign', scenario.callsign],
    ['type', aircraftLabel(scenario.aircraftType, scenario.equipmentSuffix)],
    ['destination', scenario.destination],
    ['altitude', formatAltitude(scenario.filedAltitude)],
    ['route', scenario.filedRoute],
    ['squawk', scenario.squawk],
    ...remarksRow,
    ['time', timeLabel(scenario.localTime, scenario.dayOfWeek)],
  ];
}

/**
 * Renders a panel of strip boxes, which is the markup every strip on the page is built from.
 *
 * Amendment mode prints the boxes the student answers in its own panel, so the strip beside it
 * carries the rest of the plan rather than all of it.
 *
 * @param rows The label and value of every box the panel prints.
 * @param heading The heading over the strip, e.g. `Flight plan`.
 * @returns The strip panel.
 */
export function renderStripRows(
  rows: readonly (readonly [string, string])[],
  heading: string,
): HTMLElement {
  const panel = el('section', 'panel strip');
  panel.append(el('h2', '', heading), rowList('strip-rows', rows));
  return panel;
}

/**
 * Renders the flight progress strip.
 *
 * Amendment mode shows two strips at once, the plan as filed and the plan as amended, so the panel
 * is headed by the caller rather than by the strip itself.
 *
 * @param scenario The drawn flight plan.
 * @param heading The heading over the strip, e.g. `Flight plan`.
 * @returns The strip panel.
 */
export function renderStrip(scenario: Scenario, heading: string): HTMLElement {
  return renderStripRows(stripRows(scenario), heading);
}
