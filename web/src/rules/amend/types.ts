import type { Amendment, ExpectedAmendments, Scenario } from '@/data/schema.ts';
import type { RuleCitation, Unresolved } from '@/rules/types.ts';

/**
 * One strip box the amendment engine proposes a new value for, with the rows that decided it.
 *
 * The amendment itself is the shape a fixture stores; the citations are engine-side only, the way
 * `Cited` carries them for a clearance element, and `toExpectedAmendments` strips them.
 */
export type ResolvedAmendment = Amendment & { citations: RuleCitation[] };

/**
 * What the amendment engine returns for a filed plan.
 *
 * An `ok` result with an empty `amendments` list is a first-class outcome: the plan is correct as
 * filed, and knowing that nothing needs changing is half the skill the mode trains. `corrected` is
 * the scenario with every proposal applied, which is the plan the clearance is then read for.
 * A box the data cannot answer fails the whole result, so a fixture stays pending rather than
 * settling on a guess.
 */
export type AmendmentResult =
  | {
      ok: true;
      amendments: ResolvedAmendment[];
      corrected: Scenario;
      /** A route box graded correct beside the expected one, where the route tool recommends a route. */
      routeAlsoCorrect?: string;
    }
  | { ok: false; unresolved: Unresolved[] };

/** One amendment in the shape a fixture stores, which is the resolved one without its citations. */
function toAmendment(resolved: ResolvedAmendment): Amendment {
  const { citations: _citations, ...amendment } = resolved;
  return amendment;
}

/**
 * Flattens a resolved amendment result into the fixture schema's `ExpectedAmendments` shape.
 *
 * Drops the citations and keeps the order the checks ran in, so a fixture runner can compare an
 * engine result with a checked-in expectation by deep equality. The route box graded correct beside
 * the expected one is kept where the result names one, and left out otherwise.
 *
 * @param result The amendments the engine resolved for a plan.
 * @returns The same amendments in the shape a fixture stores.
 */
export function toExpectedAmendments(
  result: Extract<AmendmentResult, { ok: true }>,
): ExpectedAmendments {
  const amendments = result.amendments.map(toAmendment);
  const { routeAlsoCorrect } = result;
  return routeAlsoCorrect === undefined ? { amendments } : { amendments, routeAlsoCorrect };
}
