import type { AirportData, EquipmentSuffix, FleetEntry, Scenario } from '@/data/schema.ts';
import { citeSuffix } from '@/rules/amend/cite.ts';
import type { ResolvedAmendment } from '@/rules/amend/types.ts';
import type { Classification } from '@/rules/classify.ts';
import { isSidToken } from '@/rules/route.ts';
import type { ResolvedClearance, RuleCitation, Unresolved } from '@/rules/types.ts';
import { isUnresolved, unresolved } from '@/rules/unresolved.ts';

/** The table of equipment suffixes as a reason names it. */
const SUFFIX_TABLE = 'FAA JO 7110.65 Table 5-4-1';

/** A suffix the fleet files for the type, together with the table row that describes it. */
type ProposedSuffix = { suffix: string; row: EquipmentSuffix };

/** An amendment for the type box, which is the only box this check raises one for. */
type TypeAmendment = Extract<ResolvedAmendment, { box: 'type' }>;

/** The first suffix the fleet files for the type that the equipment table also holds. */
function fleetSuffix(
  fleet: FleetEntry,
  airport: AirportData,
  wanted: (row: EquipmentSuffix) => boolean,
): ProposedSuffix | undefined {
  for (const suffix of fleet.suffixes) {
    const row = airport.equipmentSuffixes.find((entry) => entry.suffix === suffix);
    if (row !== undefined && wanted(row)) return { suffix, row };
  }
  return undefined;
}

/** The type box as the strip should read it: the designator with the suffix run together. */
function typeBox(scenario: Scenario, suffix: string): string {
  return `${scenario.aircraftType}${suffix}`;
}

/**
 * The amendment for a suffix the flight plan cannot stand on: none filed, or one no longer in the
 * equipment table.
 *
 * @param scenario The filed flight plan.
 * @param airport The airport data, whose `equipmentSuffixes` is the table the suffix must be in.
 * @param fleet The fleet row for the filed type, absent when the fleet does not list the type.
 * @returns The amendment, `undefined` when the filed suffix stands, or `Unresolved` when the data
 *   holds no suffix to propose for the type.
 */
function suffixAmendment(
  scenario: Scenario,
  airport: AirportData,
  fleet: FleetEntry | undefined,
): TypeAmendment | Unresolved | undefined {
  const filed = scenario.equipmentSuffix;
  if (filed !== null && airport.equipmentSuffixes.some((row) => row.suffix === filed)) {
    return undefined;
  }
  if (fleet === undefined) {
    return unresolved(
      'BOX.type',
      `aircraft type ${scenario.aircraftType} is not in the fleet, so the data holds no equipment suffix to propose for it`,
    );
  }
  const proposed = fleetSuffix(fleet, airport, () => true);
  if (proposed === undefined) {
    return unresolved(
      'BOX.type',
      `the fleet files a ${fleet.type} with suffixes the equipment table does not hold, so the data holds none to propose`,
    );
  }
  const why =
    filed === null ? 'no equipment suffix filed' : `suffix ${filed} is not in ${SUFFIX_TABLE}`;
  return {
    box: 'type',
    proposed: typeBox(scenario, proposed.suffix),
    reason: `${why}; the fleet files a ${fleet.type} as ${typeBox(scenario, proposed.suffix)}`,
    citations: [citeSuffix(proposed.row)],
  };
}

/** The published SID the route box files, where it files one at the version in force. */
function filedSid(scenario: Scenario, airport: AirportData) {
  const head = scenario.filedRoute.trim().split(/\s+/)[0];
  if (head === undefined || !isSidToken(head)) return undefined;
  return airport.sids.find((sid) => sid.id === head);
}

