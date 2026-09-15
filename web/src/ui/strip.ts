import { formatFeet } from '@/rules/grade.ts';
import type { GeneratedScenario } from '@/scenario/generate.ts';
import { el, rowList } from '@/ui/dom.ts';
import { aircraftLabel, timeLabel } from '@/ui/labels.ts';

/**
 * The boxes of the flight progress strip, in the order it prints them.
 *
 * @param generated The drawn scenario and the equipment suffix it filed.
 * @returns The label and value of every box.
 */
export function stripRows(generated: GeneratedScenario): readonly (readonly [string, string])[] {
  const { scenario } = generated;
  return [
    ['callsign', scenario.callsign],
    ['type', aircraftLabel(scenario.aircraftType, generated.suffix)],
    ['destination', scenario.destination],
    ['altitude', formatFeet(scenario.filedAltitude)],
    ['route', scenario.filedRoute],
    ['squawk', scenario.squawk],
    ['time', timeLabel(scenario.localTime, scenario.dayOfWeek)],
  ];
}

/**
 * Renders the flight progress strip.
 *
 * @param generated The drawn scenario and the equipment suffix it filed.
 * @returns The strip panel.
 */
export function renderStrip(generated: GeneratedScenario): HTMLElement {
  const panel = el('section', 'panel strip');
  panel.append(el('h2', '', 'Flight plan'), rowList('strip-rows', stripRows(generated)));
  return panel;
}
