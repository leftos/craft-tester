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

/** Whether every extra condition of a row holds for this flight. */
function conditionsHold(
  when: AssignmentCondition,
  ctx: Classification,
  exitFix: string,
  scenario: Scenario,
): boolean {
  return [
    when.configs === undefined || when.configs.includes(ctx.config.id),
    when.notConfigs === undefined || !when.notConfigs.includes(ctx.config.id),
    when.noiseWindow === undefined || ctx.activeNoiseWindows.includes(when.noiseWindow),
    when.rnav === undefined || when.rnav === scenario.rnavCapable,
    when.exitFixes === undefined || when.exitFixes.includes(exitFix),
  ].every(Boolean);
}

/** Whether a row's plan, direction, runway family, class, and conditions all match. */
function rowApplies(
  row: AssignmentRule,
  ctx: Classification,
  exitFix: string,
  direction: Direction | undefined,
  scenario: Scenario,
): boolean {
  if (row.plan !== ctx.plan) return false;
  if (row.direction !== 'any' && row.direction !== direction) return false;
  if (!row.runwayFamilies.includes(ctx.runwayFamily)) return false;
  if (!row.classes.includes(ctx.aircraftClass)) return false;
  return row.when === undefined || conditionsHold(row.when, ctx, exitFix, scenario);
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

/** Whether the SID reaches the exit fix: by transition, by its base fix, or by radar vectors. */
function servesExitFix(sid: Sid, exitFix: string): boolean {
  if (sid.kind === 'radar_vectors' || sid.kind === 'vector_hybrid') return true;
  if (sid.transitions.some((transition) => transition.fix === exitFix)) return true;
  return sid.baseFix === exitFix;
}

/** Whether the flight can fly the SID from its runway with its equipment to its exit fix. */
function isCompatible(sid: Sid, exitFix: string, scenario: Scenario): boolean {
  return (
    sid.runways.includes(scenario.departureRunway) &&
    (!sid.rnavRequired || scenario.rnavCapable) &&
    servesExitFix(sid, exitFix)
  );
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
 * @param exitFix The fix the flight leaves the terminal on.
 * @param direction The gate direction of the exit fix, undefined when it is not a gate.
 * @param scenario The filed flight plan.
 * @param airport The airport data.
 * @returns The selected SID with its row and sector, or `Unresolved` naming the gap.
 */
export function selectSid(
  ctx: Classification,
  exitFix: string,
  direction: Direction | undefined,
  scenario: Scenario,
  airport: AirportData,
): SidSelection | Unresolved {
  const incompatible: string[] = [];
  const notices: Notice[] = [];
  for (const row of airport.assignmentRules) {
    if (!rowApplies(row, ctx, exitFix, direction, scenario)) continue;
    const notice = sidOffNotice(row.sidFamily, ctx, airport);
    if (notice !== undefined) {
      notices.push(notice);
      continue;
    }
    if (row.sidFamily === null) return unresolved('R.sid', row.text);
    const sid = airport.sids.find(
      (entry) => entry.family === row.sidFamily && isCompatible(entry, exitFix, scenario),
    );
    if (sid === undefined) {
      incompatible.push(row.id);
      continue;
    }
    return { sid, row, sector: row.sector, notices };
  }
  return unresolved('R.sid', noSidReason(ctx, direction, incompatible));
}
