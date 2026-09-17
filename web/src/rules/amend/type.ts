import type { AirportData, EquipmentSuffix, FleetEntry, Scenario } from '@/data/schema.ts';
import { citeSuffix } from '@/rules/amend/cite.ts';
import type { ResolvedAmendment } from '@/rules/amend/types.ts';
import { citePhraseology } from '@/rules/cite.ts';
import type { Classification } from '@/rules/classify.ts';
import { formatAltitude } from '@/rules/grade.ts';
import type { RnavElement } from '@/rules/route.ts';
import { isSidToken, lackingRnavElements } from '@/rules/route.ts';
import type { Unresolved } from '@/rules/types.ts';
import { unresolved } from '@/rules/unresolved.ts';

/** The table of equipment suffixes as a reason names it. */
const SUFFIX_TABLE = 'FAA JO 7110.65 TBL 2-3-10';

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
 * What is wrong with the filed suffix, which is the first half of the reason the box is amended.
 *
 * @param filed The suffix the plan filed, or `null` where it filed none.
 * @param row The table row for that suffix, absent where the table does not hold it.
 * @returns The fault named, which on a row the table does hold is the missing Mode C transponder.
 */
function suffixFault(filed: string | null, row: EquipmentSuffix | undefined): string {
  if (filed === null) return 'no equipment suffix filed';
  if (row === undefined) return `suffix ${filed} is not in ${SUFFIX_TABLE}`;
  return `suffix ${filed} has no Mode C transponder, which every aircraft on VATSIM simulates`;
}

/**
 * Checks the equipment suffix of the type box: none filed, one no longer in the equipment table, or
 * one whose row reports no altitude.
 *
 * The box is amended to the first suffix the fleet files for the type whose row carries Mode C.
 * Every aircraft on VATSIM simulates a Mode C transponder, so a suffix the table holds is still not
 * one that is filed on the network unless its row reports altitude. This is the first check of the
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
  const filed = scenario.equipmentSuffix;
  const row = airport.equipmentSuffixes.find((entry) => entry.suffix === filed);
  if (row?.transponderModeC === true) return undefined;
  const fleet = fleetFor(scenario, airport);
  if (fleet === undefined) {
    return unresolved(
      'BOX.type',
      `aircraft type ${scenario.aircraftType} is not in the fleet, so the data holds no equipment suffix to propose for it`,
    );
  }
  const proposed = fleetSuffix(fleet, airport, (entry) => entry.transponderModeC);
  if (proposed === undefined) {
    return unresolved(
      'BOX.type',
      `the fleet files a ${fleet.type} with suffixes the equipment table does not hold, so the data holds none to propose`,
    );
  }
  const modeC = row === undefined ? [] : citePhraseology(airport, 'T-MODE-C');
  return {
    box: 'type',
    proposed: typeBox(scenario, proposed.suffix),
    reason: `${suffixFault(filed, row)}; the fleet files a ${fleet.type} as ${typeBox(scenario, proposed.suffix)}`,
    citations: [...modeC, citeSuffix(proposed.row)],
  };
}

/** The published SID the route box files, where it files one at the version in force. */
function filedSid(scenario: Scenario, airport: AirportData) {
  const head = scenario.filedRoute.trim().split(/\s+/)[0];
  if (head === undefined || !isSidToken(head)) return undefined;
  return airport.sids.find((sid) => sid.id === head);
}

/** A list of tokens written the way a reason reads them out: `A`, `A and B`, `A, B and C`. */
function listWords(items: readonly string[]): string {
  const head = items.slice(0, -1).join(', ');
  const last = items[items.length - 1] ?? '';
  return head === '' ? last : `${head} and ${last}`;
}

