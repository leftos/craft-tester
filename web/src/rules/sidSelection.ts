import type {
  AirportData,
  AssignmentCondition,
  AssignmentRule,
  Direction,
  Notice,
  Scenario,
  Sid,
} from '@/data/schema.ts';
import type { Classification } from '@/rules/classify.ts';
import { addresses } from '@/rules/classify.ts';
import { keyedTecRoute, tecHead } from '@/rules/tecRoutes.ts';
import type { SelectedProcedure, Unresolved } from '@/rules/types.ts';
import { isUnresolved, unresolved } from '@/rules/unresolved.ts';

/** Half a circle: a heading this far from the runway bearing turns neither way by less. */
const OPPOSITE_DEGREES = 180;

/** What an assignment row put the flight on: a SID, or a heading, with its rows. */
export type SidSelection = {
  procedure: SelectedProcedure;
  row: AssignmentRule;
  sector: string;
  notices: Notice[];
};

/** The filed plan with the airport data it is read against, passed to the row tests as one. */
type Flight = {
  scenario: Scenario;
  airport: AirportData;
};

/**
 * Whether the flight's TEC route is one that carries no departure procedure.
 *
 * The row that keys the flight is the route it would be issued, and a row that begins on anything
 * but a departure family — an initial heading, a fix, an airway — is one no procedure fits, which
 * SOP 2-1 c makes the case for clearing the flight on a heading. A flight with no TEC route at all
 * is not such a case.
 */
function tecRouteWithoutDp(ctx: Classification, flight: Flight): boolean {
  const row = keyedTecRoute(ctx, flight.scenario, flight.airport);
  return row !== undefined && tecHead(row).kind !== 'family';
}

/**
 * Whether every extra condition of a row holds for this flight.
 *
 * `exitFixes` is matched against the element the flight leaves on, so a row that lists fixes never
 * applies to a route that joins an airway straight off the SID. `tecRouteWithoutDp` is read against
 * the TEC route the flight would be issued, and is the only condition that looks outside the
 * classified flight, so the row tests carry the filed plan and the airport data with them.
 */
function conditionsHold(
  when: AssignmentCondition,
  ctx: Classification,
  exitElement: string,
  flight: Flight,
): boolean {
  return [
    when.configs === undefined || when.configs.includes(ctx.config.id),
    when.notConfigs === undefined || !when.notConfigs.includes(ctx.config.id),
    when.noiseWindow === undefined || ctx.activeNoiseWindows.includes(when.noiseWindow),
    when.rnav === undefined || when.rnav === ctx.rnavCapable,
    when.exitFixes === undefined || when.exitFixes.includes(exitElement),
    when.tecRouteWithoutDp === undefined ||
      when.tecRouteWithoutDp === tecRouteWithoutDp(ctx, flight),
  ].every(Boolean);
}

/**
 * Whether a row's plan, direction, runway family, audience, and conditions all match.
 *
 * The audience is the class, group and approach category the row is written for, which `addresses`
 * reads against the airport's `aircraftGroups`.
 */
function rowApplies(
  row: AssignmentRule,
  ctx: Classification,
  exitElement: string,
  direction: Direction | undefined,
  flight: Flight,
): boolean {
  if (row.plan !== ctx.plan) return false;
  if (row.direction !== 'any' && row.direction !== direction) return false;
  if (!row.runwayFamilies.includes(ctx.runwayFamily)) return false;
  if (!addresses(row, ctx, flight.airport)) return false;
  return row.when === undefined || conditionsHold(row.when, ctx, exitElement, flight);
}

/** The active notice, if any, that takes a row's SID family out of use. */
function sidOffNotice(
  sidFamily: string | null,
  ctx: Classification,
  airport: AirportData,
): Notice | undefined {
  if (sidFamily === null) return undefined;
  return airport.notices.find(
    (notice) =>
      ctx.activeNotices.includes(notice.id) &&
      (notice.plan === undefined || notice.plan === ctx.plan) &&
      notice.effect.kind === 'sid_off' &&
      notice.effect.sidFamily === sidFamily,
  );
}

/**
 * Whether the SID reaches the exit element: by transition, by its base fix, or by radar vectors.
 *
 * A route that joins an airway leaves on the airway, which no chart publishes as a transition or a
 * base fix, so only a SID that ends in vectors can serve it.
 */
function servesExitElement(sid: Sid, exitElement: string): boolean {
  if (sid.kind === 'radar_vectors' || sid.kind === 'vector_hybrid') return true;
  if (sid.transitions.some((transition) => transition.fix === exitElement)) return true;
  return sid.baseFix === exitElement;
}

