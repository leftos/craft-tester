import { describe, expect, it } from 'vitest';
import { gradeBest } from '@/rules/handling.ts';
import type { ClearanceElement, Grade, RuleCitation, Verdict } from '@/rules/types.ts';

/** The special-handling row the tests expect cited. */
const CPS004: RuleCitation = {
  id: 'ZOA-CPS004-SPECIAL-AIRCRAFT',
  source: 'ZOA CPS-004 3.1',
  text: 'special aircraft',
};

/** A resolution as the tests grade against it: what it expects of each element. */
type Resolution = Partial<Record<ClearanceElement, string>>;

/** The answer every test grades: a route and an altitude. */
const ANSWER: Resolution = { 'R.route': 'as filed', 'A.phrase': 'maintain 3,000' };

/** Grades the answer element by element against what a resolution expects. */
function gradeAgainst(resolved: Resolution): Grade[] {
  return (Object.keys(ANSWER) as ClearanceElement[]).map((element) => {
    const expected = resolved[element] ?? '';
    const actual = ANSWER[element] ?? '';
    const verdict: Verdict = expected === actual ? 'correct' : 'wrong';
    return { element, verdict, expectedLabel: expected, actualLabel: actual, citations: [] };
  });
}

/** The ids each grade cites, keyed by its element. */
function citedIds(grades: readonly Grade[]): Record<string, string[]> {
  return Object.fromEntries(
    grades.map((grade) => [grade.element, grade.citations.map((citation) => citation.id)]),
  );
}

describe('gradeBest', () => {
  const jet: Resolution = { 'R.route': 'as filed', 'A.phrase': 'maintain 10,000' };
  const turboprop: Resolution = { 'R.route': 'as filed', 'A.phrase': 'maintain 3,000' };

  it('keeps the proposed resolution when there is no accepted one', () => {
    const best = gradeBest(jet, null, gradeAgainst, [CPS004]);
    expect(best.handling).toBe('proposed');
    expect(best.resolved).toBe(jet);
    expect(best.grades).toStrictEqual(gradeAgainst(jet));
  });

  it('keeps the proposed resolution on a tie, citing nothing more', () => {
    const best = gradeBest(jet, { ...jet }, gradeAgainst, [CPS004]);
    expect(best.handling).toBe('proposed');
    expect(best.resolved).toBe(jet);
    expect(citedIds(best.grades)).toStrictEqual({ 'R.route': [], 'A.phrase': [] });
  });

  it('keeps the proposed resolution when it has more elements right', () => {
    const best = gradeBest(turboprop, jet, gradeAgainst, [CPS004]);
    expect(best.handling).toBe('proposed');
    expect(best.grades.every((grade) => grade.verdict === 'correct')).toBe(true);
  });

  it('takes the accepted resolution when it has more elements right', () => {
    const best = gradeBest(jet, turboprop, gradeAgainst, [CPS004]);
    expect(best.handling).toBe('accepted');
    expect(best.resolved).toBe(turboprop);
    expect(best.grades.every((grade) => grade.verdict === 'correct')).toBe(true);
  });

  it('never mixes the two: an answer right on one element under each is graded against one', () => {
    const turbopropOffRoute: Resolution = { 'R.route': 'direct', 'A.phrase': 'maintain 3,000' };
    const best = gradeBest(jet, turbopropOffRoute, gradeAgainst, [CPS004]);
    expect(best.handling).toBe('proposed');
    expect(best.grades.map((grade) => grade.verdict)).toStrictEqual(['correct', 'wrong']);
  });

  it('cites the special handling on each element the accepted resolution expects differently', () => {
    const best = gradeBest(jet, turboprop, gradeAgainst, [CPS004]);
    expect(citedIds(best.grades)).toStrictEqual({
      'R.route': [],
      'A.phrase': ['ZOA-CPS004-SPECIAL-AIRCRAFT'],
    });
  });
});
