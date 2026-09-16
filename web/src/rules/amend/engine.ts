import type { AirportData, Scenario } from '@/data/schema.ts';
import { checkAltitude } from '@/rules/amend/altitude.ts';
import { checkRoute } from '@/rules/amend/route.ts';
import { checkType } from '@/rules/amend/type.ts';
import type { AmendmentResult, ResolvedAmendment } from '@/rules/amend/types.ts';
import { citePhraseology } from '@/rules/cite.ts';
import { classify } from '@/rules/classify.ts';
import { resolveClearance } from '@/rules/engine.ts';
import type {
  Cited,
  EngineResult,
  ExpectClause,
  ResolvedClearance,
  Unresolved,
} from '@/rules/types.ts';
import { isUnresolved } from '@/rules/unresolved.ts';

/** The suffix at the tail of a type box, e.g. `/L` of `B752/L`. */
const SUFFIX_TAIL = /\/[A-Z]$/;

/** The delay an amended expect clause is spoken with when neither the plan nor the chart names one. */
const DEFAULT_EXPECT_MINUTES = 10;

/** The boxes in the order they read across the strip, which is the order the checks run in. */
const STRIP_ORDER: readonly ResolvedAmendment['box'][] = ['type', 'altitude', 'route'];

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
 * Whether the corrected plan carries this amendment, which is one side only of an alternative pair.
 *
 * Either box of a pair alone fixes the fault, so applying both would leave a plan that fixed it
 * twice — an RNAV suffix together with the non-RNAV route the suffix made unnecessary. The box
 * earlier in strip order carries the fix, the same tie-break the pair is graded with.
 *
 * @param amendment One amendment the checks raised.
 * @returns Whether it is applied to the corrected plan.
 */
function applies(amendment: ResolvedAmendment): boolean {
  const other = amendment.alternativeTo;
  return other === undefined || STRIP_ORDER.indexOf(other) > STRIP_ORDER.indexOf(amendment.box);
}

/**
 * Marks the route amendment as the other half of the RNAV pair the type check raised.
 *
 * The type check knows that raising the suffix keeps the filed procedure, but only the whole result
 * says whether the route box was in fact amended away from it, so the back link is made here.
 *
 * @param amendments Every amendment the checks raised, in strip order.
 * @returns The same amendments, with the route one marked where the pair exists.
 */
function pairAlternatives(amendments: ResolvedAmendment[]): ResolvedAmendment[] {
  const paired = amendments.some(
    (amendment) => amendment.box === 'type' && amendment.alternativeTo === 'route',
  );
  if (!paired) return amendments;
  return amendments.map((amendment) =>
    amendment.box === 'route' ? { ...amendment, alternativeTo: 'type' as const } : amendment,
  );
}

/**
 * Resolves every amendment a filed plan needs, and the plan as it reads once they are applied.
 *
 * The checks run in strip order — type, altitude, route — and every box that the data cannot answer
 * fails the whole result, so a plan is never half-amended on a guess. `corrected` is the plan with
 * every proposal applied in that same order, which means a later amendment for a box overrides an
 * earlier one for it: a non-RNAV flight filing an RNAV procedure can raise two type amendments where
 * the suffix gap and the RNAV clash propose different suffixes, and `corrected` therefore carries
 * the RNAV suffix of the second. Where the RNAV clash raised a type amendment and the route box was
 * amended too, the two are marked as alternatives: either one alone fixes the clash, so `corrected`
 * applies the box earlier in strip order and skips the other, the tie-break the two are graded with.
 * Both are still reported, because writing either box is a full answer.
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
  const raised: ResolvedAmendment[] = [];
  const gaps: Unresolved[] = [];
  for (const outcome of outcomes) {
    if (Array.isArray(outcome)) raised.push(...outcome);
    else gaps.push(outcome);
  }
  if (gaps.length > 0) return { ok: false, unresolved: gaps };
  const amendments = pairAlternatives(raised);
  return { ok: true, amendments, corrected: amendments.filter(applies).reduce(apply, scenario) };
}

/**
 * How many minutes after departure an amended expect clause is spoken with.
 *
 * The clause the clearance already carries keeps its delay. Where it carries none — the chart
 * publishes the expect note itself, or the flight is cleared to the altitude it asked for — the
 * chart's own note gives the delay, and ten minutes is the standard where nothing else does.
 *
 * @param clearance The clearance resolved for the corrected plan.
 * @param airport The airport data, whose `sids` carry the chart note.
 * @returns The delay in minutes.
 */
function amendedMinutes(clearance: ResolvedClearance, airport: AirportData): number {
  const clause = clearance.expect.value;
  if (clause !== null && clause.kind !== 'final') return clause.minutes;
  const sid = airport.sids.find((entry) => entry.id === clearance.sid.value.id);
  return sid?.chartExpectFiledAltitudeMinutes ?? DEFAULT_EXPECT_MINUTES;
}

