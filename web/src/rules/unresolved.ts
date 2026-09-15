import type { ClearanceElement, Unresolved } from '@/rules/types.ts';

/**
 * Builds the failure result of a pipeline step.
 *
 * @param element The clearance element the step could not produce.
 * @param reason What blocked it, phrased for the player and for a data-gap report.
 * @returns The failure result.
 */
export function unresolved(element: ClearanceElement, reason: string): Unresolved {
  return { element, reason };
}

/**
 * Narrows a pipeline step's result to its failure case.
 *
 * @param value Whatever the step returned.
 * @returns True when the step failed, which narrows the value to `Unresolved`.
 */
export function isUnresolved<T extends object>(value: T | Unresolved): value is Unresolved {
  return 'element' in value && 'reason' in value;
}
