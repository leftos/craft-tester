import type { AirportData, Scenario } from '@/data/schema.ts';
import { checkAltitude } from '@/rules/amend/altitude.ts';
import { checkRoute } from '@/rules/amend/route.ts';
import { checkRnavClash, checkSuffix } from '@/rules/amend/type.ts';
import type { AmendmentResult, ResolvedAmendment } from '@/rules/amend/types.ts';
import { citePhraseology } from '@/rules/cite.ts';
import type { Classification } from '@/rules/classify.ts';
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

/** A plan with what the engine resolved for it, which is what a box is judged against. */
type Judged = { scenario: Scenario; ctx: Classification; clearance: ResolvedClearance };

/** Reads a check that raises at most one amendment as the list every check is collected as. */
function listed(outcome: ResolvedAmendment | undefined | Unresolved): CheckOutcome {
  if (outcome === undefined) return [];
  return isUnresolved(outcome) ? outcome : [outcome];
}

/**
 * Classifies a plan and resolves the clearance the SOP reads it under.
 *
 * @param scenario The plan to judge a box against.
 * @param airport The airport data.
 * @returns The plan with its classification and its clearance, or the gaps that blocked either.
 */
function judge(scenario: Scenario, airport: AirportData): Judged | Unresolved[] {
  const ctx = classify(scenario, airport);
  if (isUnresolved(ctx)) return [ctx];
  const result = resolveClearance(scenario, airport);
  if (!result.ok) return result.unresolved;
  return { scenario, ctx, clearance: result.clearance };
}

/**
 * Sorts what the checks produced into the amendments raised and the boxes the data could not answer.
 *
 * @param outcomes What every check returned, in strip order.
 * @returns The amendments in that order, and every gap a check reported.
 */
function collect(outcomes: readonly CheckOutcome[]): {
  raised: ResolvedAmendment[];
  gaps: Unresolved[];
} {
  const raised: ResolvedAmendment[] = [];
  const gaps: Unresolved[] = [];
  for (const outcome of outcomes) {
    if (Array.isArray(outcome)) raised.push(...outcome);
    else gaps.push(outcome);
  }
  return { raised, gaps };
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
 * The checks run in strip order — type, altitude, route — and the type box is corrected before the
 * other two are judged: the equipment suffix decides what the SOP assigns the flight, so the
 * altitude and the route are read for the plan as the type box will read rather than for the one the
 * pilot filed, and every box then agrees with the clearance the corrected plan is read under. A box
 * the data cannot answer fails the whole result, so a plan is never half-amended on a guess.
 * `corrected` is the plan with every proposal applied in strip order, which means a later amendment
 * for a box overrides an earlier one for it: the type box can carry both the suffix gap and the RNAV
 * clash, and `corrected` therefore carries the RNAV suffix of the second. The RNAV pair is raised
 * only where the plan with that suffix is in fact assigned the procedure the pilot filed; where it
 * is not, the route is simply wrong for the flight and the route box alone amends it. Where the pair
 * is raised and the route box was amended too, the two are marked as alternatives: either one alone
 * fixes the clash, so `corrected` applies the box earlier in strip order and skips the other, the
 * tie-break the two are graded with. Both are still reported, because writing either box is a full
 * answer.
 *
 * @param scenario The filed flight plan.
 * @param airport The airport data.
 * @returns The amendments with the corrected plan, or every box the data could not answer.
 */
export function resolveAmendments(scenario: Scenario, airport: AirportData): AmendmentResult {
  const filed = judge(scenario, airport);
  if (Array.isArray(filed)) return { ok: false, unresolved: filed };
  const suffix = checkSuffix(scenario, airport);
  if (suffix !== undefined && isUnresolved(suffix)) return { ok: false, unresolved: [suffix] };
  const judged = suffix === undefined ? filed : judge(apply(scenario, suffix), airport);
  if (Array.isArray(judged)) return { ok: false, unresolved: judged };
  const clash = checkRnavClash(judged.scenario, judged.ctx, judged.clearance, airport);
  const outcomes: CheckOutcome[] = [
    [suffix, clash].filter((amendment) => amendment !== undefined),
    listed(checkAltitude(judged.scenario, judged.ctx, airport)),
    listed(checkRoute(judged.scenario, judged.ctx, judged.clearance, airport)),
  ];
  const { raised, gaps } = collect(outcomes);
  if (gaps.length > 0) return { ok: false, unresolved: gaps };
  const amendments = pairAlternatives(raised);
  return { ok: true, amendments, corrected: amendments.filter(applies).reduce(apply, scenario) };
}

/**
 * How many minutes after departure an amended expect clause is spoken with.
 *
 * The clause the clearance already carries keeps its delay. Where it carries none — the chart
 * publishes the expect note itself, or the flight is cleared to the altitude it asked for — the
 * chart's own note gives the delay, and ten minutes is the standard where nothing else does. A
 * flight cleared on the runway heading is on no chart, so it takes the standard.
 *
 * @param clearance The clearance resolved for the corrected plan.
 * @param airport The airport data, whose `sids` carry the chart note.
 * @returns The delay in minutes.
 */
function amendedMinutes(clearance: ResolvedClearance, airport: AirportData): number {
  const clause = clearance.expect.value;
  if (clause !== null && clause.kind !== 'final') return clause.minutes;
  const procedure = clearance.procedure.value;
  if (procedure.kind === 'heading') return DEFAULT_EXPECT_MINUTES;
  const sid = airport.sids.find((entry) => entry.id === procedure.id);
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
