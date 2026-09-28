import type { DayOfWeek } from '@/data/schema.ts';
import type { ClearanceElement } from '@/rules/types.ts';

/** The CRAFT letter an element is read under, empty for one outside the five, and its name. */
export type ElementParts = { letter: string; name: string };

/** How the form and the results view name each element of the clearance and each strip box. */
const ELEMENT_PARTS: Record<ClearanceElement, ElementParts> = {
  C: { letter: 'C', name: 'clearance limit' },
  'R.sid': { letter: 'R', name: 'procedure' },
  'R.route': { letter: 'R', name: 'route' },
  'A.phrase': { letter: 'A', name: 'altitude' },
  'A.expect': { letter: 'A', name: 'expect' },
  F: { letter: 'F', name: 'frequency' },
  T: { letter: 'T', name: 'squawk' },
  RWY: { letter: '', name: 'expect runway' },
  'BOX.type': { letter: '', name: 'strip — type' },
  'BOX.altitude': { letter: '', name: 'strip — altitude' },
  'BOX.route': { letter: '', name: 'strip — route' },
};

/**
 * Splits the name of one element into its CRAFT letter and the words after it.
 *
 * @param element The element, as the engine and the grader key it.
 * @returns The letter, e.g. `R`, or empty for the runway and the strip boxes, and the name, e.g.
 *   `procedure`.
 */
export function elementParts(element: ClearanceElement): ElementParts {
  return ELEMENT_PARTS[element];
}

/**
 * Names one element of the clearance, or one box of the strip.
 *
 * @param element The element, as the engine and the grader key it.
 * @returns The heading the form and the results view show, e.g. `R — procedure`.
 */
export function elementLabel(element: ClearanceElement): string {
  const { letter, name } = ELEMENT_PARTS[element];
  return letter === '' ? name : `${letter} — ${name}`;
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
