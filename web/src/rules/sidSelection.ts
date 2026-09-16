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
import type { Unresolved } from '@/rules/types.ts';
import { unresolved } from '@/rules/unresolved.ts';

/** The SID an assignment row put the flight on, with the rows that decided it. */
export type SidSelection = {
  sid: Sid;
  row: AssignmentRule;
  sector: string;
  notices: Notice[];
};

/**
 * Whether every extra condition of a row holds for this flight.
 *
 * `exitFixes` is matched against the element the flight leaves on, so a row that lists fixes never
 * applies to a route that joins an airway straight off the SID.
 */
function conditionsHold(
  when: AssignmentCondition,
  ctx: Classification,
  exitElement: string,
): boolean {
  return [
    when.configs === undefined || when.configs.includes(ctx.config.id),
    when.notConfigs === undefined || !when.notConfigs.includes(ctx.config.id),
    when.noiseWindow === undefined || ctx.activeNoiseWindows.includes(when.noiseWindow),
    when.rnav === undefined || when.rnav === ctx.rnavCapable,
    when.exitFixes === undefined || when.exitFixes.includes(exitElement),
  ].every(Boolean);
}

/** Whether a row's plan, direction, runway family, class, and conditions all match. */
function rowApplies(
  row: AssignmentRule,
  ctx: Classification,
  exitElement: string,
  direction: Direction | undefined,
): boolean {
  if (row.plan !== ctx.plan) return false;
  if (row.direction !== 'any' && row.direction !== direction) return false;
  if (!row.runwayFamilies.includes(ctx.runwayFamily)) return false;
  if (!row.classes.includes(ctx.aircraftClass)) return false;
  return row.when === undefined || conditionsHold(row.when, ctx, exitElement);
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
 * Walks the assignment table in order and takes the first row whose SID the flight can fly.
 *
 * A row whose SID family an active notice has taken out of use is skipped, and the notice travels
 * with the selection so the clearance can cite it. A row that clears the flight without a
 * procedure blocks the clearance: v1 does not issue non-DP headings.
 *
 * @param ctx The classified flight.
 * @param exitElement The fix, or the airway, the flight leaves the terminal on.
 * @param direction The gate direction of the route's first fix, undefined when it is not a gate.
 * @param scenario The filed flight plan.
 * @param airport The airport data.
 * @returns The selected SID with its row and sector, or `Unresolved` naming the gap.
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
  for (const row of airport.assignmentRules) {
    if (!rowApplies(row, ctx, exitElement, direction)) continue;
    const notice = sidOffNotice(row.sidFamily, ctx, airport);
    if (notice !== undefined) {
      notices.push(notice);
      continue;
    }
    if (row.sidFamily === null) return unresolved('R.sid', row.text);
    const sid = airport.sids.find(
      (entry) => entry.family === row.sidFamily && isCompatible(entry, exitElement, scenario, ctx),
    );
    if (sid === undefined) {
      incompatible.push(row.id);
      continue;
    }
    return { sid, row, sector: row.sector, notices };
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
 * row that clears the flight without a procedure ends it, and the first row whose SID the flight
 * can fly to its exit element is where `selectSid` stops and so is where this stops too.
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
  for (const row of airport.assignmentRules) {
    if (!rowApplies(row, ctx, exitElement, direction)) continue;
    if (sidOffNotice(row.sidFamily, ctx, airport) !== undefined) continue;
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
