import type { AirportData, Destination, EquipmentSuffix, Scenario, Sid } from '@/data/schema.ts';
import { resolveAmendments } from '@/rules/amend/engine.ts';
import type { Box } from '@/rules/amend/grade.ts';
import type { AmendmentResult } from '@/rules/amend/types.ts';
import { isSidToken } from '@/rules/route.ts';
import type { ScenarioFilter } from '@/scenario/filter.ts';
import { generateScenario } from '@/scenario/generate.ts';
import type { Rng, Weighted } from '@/scenario/rng.ts';

/** One way a filed flight plan can be wrong, which is one fault the injection writes into it. */
export type FaultKind =
  | 'stale_sid'
  | 'other_sid'
  | 'no_sid'
  | 'wrong_tec_route'
  | 'dropped_transition'
  | 'parity_flip'
  | 'non_rvsm_in_band'
  | 'missing_suffix'
  | 'unknown_suffix'
  | 'no_mode_c'
  | 'rnav_clash';

/**
 * Which strip boxes each fault means to make wrong.
 *
 * The RNAV clash takes two boxes because the data does not settle which of them the controller
 * amends: raising the suffix leaves the plan standing as filed, amending every other box the plan
 * is then wrong in fixes it the other way round. The clash is drawn outside the RVSM band, so the
 * other side of it is the route box alone.
 */
export const FAULT_BOXES: Record<FaultKind, readonly Box[]> = {
  stale_sid: ['route'],
  other_sid: ['route'],
  no_sid: ['route'],
  wrong_tec_route: ['route'],
  dropped_transition: ['route'],
  parity_flip: ['altitude'],
  non_rvsm_in_band: ['altitude'],
  missing_suffix: ['type'],
  unknown_suffix: ['type'],
  no_mode_c: ['type'],
  rnav_clash: ['type', 'route'],
};

/** A filed plan with the faults injected into it, and what the amendment engine makes of it. */
export type AmendmentScenario = {
  filed: Scenario;
  result: Extract<AmendmentResult, { ok: true }>;
  faults: FaultKind[];
};

/** A draw the injection threw away, and why, which is the caller's cue to draw again. */
export type RejectedDraw = { rejected: string };

/** What one injected fault writes into the plan, which is one box of the strip. */
type FaultPatch =
  | { field: 'equipmentSuffix'; suffix: string | null }
  | { field: 'filedAltitude'; feet: number }
  | { field: 'filedRoute'; route: string };

/**
 * How one fault is injected: what it writes, or `undefined` when this plan cannot carry it.
 *
 * The generator is the last parameter rather than the first, so the faults that need no draw of
 * their own take none.
 */
type Injector = (scenario: Scenario, airport: AirportData, rng: Rng) => FaultPatch | undefined;

/** One fault a draw injected: which fault it is and what it wrote. */
type TakenFault = { kind: FaultKind; patch: FaultPatch };

/**
 * The mix of fault counts: a fifth of the drill is a plan that is already correct as filed.
 *
 * Knowing that nothing needs changing is half the skill the mode trains, so the correct plan is a
 * scenario like any other rather than an accident of the draw.
 */
const FAULT_COUNTS: readonly Weighted<number>[] = [
  { item: 0, weight: 20 },
  { item: 1, weight: 50 },
  { item: 2, weight: 30 },
];

/** How many boxes of the strip one draw may ask the student to amend. */
const MAX_BOXES = 2;

/** How many draws may be thrown away before the generator gives up on the airport data. */
const MAX_ATTEMPTS = 50;

/** The RVSM band, inclusive, which the suffix faults are written around. */
const RVSM_FLOOR_FEET = 29000;
const RVSM_CEILING_FEET = 41000;

/** The step the altitude faults move the filed altitude by. */
const STEP_FEET = 1000;

/** The letters a suffix can be written with, in the order an unknown one is looked for. */
const SUFFIX_LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

