import type { Scenario } from '@/data/schema.ts';
import { formatFeet } from '@/rules/grade.ts';
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
    ['altitude', formatFeet(scenario.filedAltitude)],
    ['route', scenario.filedRoute],
    ['squawk', scenario.squawk],
    ...remarksRow,
    ['time', timeLabel(scenario.localTime, scenario.dayOfWeek)],
  ];
}

/**
 * Renders the flight progress strip.
 *
 * @param scenario The drawn flight plan.
 * @returns The strip panel.
 */
export function renderStrip(scenario: Scenario): HTMLElement {
  const panel = el('section', 'panel strip');
  panel.append(el('h2', '', 'Flight plan'), rowList('strip-rows', stripRows(scenario)));
  return panel;
}