/**
 * The expect clause an amended final altitude calls for, with the rule row that speaks it.
 *
 * A flight whose final altitude was amended is told what to expect and when, whatever the SID chart
 * publishes: the chart's note covers the altitude the pilot filed, not the one the strip now reads.
 * Where the clearance climbs the flight straight to the amended altitude and speaks it — "maintain
 * niner thousand", "climb via SID except maintain niner thousand" — there is nothing further to
 * expect, so the clause says that the altitude just spoken is the final one. A plain "climb via
 * SID" speaks no altitude of its own, so it keeps the amended reading even where the SID's
 * published top altitude is the amended one.
 *
 * @param clearance The clearance resolved for the corrected plan.
 * @param corrected The plan with every amendment applied.
 * @param airport The airport data.
 * @returns The clause to speak, with its citation.
 */
function amendedExpect(
  clearance: ResolvedClearance,
  corrected: Scenario,
  airport: AirportData,
): Cited<ExpectClause> {
  const spokenFeet = clearance.altitude.value.feet;
  if (spokenFeet !== undefined && spokenFeet >= corrected.filedAltitude) {
    return {
      value: { kind: 'final', feet: corrected.filedAltitude },
      citations: citePhraseology(airport, 'A-FINAL'),
    };
  }
  return {
    value: {
      kind: 'amended',
      feet: corrected.filedAltitude,
      minutes: amendedMinutes(clearance, airport),
    },
    citations: citePhraseology(airport, 'A-EXPECT-AMENDED'),
  };
}

/**
 * The clearance with the expect clause an amended final altitude calls for.
 *
 * The amended reading is mandatory where it is the one spoken, so nothing stands beside it. Where
 * the final reading is the one spoken, the amended clause is still a reading the rules allow, only
 * longer than it needs to be: it names the same altitude at the delay that clause would have
 * carried, so it is kept as the redundant reading for grading to accept.
 *
 * @param clearance The clearance resolved for the corrected plan.
 * @param corrected The plan with every amendment applied.
 * @param airport The airport data.
 * @returns The clearance with the amended expect clause.
 */
function withAmendedExpect(
  clearance: ResolvedClearance,
  corrected: Scenario,
  airport: AirportData,
): ResolvedClearance {
  const expect = amendedExpect(clearance, corrected, airport);
  const redundantExpect: ResolvedClearance['redundantExpect'] =
    expect.value.kind === 'final'
      ? {
          value: { feet: corrected.filedAltitude, minutes: amendedMinutes(clearance, airport) },
          citations: citePhraseology(airport, 'A-FINAL'),
        }
      : { value: null, citations: [] };
  return { ...clearance, expect, redundantExpect };
}

/**
 * The clearance with the rule an amended route is read under cited on the route element.
 *
 * "Then as filed" hands the route over to the one the pilot has in front of them, so an amended
 * route is read out to the point the two run together from, and the rule that says so is quoted
 * beside the route the player is graded against.
 *
 * @param clearance The clearance resolved for the corrected plan.
 * @param airport The airport data, whose `phraseologyRules` hold the row.
 * @returns The clearance with the route element citing the rule.
 */
function withAsFiledRule(clearance: ResolvedClearance, airport: AirportData): ResolvedClearance {
  return {
    ...clearance,
    route: {
      ...clearance.route,
      citations: [...clearance.route.citations, ...citePhraseology(airport, 'R-THEN-AS-FILED')],
    },
  };
}

/**
 * Resolves the clearance read for a plan the controller amended, which is the corrected plan's own
 * clearance with what each amended box adds to the reading.
 *
 * An amended altitude adds the expect clause and an amended route the rule its reading follows, and
 * the two are independent: a plan can be amended in either box alone. Every other element is the
 * corrected plan's, so the reading never mixes the two plans.
 *
 * @param original The plan as filed.
 * @param corrected The plan with every amendment applied.
 * @param airport The airport data.
 * @returns The clearance for the corrected plan, or the element that blocked it.
 */
export function resolveAmendedClearance(
  original: Scenario,
  corrected: Scenario,
  airport: AirportData,
): EngineResult {
  const result = resolveClearance(corrected, airport);
  if (!result.ok) return result;
  let clearance = result.clearance;
  if (corrected.filedRoute !== original.filedRoute) {
    clearance = withAsFiledRule(clearance, airport);
  }
  if (corrected.filedAltitude !== original.filedAltitude) {
    clearance = withAmendedExpect(clearance, corrected, airport);
  }
  return { ok: true, clearance };
}
