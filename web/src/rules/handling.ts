import type { AirportData, FleetEntry, Scenario } from '@/data/schema.ts';
import { citePhraseology } from '@/rules/cite.ts';
import type { Handling } from '@/rules/classify.ts';
import type { Grade, RuleCitation } from '@/rules/types.ts';

/** The ZOA CPS-004 3.1 special handling the fleet row of the flight's type carries, if it has one. */
function fleetHandling(scenario: Scenario, airport: AirportData): FleetEntry['handling'] {
  return airport.routeLibrary.fleet.find((entry) => entry.type === scenario.aircraftType)?.handling;
}

/**
 * Whether ZOA CPS-004 3.1 lists the flight's type for special handling, which is when an answer read
 * under the accepted handling is graded beside the proposed one.
 *
 * @param scenario The filed flight plan, whose type designator is looked up in the fleet.
 * @param airport The airport data, whose fleet rows carry the handling.
 * @returns True for a type the fleet row gives a `handling`.
 */
export function hasSpecialHandling(scenario: Scenario, airport: AirportData): boolean {
  return fleetHandling(scenario, airport) !== undefined;
}

/**
 * The phraseology row an answer graded under the accepted handling cites.
 *
 * @param scenario The filed flight plan.
 * @param airport The airport data, whose `phraseologyRules` hold the special-handling row.
 * @returns The row the type's handling names, or none for a type CPS-004 3.1 does not list.
 */
export function citeSpecialHandling(scenario: Scenario, airport: AirportData): RuleCitation[] {
  const handling = fleetHandling(scenario, airport);
  return handling === undefined ? [] : citePhraseology(airport, handling.ruleId);
}

/** The verdicts an answer earned against one resolution, the resolution, and its handling. */
export type BestGrades<R, G extends Grade> = { grades: G[]; resolved: R; handling: Handling };

/** How many of the verdicts count the element as answered right. */
function rightCount(grades: readonly Grade[]): number {
  return grades.filter((grade) => grade.verdict === 'correct' || grade.verdict === 'acceptable')
    .length;
}

/**
 * The accepted verdicts, each one the accepted resolution expects differently from the proposed one
 * citing the special-handling row beside its own rows.
 */
function citeChanged<G extends Grade>(
  accepted: readonly G[],
  proposed: readonly G[],
  citations: readonly RuleCitation[],
): G[] {
  return accepted.map((grade) => {
    const before = proposed.find((candidate) => candidate.element === grade.element);
    if (before !== undefined && before.expectedLabel === grade.expectedLabel) return grade;
    return { ...grade, citations: [...grade.citations, ...citations] };
  });
}

/**
 * Grades an answer against both sides of ZOA CPS-004 3.1 special handling and keeps the better one.
 *
 * The trainer proposes one handling and accepts the other, so an answer right under the accepted
 * resolution is right. The whole answer is graded against each resolution and the one with more
 * elements answered right (`correct` or `acceptable`) wins, the proposed one on a tie; the answer is
 * never mixed element by element across the two. Where the accepted resolution wins, each element it
 * expects differently from the proposed one cites the special-handling row, so the reveal says why
 * the other class's answer stands.
 *
 * @param proposed The resolution under the proposed handling.
 * @param accepted The resolution under the accepted handling, or null for a type CPS-004 3.1 does not
 *   list, or one the accepted handling could not resolve.
 * @param gradeAgainst Grades the answer against one resolution.
 * @param citations The special-handling row to cite (`citeSpecialHandling`).
 * @returns The winning verdicts, the resolution they were graded against, and its handling.
 */
export function gradeBest<R, G extends Grade>(
  proposed: R,
  accepted: R | null,
  gradeAgainst: (resolved: R) => G[],
  citations: readonly RuleCitation[],
): BestGrades<R, G> {
  const proposedGrades = gradeAgainst(proposed);
  const best: BestGrades<R, G> = {
    grades: proposedGrades,
    resolved: proposed,
    handling: 'proposed',
  };
  if (accepted === null) return best;
  const acceptedGrades = gradeAgainst(accepted);
  if (rightCount(acceptedGrades) <= rightCount(proposedGrades)) return best;
  return {
    grades: citeChanged(acceptedGrades, proposedGrades, citations),
    resolved: accepted,
    handling: 'accepted',
  };
}
