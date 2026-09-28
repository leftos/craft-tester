import type { AirportData, Scenario } from '@/data/schema.ts';
import { grade, gradeProcedure } from '@/rules/grade.ts';
import { citeSpecialHandling, gradeBest } from '@/rules/handling.ts';
import type { SpokenClearance } from '@/rules/speak.ts';
import type { RouteReading, TextGrade } from '@/rules/text/grade.ts';
import { gradeText } from '@/rules/text/grade.ts';
import type { Grade, ResolvedClearance } from '@/rules/types.ts';
import { acceptedClearance, spokenFor } from '@/ui/session.ts';
import type { ClearanceAnswer, ClearancePicks } from '@/ui/state.ts';
import { picksProcedure } from '@/ui/state.ts';

/**
 * The verdicts a clearance-mode strip's dropdowns earn.
 *
 * A strip whose clearance names no procedure has the student pick it, and that pick is graded as
 * `R.sid` ahead of the route, in CRAFT order; a pick an older attempt never stored is graded as a
 * blank, which is wrong. Every other strip is given its SID and grades the five CRAFT picks alone.
 *
 * @param picks What the student picked.
 * @param resolved The clearance the picks are graded against, proposed or accepted.
 * @param airport The airport data, which names the published procedures.
 * @param procedurePicked Whether the strip asks for the procedure (`picksProcedure` of the
 *   proposed clearance), which holds for both sides of the special handling.
 * @returns Six verdicts where the procedure is picked, the five of `grade` otherwise.
 */
export function clearancePickGrades(
  picks: ClearancePicks,
  resolved: ResolvedClearance,
  airport: AirportData,
  procedurePicked: boolean,
): Grade[] {
  if (!procedurePicked) return grade(picks, resolved);
  return [gradeProcedure(picks.procedure ?? '', resolved, airport), ...grade(picks, resolved)];
}

/** Everything one side of a clearance answer is graded with, besides the clearance it is held to. */
type ClearanceGrading = {
  answer: ClearanceAnswer<ClearancePicks>;
  airport: AirportData;
  routeReading: RouteReading;
  procedurePicked: boolean;
};

/**
 * The verdicts a clearance answer earns: the picks graded as picked, or the typed clearance graded
 * against the engine's reading of the same clearance.
 */
function clearanceGrades(
  grading: ClearanceGrading,
  spoken: SpokenClearance,
  resolved: ResolvedClearance,
): (Grade | TextGrade)[] {
  const { answer, airport, routeReading, procedurePicked } = grading;
  return answer.input === 'text'
    ? gradeText(answer.text, spoken, resolved, airport, routeReading)
    : clearancePickGrades(answer.picks, resolved, airport, procedurePicked);
}

/** The verdicts of a clearance answer and the reading the reveal speaks for the clearance they won against. */
export type ClearanceOutcome = { grades: (Grade | TextGrade)[]; spoken: SpokenClearance };

/**
 * Grades a clearance answer against the clearance under both sides of ZOA CPS-004 3.1 special
 * handling and keeps the better one (`gradeBest`), so a player who read the accepted handling's
 * clearance sees it confirmed, with the special-handling row cited, rather than the proposed one.
 *
 * @param answer The clearance the student gave, picked or typed.
 * @param generated The plan the clearance is read for.
 * @param clearance The clearance the engine proposed for it.
 * @param airport The airport data.
 * @param routeReading The reading a typed clearance is held to.
 * @returns The better side's verdicts and the reading the reveal speaks for it.
 */
export function clearanceOutcome(
  answer: ClearanceAnswer<ClearancePicks>,
  generated: Scenario,
  clearance: ResolvedClearance,
  airport: AirportData,
  routeReading: RouteReading,
): ClearanceOutcome {
  const spokenOf = (resolved: ResolvedClearance): SpokenClearance =>
    spokenFor(generated, generated, resolved, airport);
  const grading = { answer, airport, routeReading, procedurePicked: picksProcedure(clearance) };
  const best = gradeBest(
    clearance,
    acceptedClearance(generated, airport),
    (resolved) => clearanceGrades(grading, spokenOf(resolved), resolved),
    citeSpecialHandling(generated, airport),
  );
  return { grades: best.grades, spoken: spokenOf(best.resolved) };
}