/** The tokens of the route box, without the empty strings a doubled space would produce. */
function tokensOf(scenario: Scenario): string[] {
  return scenario.filedRoute
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/** The procedure token at the head of the route box, where it files one. */
function headOf(scenario: Scenario): string | undefined {
  const head = tokensOf(scenario)[0];
  return head !== undefined && isSidToken(head) ? head : undefined;
}

/** The published SID the route box files at the version in force, where it files one. */
function filedSid(scenario: Scenario, airport: AirportData): Sid | undefined {
  const head = headOf(scenario);
  return head === undefined ? undefined : airport.sids.find((sid) => sid.id === head);
}

/** The route box with another procedure token at its head, or with none at all. */
function withHead(scenario: Scenario, head: string | undefined): FaultPatch {
  const tail = tokensOf(scenario).slice(1);
  const tokens = head === undefined ? tail : [head, ...tail];
  return { field: 'filedRoute', route: tokens.join(' ') };
}

/** Whether an altitude is one the RVSM band holds. */
function inRvsmBand(feet: number): boolean {
  return feet >= RVSM_FLOOR_FEET && feet <= RVSM_CEILING_FEET;
}

/** The equipment table row for the filed suffix, where the table holds it. */
function suffixRow(scenario: Scenario, airport: AirportData) {
  return airport.equipmentSuffixes.find((row) => row.suffix === scenario.equipmentSuffix);
}

/** The route library's row for the filed destination, where it holds one. */
function destinationOf(scenario: Scenario, airport: AirportData): Destination | undefined {
  return airport.routeLibrary.destinations.find((row) => row.icao === scenario.destination);
}

/** The filed procedure one version behind the one in force, e.g. `TRUKN2` filed as `TRUKN1`. */
function staleSid(scenario: Scenario): FaultPatch | undefined {
  const head = headOf(scenario);
  if (head === undefined) return undefined;
  const version = Number(head.slice(-1));
  return withHead(scenario, `${head.slice(0, -1)}${version === 1 ? version + 1 : version - 1}`);
}

/** Another published procedure, of a family this plan does not file, that the flight could fly. */
function otherSid(scenario: Scenario, airport: AirportData, rng: Rng): FaultPatch | undefined {
  const head = headOf(scenario);
  if (head === undefined) return undefined;
  const rnav = suffixRow(scenario, airport)?.rnav === true;
  const family = head.slice(0, -1);
  const candidates = airport.sids.filter(
    (sid) => sid.family !== family && (rnav || !sid.rnavRequired),
  );
  return candidates.length === 0 ? undefined : withHead(scenario, rng.pick(candidates).id);
}

/** The route box with its procedure token dropped, the way a plan filed without one reads. */
function noSid(scenario: Scenario): FaultPatch | undefined {
  return headOf(scenario) === undefined ? undefined : withHead(scenario, undefined);
}

/**
 * Another destination's route, for a flight the TEC routes carry on a published one of its own.
 *
 * A tail the flight's own destination files is not another destination's route however it is
 * labelled: two TRACON destinations down the same corridor are filed over the same fixes, and
 * writing Watsonville's `EUGEN` into a Monterey plan would leave the plan correct as filed.
 */
function wrongTecRoute(scenario: Scenario, airport: AirportData, rng: Rng): FaultPatch | undefined {
  const destination = destinationOf(scenario, airport);
  if (destination?.nct !== true) return undefined;
  const routed = airport.tecRoutes.some(
    (row) => row.kind === 'tec' && row.destination === destination.icao,
  );
  const ownTails = new Set(
    airport.routeLibrary.routes
      .filter((row) => row.destination === scenario.destination)
      .map((row) => row.tail),
  );
  const others = airport.routeLibrary.routes.filter(
    (row) => row.destination !== scenario.destination && !ownTails.has(row.tail),
  );
  if (!routed || others.length === 0) return undefined;
  const head = headOf(scenario);
  const tail = rng.pick(others).tail;
  return { field: 'filedRoute', route: head === undefined ? tail : `${head} ${tail}` };
}

/**
 * The route box with the transition after its procedure token dropped.
 *
 * Only a transition the route builder puts back is worth dropping: the one the SOP's assignment row
 * forces for the hour, or the one the ZOA cheat sheet connects onward to the next fix filed. Either
 * way the box still reads as an ordinary route without it, and what the student has to see is that
 * the SOP's route for the hour, or the sheet's connection, belongs back in it.
 *
 * @param scenario The clean plan the fault is measured against.
 * @param airport The airport data, for its assignment rows and the cheat sheet's connections.
 * @returns The route box without its second token, or undefined when that token is neither a forced
 *   transition of the filed family nor a fix that connects onward to the next one filed.
 */
export function droppedTransition(
  scenario: Scenario,
  airport: AirportData,
): FaultPatch | undefined {
  const head = headOf(scenario);
  const tokens = tokensOf(scenario);
  const [, second, third] = tokens;
  if (head === undefined || second === undefined) return undefined;
  const family = head.slice(0, -1);
  const forced = airport.assignmentRules.some(
    (row) => row.sidFamily === family && row.when?.forcedTransition === second,
  );
  const connected = airport.routeConnections.some((row) => row.from === second && row.to === third);
  if (!forced && !connected) return undefined;
  return { field: 'filedRoute', route: [...tokens.slice(0, 1), ...tokens.slice(2)].join(' ') };
}

/** The filed altitude a thousand feet up, which reads the other half of the parity table. */
function parityFlip(scenario: Scenario): FaultPatch {
  return { field: 'filedAltitude', feet: scenario.filedAltitude + STEP_FEET };
}

/**
 * A suffix without RVSM approval, for a plan filed inside the band.
 *
 * The row is RNAV and reports Mode C, so the altitude box is the only one the fault makes wrong:
 * a suffix without either of those would be amended in the type box before the altitude is read.
 */
function nonRvsmInBand(scenario: Scenario, airport: AirportData): FaultPatch | undefined {
  if (!inRvsmBand(scenario.filedAltitude)) return undefined;
  const row = airport.equipmentSuffixes.find(
    (entry) => !entry.rvsm && entry.rnav === true && entry.transponderModeC,
  );
  return row === undefined ? undefined : { field: 'equipmentSuffix', suffix: row.suffix };
}

/**
 * Whether a plan can carry a suffix fault that leaves every other box alone.
 *
 * A plan with no suffix, and one whose suffix the equipment table does not hold, both read as
 * neither RNAV nor RVSM approved: the altitude must therefore sit outside the RVSM band and the
 * filed procedure must be one a non-RNAV flight may fly, or the fault would take a second box.
 */
function takesPlainSuffixFault(scenario: Scenario, airport: AirportData): boolean {
  const sid = filedSid(scenario, airport);
  return !inRvsmBand(scenario.filedAltitude) && sid !== undefined && !sid.rnavRequired;
}

/** No equipment suffix filed at all. */
function missingSuffix(scenario: Scenario, airport: AirportData): FaultPatch | undefined {
  if (!takesPlainSuffixFault(scenario, airport)) return undefined;
  return { field: 'equipmentSuffix', suffix: null };
}

/** A suffix the equipment table does not hold. */
function unknownSuffix(scenario: Scenario, airport: AirportData): FaultPatch | undefined {
  if (!takesPlainSuffixFault(scenario, airport)) return undefined;
  const letter = SUFFIX_LETTERS.find(
    (candidate) => !airport.equipmentSuffixes.some((row) => row.suffix === `/${candidate}`),
  );
  return letter === undefined ? undefined : { field: 'equipmentSuffix', suffix: `/${letter}` };
}

/**
 * How much a row of the table reads like another: the capabilities the two state alike.
 *
 * @param row The row a fault would write into the plan.
 * @param filed The row the plan files, absent where the table does not hold its suffix.
 * @returns How many of RNAV and RVSM the two rows agree on.
 */
function alike(row: EquipmentSuffix, filed: EquipmentSuffix | undefined): number {
  return Number(row.rnav === filed?.rnav) + Number(row.rvsm === filed?.rvsm);
}

/**
 * A suffix whose row reports no altitude, which no aircraft on VATSIM files.
 *
 * The row is chosen to read like the filed one in everything but Mode C where the table holds such
 * a row — an RNAV plan takes an RNAV row — so the type box is the only one the fault makes wrong.
 */
function noModeC(scenario: Scenario, airport: AirportData): FaultPatch | undefined {
  const filed = suffixRow(scenario, airport);
  const rows = airport.equipmentSuffixes.filter((entry) => !entry.transponderModeC);
  const row = [...rows].sort((left, right) => alike(right, filed) - alike(left, filed))[0];
  return row === undefined ? undefined : { field: 'equipmentSuffix', suffix: row.suffix };
}

/**
 * A suffix without RNAV capability, for a plan that files an RNAV procedure.
 *
 * The fault is drawn only outside the RVSM band, so the non-RNAV suffix leaves the altitude box
 * alone: the other side of the clash is then the route box by itself, and the draw stays at the two
 * boxes `FAULT_BOXES` says it takes. The row reports Mode C, which the type box would otherwise be
 * amended for before the clash is ever read.
 */
function rnavClash(scenario: Scenario, airport: AirportData): FaultPatch | undefined {
  const sid = filedSid(scenario, airport);
  if (sid === undefined || !sid.rnavRequired || inRvsmBand(scenario.filedAltitude))
    return undefined;
  const row = airport.equipmentSuffixes.find(
    (entry) => entry.rnav !== true && entry.transponderModeC,
  );
  return row === undefined ? undefined : { field: 'equipmentSuffix', suffix: row.suffix };
}

/** How every fault is injected, in the order the applicable ones are collected. */
const INJECTORS: Record<FaultKind, Injector> = {
  stale_sid: staleSid,
  other_sid: otherSid,
  no_sid: noSid,
  wrong_tec_route: wrongTecRoute,
  dropped_transition: droppedTransition,
  parity_flip: parityFlip,
  non_rvsm_in_band: nonRvsmInBand,
  missing_suffix: missingSuffix,
  unknown_suffix: unknownSuffix,
  no_mode_c: noModeC,
  rnav_clash: rnavClash,
};

/** Every fault kind, in the order the tables list them. */
const FAULT_KINDS = Object.keys(INJECTORS) as FaultKind[];

/** The plan with one fault's value written into the box it takes. */
function applyPatch(scenario: Scenario, patch: FaultPatch): Scenario {
  if (patch.field === 'equipmentSuffix') return { ...scenario, equipmentSuffix: patch.suffix };
  if (patch.field === 'filedAltitude') return { ...scenario, filedAltitude: patch.feet };
  return { ...scenario, filedRoute: patch.route };
}

/** The boxes a set of faults means to make wrong. */
function boxesOf(faults: readonly FaultKind[]): Set<Box> {
  return new Set(faults.flatMap((kind) => [...FAULT_BOXES[kind]]));
}

/** Whether two sets hold the same boxes. */
function sameBoxes(left: Set<Box>, right: Set<Box>): boolean {
  return left.size === right.size && [...left].every((box) => right.has(box));
}

/** A set of boxes named the way the reason a draw was thrown away names it. */
function boxLabel(boxes: Set<Box>): string {
  return boxes.size === 0 ? 'nothing' : [...boxes].sort().join(' and ');
}

/**
 * Draws the faults one plan carries: a shuffle of the ones it can take, taken greedily.
 *
 * A fault whose boxes another taken fault already holds is skipped, and so is one that would push
 * the draw past `MAX_BOXES`, which is what keeps the two-box RNAV clash from ever being paired.
 *
 * @param rng The seeded generator; the shuffle and every fault's own draw advance it.
 * @param scenario The clean plan the faults are measured against.
 * @param airport The airport data.
 * @param wanted How many faults the draw asked for.
 * @returns The faults taken, which is fewer than `wanted` when the plan cannot carry that many.
 */
function pickFaults(
  rng: Rng,
  scenario: Scenario,
  airport: AirportData,
  wanted: number,
): TakenFault[] {
  if (wanted === 0) return [];
  const applicable: TakenFault[] = [];
  for (const kind of FAULT_KINDS) {
    const patch = INJECTORS[kind](scenario, airport, rng);
    if (patch !== undefined) applicable.push({ kind, patch });
  }
  const taken: TakenFault[] = [];
  const boxes = new Set<Box>();
  for (const fault of rng.shuffle(applicable)) {
    if (taken.length === wanted) break;
    const wants = FAULT_BOXES[fault.kind];
    if (wants.some((box) => boxes.has(box)) || boxes.size + wants.length > MAX_BOXES) continue;
    for (const box of wants) boxes.add(box);
    taken.push(fault);
  }
  return taken;
}

/**
 * Draws one candidate amendment scenario and runs the amendment engine over it.
 *
 * Every fault is detectable by construction: the draw is kept only when the engine amends exactly
 * the boxes the injected faults meant it to, so a fault the data happens to make legal, and a plan
 * the airport data was already going to have the controller amend, are both thrown away rather
 * than presented as something they are not.
 *
 * @param rng The seeded generator; the clean draw, the fault count and every fault advance it.
 * @param airport The airport data the plan is drawn from.
 * @param filter The time of day and the runway configurations the draw is narrowed to.
 * @returns The scenario, or the reason the draw was thrown away, which is the caller's cue to draw
 *   again.
 */
export function drawAmendmentScenario(
  rng: Rng,
  airport: AirportData,
  filter: ScenarioFilter,
): AmendmentScenario | RejectedDraw {
  const clean = generateScenario(rng, airport, filter);
  const taken = pickFaults(rng, clean, airport, rng.weighted(FAULT_COUNTS));
  const filed = taken.reduce((plan, fault) => applyPatch(plan, fault.patch), clean);
  const result = resolveAmendments(filed, airport);
  if (!result.ok) {
    const gaps = result.unresolved.map((gap) => gap.element).join(', ');
    return { rejected: `the engine could not answer ${gaps}` };
  }
  const raised = new Set(result.amendments.map((amendment) => amendment.box));
  const intended = boxesOf(taken.map((fault) => fault.kind));
  if (!sameBoxes(raised, intended)) {
    return {
      rejected: `the plan amends ${boxLabel(raised)} where the faults meant ${boxLabel(intended)}`,
    };
  }
  return { filed, result, faults: taken.map((fault) => fault.kind) };
}

/**
 * Generates an amendment scenario, drawing again while a draw is not the drill it was meant to be.
 *
 * @param rng The seeded generator; the same seed and filter always yield the same scenario.
 * @param airport The airport data the plan is drawn from.
 * @param filter The time of day and the runway configurations the draw is narrowed to.
 * @returns The filed plan, the amendments it needs, and which faults were injected into it.
 * @throws Error When `MAX_ATTEMPTS` draws in a row were all thrown away, naming the last reason.
 */
export function generateAmendmentScenario(
  rng: Rng,
  airport: AirportData,
  filter: ScenarioFilter,
): AmendmentScenario {
  let last = 'no draw was attempted';
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const drawn = drawAmendmentScenario(rng, airport, filter);
    if (!('rejected' in drawn)) return drawn;
    last = drawn.rejected;
  }
  throw new Error(`no amendment scenario in ${MAX_ATTEMPTS} draws; the last went because ${last}`);
}