/** Whether the flight can fly the SID at all: off its runway, with the equipment it carries. */
function isFlyable(sid: Sid, scenario: Scenario, ctx: Classification): boolean {
  return sid.runways.includes(scenario.departureRunway) && (!sid.rnavRequired || ctx.rnavCapable);
}

/** Whether the flight can fly the SID from its runway with its equipment to its exit element. */
function isCompatible(
  sid: Sid,
  exitElement: string,
  scenario: Scenario,
  ctx: Classification,
): boolean {
  return isFlyable(sid, scenario, ctx) && servesExitElement(sid, exitElement);
}

/** Names the data gap when no row produced a SID, listing the rows that matched but did not fit. */
function noSidReason(
  ctx: Classification,
  direction: Direction | undefined,
  incompatible: readonly string[],
): string {
  const flight = `${ctx.plan} ${direction ?? 'no-gate'} runway ${ctx.runwayFamily} class ${ctx.aircraftClass}`;
  return incompatible.length === 0
    ? `no assignment rule applies to ${flight}`
    : `no compatible SID for ${flight}; rules applied but incompatible: ${incompatible.join(', ')}`;
}

/**
 * The heading a row with no SID family clears the flight on, with the turn onto it.
 *
 * The runway heading needs no turn. A numbered heading is flown by turning the shorter way round
 * from the departure runway's magnetic bearing, so the runway's CIFP bearing has to be on file; a
 * heading opposite that bearing has no shorter way round and is a data error in the row.
 */
function headingProcedure(
  row: AssignmentRule,
  scenario: Scenario,
  airport: AirportData,
): SelectedProcedure | Unresolved {
  const heading = row.nonDpHeading;
  if (heading === undefined) {
    return unresolved('R.sid', `${row.id} assigns no SID family and names no heading at all`);
  }
  if (heading === 'runway heading') return { kind: 'heading', heading, turn: undefined };
  const runway = airport.runways.find((entry) => entry.designator === scenario.departureRunway);
  if (runway === undefined) {
    return unresolved(
      'R.sid',
      `${scenario.departureRunway} has no CIFP runway record with a bearing, so the turn onto heading ${heading} cannot be derived`,
    );
  }
  const delta = ((heading - runway.magneticBearing + 540) % 360) - 180;
  if (Math.abs(delta) === OPPOSITE_DEGREES) {
    return unresolved(
      'R.sid',
      `${row.id} clears the flight on heading ${heading}, opposite runway ${runway.designator} on ${runway.magneticBearing}, which leaves no shorter turn`,
    );
  }
  if (delta === 0) return { kind: 'heading', heading, turn: undefined };
  return { kind: 'heading', heading, turn: delta > 0 ? 'right' : 'left' };
}

/**
 * The gap where a row written for a TEC route without a DP names another heading than the route.
 *
 * The SOP row and the route tool's row are one fact transcribed twice: the SOP names the heading
 * the flight is cleared on, and the route it is issued begins on that same heading. Where the two
 * disagree one of them is mistranscribed, and there is no answer to give until the data is fixed.
 *
 * @param row The assignment row selected for the flight.
 * @param ctx The classified flight.
 * @param flight The filed plan and the airport data.
 * @returns `Unresolved` naming both rows, or `undefined` where they agree or the row names no
 *   numbered heading of its own.
 */
function tecHeadConflict(
  row: AssignmentRule,
  ctx: Classification,
  flight: Flight,
): Unresolved | undefined {
  if (row.when?.tecRouteWithoutDp !== true || typeof row.nonDpHeading !== 'number')
    return undefined;
  const tec = keyedTecRoute(ctx, flight.scenario, flight.airport);
  if (tec === undefined) return undefined;
  const head = tecHead(tec);
  if (head.kind !== 'heading' || head.heading === row.nonDpHeading) return undefined;
  return unresolved(
    'R.sid',
    `${row.id} clears the flight on heading ${row.nonDpHeading} but its TEC route ${tec.id} begins on heading ${head.heading}`,
  );
}