/**
 * How a reason names the elements of the route the filed suffix cannot fly: one clause per kind.
 *
 * The airways are named together and the waypoints together — "Q124 is an RNAV route", "KAMPR and
 * LOSHN are RNAV waypoints" — so a route wrong in both ways reads as two clauses rather than one per
 * token.
 *
 * @param elements The elements of the route the suffix cannot fly, in the order the route files them.
 * @returns One clause per kind of element present, airways first.
 */
function elementClauses(elements: readonly RnavElement[]): string[] {
  const kinds: { kind: RnavElement['kind']; singular: string; plural: string }[] = [
    { kind: 'airway', singular: 'is an RNAV route', plural: 'are RNAV routes' },
    { kind: 'waypoint', singular: 'is an RNAV waypoint', plural: 'are RNAV waypoints' },
  ];
  return kinds.flatMap(({ kind, singular, plural }) => {
    const tokens = elements.filter((element) => element.kind === kind).map((el) => el.token);
    if (tokens.length === 0) return [];
    return [`${listWords(tokens)} ${tokens.length === 1 ? singular : plural}`];
  });
}

/**
 * The reason the type box could carry an RNAV suffix instead, which names what needs one.
 *
 * A plan that only files an RNAV procedure names it and reads straight on into what stands: "the
 * filed CNDEL5, the route and FL350 all stand for a /L flight". Where the route carries RNAV
 * elements as well, each group of them is a clause of its own and the procedure becomes one too, so
 * the reason reads as a list rather than running the procedure and the first group together.
 *
 * @param procedure How the reason names the filed procedure, absent where the procedure needs
 *   nothing the suffix has not.
 * @param clauses The route elements the suffix cannot fly, one clause per kind.
 * @param scenario The plan as the type box's own suffix check leaves it.
 * @param suffix The RNAV suffix the fleet files, which the reason closes on.
 * @returns The reason, written for the player.
 */
function clashReason(
  procedure: string | undefined,
  clauses: readonly string[],
  scenario: Scenario,
  suffix: string,
): string {
  const opening = 'an RNAV suffix would make the plan correct as filed';
  const tail = `the route and ${formatAltitude(scenario.filedAltitude)} all stand for a ${suffix} flight`;
  if (clauses.length === 0) return `${opening}: ${procedure ?? ''}, ${tail}`;
  const named = [...(procedure === undefined ? [] : [`${procedure} needs RNAV`]), ...clauses];
  return `${opening}: ${named.join(', ')}, and ${tail}`;
}

/** The rule rows that say what a filed RNAV element takes, one row per kind of element. */
function elementCitations(elements: readonly RnavElement[], airport: AirportData) {
  const ids = [
    ...(elements.some((element) => element.kind === 'airway') ? ['R-RNAV-AIRWAY'] : []),
    ...(elements.some((element) => element.kind === 'waypoint') ? ['R-RNAV-WAYPOINT'] : []),
  ];
  return citePhraseology(airport, ...ids);
}

/**
 * The second amendment for the type box, raised by a flight filing navigation its suffix has not.
 *
 * An RNAV procedure needs it, and so does the route itself: a Q route and an RNAV waypoint are
 * filed by an RNAV-capable aircraft, a T or Y route by a GPS-equipped one. The plan is then wrong
 * in two ways at once and the data does not say which the controller meant: the suffix can be
 * raised to one that carries what the plan needs, which leaves the plan the pilot filed standing,
 * or every other box that plan is wrong in can be amended around the suffix it filed. This check
 * names the suffix only; whether it is the answer to the whole plan is the engine's to decide,
 * because the pair is raised only where the plan with that suffix needs no amendment at all.
 *
 * @param scenario The plan as the type box's own suffix check leaves it.
 * @param ctx That plan's classification, which carries the navigation the suffix gave it.
 * @param airport The airport data.
 * @returns The amendment, or `undefined` when the plan raises no such ambiguity.
 */
