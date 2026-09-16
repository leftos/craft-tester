import type { DayOfWeek } from '@/data/schema.ts';
import type { ClearanceElement } from '@/rules/types.ts';

/** How the form and the results view name each graded element of the clearance. */
const ELEMENT_LABELS: Record<ClearanceElement, string> = {
  'R.sid': 'R — procedure',
  'R.route': 'R — route',
  'A.phrase': 'A — altitude',
  'A.expect': 'A — expect',
  F: 'F — frequency',
  RWY: 'expect runway',
};

/**
 * Names one graded element of the clearance.
 *
 * @param element The element, as the engine and the grader key it.
 * @returns The heading the form and the results view show, e.g. `R — procedure`.
 */
export function elementLabel(element: ClearanceElement): string {
  return ELEMENT_LABELS[element];
}

/**
 * Names a day of the week the way the strip writes it.
 *
 * @param day The day, as the scenario holds it.
 * @returns The day capitalized, e.g. `Sunday`.
 */
export function dayLabel(day: DayOfWeek): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

/**
 * Writes the local time and day the scenario is set at.
 *
 * @param localTime The local time as four digits, e.g. `2215`.
 * @param day The day of the week.
 * @returns The time and day, e.g. `2215L Sunday`.
 */
export function timeLabel(localTime: string, day: DayOfWeek): string {
  return `${localTime}L ${dayLabel(day)}`;
}

/**
 * Writes an aircraft type with the equipment suffix it filed.
 *
 * @param aircraftType The ICAO type designator, e.g. `B738`.
 * @param suffix The equipment suffix, which the data writes with its slash, e.g. `/L`, or `null`
 *   when the pilot filed none.
 * @returns The type as the strip writes it, e.g. `B738/L`, or the bare designator without a suffix.
 */
export function aircraftLabel(aircraftType: string, suffix: string | null): string {
  return suffix === null ? aircraftType : `${aircraftType}${suffix}`;
}