/**
 * Walks the assignment table in order and takes the first row whose SID the flight can fly.
 *
 * A row whose SID family an active notice has taken out of use is skipped, and the notice travels
 * with the selection so the clearance can cite it. A notice that issues a heading in the DP's place
 * skips nothing: the row it names clears the flight on the notice's heading, with the sector and
 * conditions the row already carries, and both the row and the notice are cited. A row that assigns
 * no SID family clears the flight on the heading it names instead, which the engine issues in place
 * of a procedure; where
 * that row is written for a flight whose TEC route carries no departure procedure, the heading it
 * names and the one that route begins on must agree.
 *
 * @param ctx The classified flight.
 * @param exitElement The fix, or the airway, the flight leaves the terminal on.
 * @param direction The gate direction of the route's first fix, undefined when it is not a gate.
 * @param scenario The filed flight plan.
 * @param airport The airport data.
 * @returns The selected SID or heading with its row and sector, or `Unresolved` naming the gap.
 */
export function selectSid(
  ctx: Classification,
  exitElement: string,
  direction: Direction | undefined,
  scenario: Scenario,
  airport: AirportData,
): SidSelection | Unresolved {
  const incompatible: string[] = [];
  const notices: Notice[] = [];
  const flight: Flight = { scenario, airport };
  for (const row of airport.assignmentRules) {
    if (!rowApplies(row, ctx, exitElement, direction, flight)) continue;
    const notice = sidOffNotice(row.sidFamily, ctx, airport);
    if (notice !== undefined) {
      const { heading } = notice.effect;
      if (heading === undefined) {
        notices.push(notice);
        continue;
      }
      const asHeading: AssignmentRule = { ...row, sidFamily: null, nonDpHeading: heading };
      const conflict = tecHeadConflict(asHeading, ctx, flight);
      if (conflict !== undefined) return conflict;
      const procedure = headingProcedure(asHeading, scenario, airport);
      if (isUnresolved(procedure)) return procedure;
      return { procedure, row: asHeading, sector: row.sector, notices: [...notices, notice] };
    }
    if (row.sidFamily === null) {
      const conflict = tecHeadConflict(row, ctx, flight);
      if (conflict !== undefined) return conflict;
      const procedure = headingProcedure(row, scenario, airport);
      if (isUnresolved(procedure)) return procedure;
      return { procedure, row, sector: row.sector, notices };
    }
    const sid = airport.sids.find(
      (entry) => entry.family === row.sidFamily && isCompatible(entry, exitElement, scenario, ctx),
    );
    if (sid === undefined) {
      incompatible.push(row.id);
      continue;
    }
    return { procedure: { kind: 'sid', sid }, row, sector: row.sector, notices };
  }
  return unresolved('R.sid', noSidReason(ctx, direction, incompatible));
}

/** A SID an applicable row assigns that the flight can fly but that does not reach its exit. */
export type UnservedSid = {
  sid: Sid;
  row: AssignmentRule;
};

/**
 * The SIDs of the rows `selectSid` walks past because their SID does not reach the exit element.
 *
 * Those rows are the SOP's own answer for the flight, passed over only because the filed route
 * leaves the terminal somewhere the chart publishes no transition to; route building asks whether a
 * transition of one of them connects onward to the filed route, and answers with the SID the SOP
 * wanted rather than the vector-SID fallback further down the table. The walk is `selectSid`'s, so
 * the two agree on which rows apply: a row whose SID an active notice took out of use is skipped, a
 * row that clears the flight without a procedure ends it, a row whose notice issues a heading in
 * its DP's place ends it too, and the first row whose SID the flight can fly to its exit element is
 * where `selectSid` stops and so is where this stops too.
 *
 * @param ctx The classified flight.
 * @param exitElement The fix, or the airway, the flight leaves the terminal on.
 * @param direction The gate direction of the flight, undefined when its exit fix is not a gate.
 * @param scenario The filed flight plan.
 * @param airport The airport data.
 * @returns The candidates in table order, empty when the first applicable row already fits.
 */
export function unservedSids(
  ctx: Classification,
  exitElement: string,
  direction: Direction | undefined,
  scenario: Scenario,
  airport: AirportData,
): UnservedSid[] {
  const candidates: UnservedSid[] = [];
  const flight: Flight = { scenario, airport };
  for (const row of airport.assignmentRules) {
    if (!rowApplies(row, ctx, exitElement, direction, flight)) continue;
    const notice = sidOffNotice(row.sidFamily, ctx, airport);
    if (notice !== undefined) {
      if (notice.effect.heading === undefined) continue;
      return candidates;
    }
    const family = row.sidFamily;
    if (family === null) return candidates;
    const fits = airport.sids.some(
      (entry) => entry.family === family && isCompatible(entry, exitElement, scenario, ctx),
    );
    if (fits) return candidates;
    const sid = airport.sids.find(
      (entry) => entry.family === family && isFlyable(entry, scenario, ctx),
    );
    if (sid !== undefined) candidates.push({ sid, row });
  }
  return candidates;
}