/**
 * The second amendment a non-RNAV flight filing an RNAV procedure raises.
 *
 * The plan is wrong in two ways at once and the data does not say which the controller meant: the
 * suffix can be raised to an RNAV one, which keeps the procedure the pilot filed, or the route box
 * can be amended to the procedure a non-RNAV flight is assigned. Both amendments are returned.
 *
 * @param scenario The filed flight plan.
 * @param ctx The classified flight, which carries the RNAV capability the suffix gave it.
 * @param clearance The clearance the engine resolved, which names the procedure the route check
 *   would put in the box instead.
 * @param airport The airport data.
 * @param fleet The fleet row for the filed type, absent when the fleet does not list the type.
 * @returns The amendment, or `undefined` when the plan raises no such ambiguity.
 */
function rnavAmendment(
  scenario: Scenario,
  ctx: Classification,
  clearance: ResolvedClearance,
  airport: AirportData,
  fleet: FleetEntry | undefined,
): TypeAmendment | undefined {
  if (ctx.rnavCapable || fleet === undefined) return undefined;
  const sid = filedSid(scenario, airport);
  if (sid === undefined || !sid.rnavRequired) return undefined;
  const proposed = fleetSuffix(fleet, airport, (row) => row.rnav);
  if (proposed === undefined) return undefined;
  const procedure = clearance.procedure.value;
  const otherwise = procedure.kind === 'sid' ? procedure.id : 'the runway heading and no procedure';
  return {
    box: 'type',
    proposed: typeBox(scenario, proposed.suffix),
    reason: `an RNAV suffix would keep the filed ${sid.id}, which the route check otherwise replaces with ${otherwise}`,
    alternativeTo: 'route',
    citations: [citeSuffix(proposed.row)],
  };
}

/** The citations of both proposals, the first occurrence of each id kept in order. */
function dedupe(citations: RuleCitation[]): RuleCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    if (seen.has(citation.id)) return false;
    seen.add(citation.id);
    return true;
  });
}

/**
 * The two proposals as the one amendment they are, for a plan whose suffix gap and RNAV clash have
 * the same answer.
 *
 * Both reasons are kept, because the box is wrong in both ways at once, and the merged amendment is
 * still the RNAV alternative: amending the route box instead is a full answer.
 *
 * @param suffix The amendment the filed suffix raised.
 * @param rnav The amendment the RNAV clash raised, which proposes the same type box.
 * @returns The single amendment for the type box.
 */
function merge(suffix: TypeAmendment, rnav: TypeAmendment): TypeAmendment {
  return {
    ...rnav,
    reason: `${suffix.reason}; ${rnav.reason}`,
    citations: dedupe([...suffix.citations, ...rnav.citations]),
  };
}

/**
 * Checks the type box of the strip: the equipment suffix the plan was filed with.
 *
 * A plan filed with no suffix, or with one the equipment table does not hold, is amended to the
 * suffix the fleet files for the type. A non-RNAV flight that files an RNAV procedure raises a
 * second amendment, because raising the suffix and amending the route are both ways to make the
 * plan fly and the data does not settle which the controller meant; that one is marked as the
 * alternative to the route box. Where both proposals write the same type box — the usual case, a
 * fleet that files one suffix and that suffix being an RNAV one — they are reported as the one
 * amendment they are, carrying both reasons.
 *
 * @param scenario The filed flight plan.
 * @param ctx The classified flight.
 * @param clearance The clearance the engine resolved for the plan.
 * @param airport The airport data.
 * @returns Every amendment for the type box, in the order they are reported, or `Unresolved` when
 *   the data holds no suffix to propose.
 */
export function checkType(
  scenario: Scenario,
  ctx: Classification,
  clearance: ResolvedClearance,
  airport: AirportData,
): ResolvedAmendment[] | Unresolved {
  const fleet = airport.routeLibrary.fleet.find((row) => row.type === scenario.aircraftType);
  const suffix = suffixAmendment(scenario, airport, fleet);
  if (suffix !== undefined && isUnresolved(suffix)) return suffix;
  const rnav = rnavAmendment(scenario, ctx, clearance, airport, fleet);
  if (suffix !== undefined && rnav !== undefined && suffix.proposed === rnav.proposed) {
    return [merge(suffix, rnav)];
  }
  return [suffix, rnav].filter((amendment) => amendment !== undefined);
}
