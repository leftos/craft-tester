import type { AirportData, EquipmentSuffix, FleetEntry, Scenario } from '@/data/schema.ts';
import { citeSuffix } from '@/rules/amend/cite.ts';
import type { ResolvedAmendment } from '@/rules/amend/types.ts';
import type { Classification } from '@/rules/classify.ts';
import { formatAltitude } from '@/rules/grade.ts';
import { isSidToken } from '@/rules/route.ts';
import type { Unresolved } from '@/rules/types.ts';
import { unresolved } from '@/rules/unresolved.ts';

/** The table of equipment suffixes as a reason names it. */
const SUFFIX_TABLE = 'FAA JO 7110.65 Table 5-4-1';

/** A suffix the fleet files for the type, together with the table row that describes it. */
type ProposedSuffix = { suffix: string; row: EquipmentSuffix };

/** An amendment for the type box, which is the only box these checks raise one for. */
export type TypeAmendment = Extract<ResolvedAmendment, { box: 'type' }>;

/** The fleet row for the filed type, absent when the fleet does not list it. */
function fleetFor(scenario: Scenario, airport: AirportData): FleetEntry | undefined {
  return airport.routeLibrary.fleet.find((row) => row.type === scenario.aircraftType);
}

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
 * Checks the equipment suffix of the type box: none filed, or one no longer in the equipment table.
 *
 * The box is amended to the suffix the fleet files for the type. This is the first check of the
 * strip and the one every other box is then judged behind, because the suffix decides what the SOP
 * assigns the flight: the altitude and the route are read for the plan this amendment leaves.
 *
 * @param scenario The filed flight plan.
 * @param airport The airport data, whose `equipmentSuffixes` is the table the suffix must be in.
 * @returns The amendment, `undefined` when the filed suffix stands, or `Unresolved` when the data
 *   holds no suffix to propose for the type.
 */
export function checkSuffix(
  scenario: Scenario,
  airport: AirportData,
): TypeAmendment | Unresolved | undefined {
  const fleet = fleetFor(scenario, airport);
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
 * The second amendment for the type box, raised by a non-RNAV flight filing an RNAV procedure.
 *
 * The plan is wrong in two ways at once and the data does not say which the controller meant: the
 * suffix can be raised to an RNAV one, which leaves the plan the pilot filed standing, or every
 * other box that plan is wrong in can be amended around the suffix it filed. This check names the
 * suffix only; whether it is the answer to the whole plan is the engine's to decide, because the
 * pair is raised only where the plan with that suffix needs no amendment at all.
 *
 * @param scenario The plan as the type box's own suffix check leaves it.
 * @param ctx That plan's classification, which carries the RNAV capability the suffix gave it.
 * @param airport The airport data.
 * @returns The amendment, or `undefined` when the plan raises no such ambiguity.
 */
export function checkRnavClash(
  scenario: Scenario,
  ctx: Classification,
  airport: AirportData,
): TypeAmendment | undefined {
  const fleet = fleetFor(scenario, airport);
  if (ctx.rnavCapable || fleet === undefined) return undefined;
  const sid = filedSid(scenario, airport);
  if (sid === undefined || !sid.rnavRequired) return undefined;
  const proposed = fleetSuffix(fleet, airport, (row) => row.rnav);
  if (proposed === undefined) return undefined;
  const level = formatAltitude(scenario.filedAltitude);
  return {
    box: 'type',
    proposed: typeBox(scenario, proposed.suffix),
    reason:
      `an RNAV suffix would make the plan correct as filed: the filed ${sid.id}, the route ` +
      `and ${level} all stand for a ${proposed.suffix} flight`,
    citations: [citeSuffix(proposed.row)],
  };
}
