import type { AirportData, Scenario } from '@/data/schema.ts';
import { checkAltitude } from '@/rules/amend/altitude.ts';
import { checkRoute } from '@/rules/amend/route.ts';
import { checkType } from '@/rules/amend/type.ts';
import type { AmendmentResult, ResolvedAmendment } from '@/rules/amend/types.ts';
import { classify } from '@/rules/classify.ts';
import { resolveClearance } from '@/rules/engine.ts';
import type { Unresolved } from '@/rules/types.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

/** The suffix at the tail of a type box, e.g. `/L` of `B752/L`. */
const SUFFIX_TAIL = /\/[A-Z]$/;

/** What one check produced: the amendments it raised, or the gap that blocked its box. */
type CheckOutcome = ResolvedAmendment[] | Unresolved;

/** Reads a check that raises at most one amendment as the list every check is collected as. */
function listed(outcome: ResolvedAmendment | undefined | Unresolved): CheckOutcome {
  if (outcome === undefined) return [];
  return isUnresolved(outcome) ? outcome : [outcome];
}

/**
 * Applies one amendment to the plan, which is what the clearance is then read for.
 *
 * @param scenario The plan as it stands with the earlier amendments already applied.
 * @param amendment The amendment to apply.
 * @returns The amended plan.
 */
function apply(scenario: Scenario, amendment: ResolvedAmendment): Scenario {
  if (amendment.box === 'altitude') return { ...scenario, filedAltitude: amendment.proposedFeet };
  if (amendment.box === 'route') return { ...scenario, filedRoute: amendment.proposed };
  const suffix = SUFFIX_TAIL.exec(amendment.proposed)?.[0];
  return suffix === undefined ? scenario : { ...scenario, equipmentSuffix: suffix };
}

/**
 * Resolves every amendment a filed plan needs, and the plan as it reads once they are applied.
 *
 * The checks run in strip order — type, altitude, route — and every box that the data cannot answer
 * fails the whole result, so a plan is never half-amended on a guess. `corrected` is the plan with
 * every proposal applied in that same order, which means a later amendment for a box overrides an
 * earlier one for it: a non-RNAV flight filing an RNAV procedure raises two type amendments, and
 * `corrected` therefore carries the RNAV suffix of the second.
 *
 * @param scenario The filed flight plan.
 * @param airport The airport data.
 * @returns The amendments with the corrected plan, or every box the data could not answer.
 */
export function resolveAmendments(scenario: Scenario, airport: AirportData): AmendmentResult {
  const ctx = classify(scenario, airport);
  if (isUnresolved(ctx)) return { ok: false, unresolved: [ctx] };
  const result = resolveClearance(scenario, airport);
  if (!result.ok) return { ok: false, unresolved: result.unresolved };
  const { clearance } = result;
  const outcomes: CheckOutcome[] = [
    checkType(scenario, ctx, clearance, airport),
    listed(checkAltitude(scenario, ctx, airport)),
    listed(checkRoute(scenario, ctx, clearance, airport)),
  ];
  const amendments: ResolvedAmendment[] = [];
  const gaps: Unresolved[] = [];
  for (const outcome of outcomes) {
    if (Array.isArray(outcome)) amendments.push(...outcome);
    else gaps.push(outcome);
  }
  if (gaps.length > 0) return { ok: false, unresolved: gaps };
  return { ok: true, amendments, corrected: amendments.reduce(apply, scenario) };
}