export function checkRnavClash(
  scenario: Scenario,
  ctx: Classification,
  airport: AirportData,
): TypeAmendment | undefined {
  const fleet = fleetFor(scenario, airport);
  if (fleet === undefined) return undefined;
  const sid = filedSid(scenario, airport);
  const sidNeeds = sid !== undefined && sid.rnavRequired && !ctx.rnavCapable;
  const elements = lackingRnavElements(scenario, ctx, airport);
  if (!sidNeeds && elements.length === 0) return undefined;
  const gnss = elements.some((element) => element.needs === 'gnss');
  const proposed = fleetSuffix(
    fleet,
    airport,
    (row) => row.rnav === true && row.transponderModeC && (!gnss || row.gnss === true),
  );
  if (proposed === undefined) return undefined;
  const procedure = sidNeeds && sid !== undefined ? `the filed ${sid.id}` : undefined;
  return {
    box: 'type',
    proposed: typeBox(scenario, proposed.suffix),
    reason: clashReason(procedure, elementClauses(elements), scenario, proposed.suffix),
    citations: [citeSuffix(proposed.row), ...elementCitations(elements, airport)],
  };
}

/** What a reason calls the navigation the lacking elements take, which is the GPS a T route needs. */
function needsWords(elements: readonly RnavElement[]): string {
  const words = [
    ...(elements.some((element) => element.needs === 'rnav') ? ['RNAV'] : []),
    ...(elements.some((element) => element.needs === 'gnss') ? ['GPS'] : []),
  ];
  return words.join(' and ');
}

/** How a reason names the flight by the suffix it files, which is the box being amended. */
function suffixWords(scenario: Scenario): string {
  const { equipmentSuffix } = scenario;
  return equipmentSuffix === null ? 'a flight with no suffix filed' : `a ${equipmentSuffix} flight`;
}

/**
 * The reason the type box carries an RNAV suffix: the route files navigation the plan has not, and
 * no route without it can be proposed.
 *
 * @param elements The elements of the filed route the flight's suffix cannot fly.
 * @param scenario The plan as the type box's own suffix check leaves it.
 * @returns The reason, written for the player.
 */
function elementReason(elements: readonly RnavElement[], scenario: Scenario): string {
  return (
    `the route needs ${needsWords(elements)} ${suffixWords(scenario)} does not carry ` +
    `(${elementClauses(elements).join(', ')}) and the data holds no conventional route, so the ` +
    `type box carries the suffix the fleet files for the type`
  );
}

/**
 * The type box a route only a better-equipped aircraft may file leaves as the one answer.
 *
 * Where the route check could propose no route without the RNAV elements the plan files — the
 * conventional airway structure that would replace them is not in the data — the plan is not wrong
 * in two ways the controller chooses between, as the clash is: the route stands and the suffix is
 * what has to give. The box is raised to the first suffix the fleet files for the type that carries
 * the navigation the route needs, and the rest of the strip is then judged for that plan.
 *
 * @param scenario The plan as the type box's own suffix check leaves it.
 * @param ctx That plan's classification, which carries the navigation the suffix gave it.
 * @param airport The airport data.
 * @returns The amendment, or `undefined` when the fleet files no suffix that carries what the route
 *   needs, which leaves the route box the gap it is.
 */
export function checkRnavElements(
  scenario: Scenario,
  ctx: Classification,
  airport: AirportData,
): TypeAmendment | undefined {
  const fleet = fleetFor(scenario, airport);
  if (fleet === undefined) return undefined;
  const elements = lackingRnavElements(scenario, ctx, airport);
  if (elements.length === 0) return undefined;
  const gnss = elements.some((element) => element.needs === 'gnss');
  const proposed = fleetSuffix(
    fleet,
    airport,
    (row) => row.rnav === true && row.transponderModeC && (!gnss || row.gnss === true),
  );
  if (proposed === undefined) return undefined;
  return {
    box: 'type',
    proposed: typeBox(scenario, proposed.suffix),
    reason: elementReason(elements, scenario),
    citations: [citeSuffix(proposed.row), ...elementCitations(elements, airport)],
  };
}
