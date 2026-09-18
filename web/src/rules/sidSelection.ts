import type {
  AirportData,
  AssignmentCondition,
  AssignmentRule,
  Direction,
  NonDpHeading,
  Notice,
  Scenario,
  Sid,
  TecRoute,
} from '@/data/schema.ts';
import type { Classification } from '@/rules/classify.ts';
import { addresses } from '@/rules/classify.ts';
import type { TecHead } from '@/rules/tecRoutes.ts';
import { inUseRows, isFlyable, sidOffNotice, tecHead, usableTecRoute } from '@/rules/tecRoutes.ts';
import type { SelectedProcedure, Unresolved } from '@/rules/types.ts';
import { isUnresolved, unresolved } from '@/rules/unresolved.ts';

/** Half a circle: a heading this far from the runway bearing turns neither way by less. */
const OPPOSITE_DEGREES = 180;

/**
 * What an assignment row put the flight on: a SID, or a heading, with its rows.
 *
 * `tec` is the TEC row whose departure the flight is issued in place of the one the table assigns;
 * `row` is then the row that gives that departure's sector, one that puts its family in use where
 * those rows decide it, else the row the table walk reached.
 */
export type SidSelection = {
  procedure: SelectedProcedure;
  row: AssignmentRule;
  sector: string;
  notices: Notice[];
  tec?: TecRoute;
};

/** The filed plan with the airport data it is read against, passed to the row tests as one. */
type Flight = {
  scenario: Scenario;
  airport: AirportData;
};

/** The flight as the assignment table is read for it: classified, leaving on an element, filed. */
type TableQuery = {
  ctx: Classification;
  exitElement: string;
  direction: Direction | undefined;
  flight: Flight;
};

/** A TEC row's head that names a departure: a family or an initial heading. */
type DepartureHead = Exclude<TecHead, { kind: 'none' }>;

/**
 * Whether the flight's TEC route is one that carries no departure procedure.
 *
 * The row that keys the flight is the route it would be issued, and a row that begins on anything
 * but a departure family — an initial heading, a fix, an airway — is one no procedure fits, which
 * SOP 2-1 c makes the case for clearing the flight on a heading. A flight with no TEC route at all
 * is not such a case.
 */
function tecRouteWithoutDp(ctx: Classification, flight: Flight): boolean {
  const row = usableTecRoute(ctx, flight.scenario, flight.airport);
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
  return headingTurn(heading, row.id, scenario, airport);
}

/**
 * A heading with the turn onto it from the departure runway, as `headingProcedure` derives it.
 *
 * @param heading The heading the flight is cleared on.
 * @param issuer The id of the row that issues the heading, named where no turn can be derived.
 * @param scenario The filed flight plan, which names the departure runway.
 * @param airport The airport data, whose `runways` carry the magnetic bearings.
 * @returns The heading and its turn, or `Unresolved` where the turn cannot be derived.
 */
function headingTurn(
  heading: NonDpHeading,
  issuer: string,
  scenario: Scenario,
  airport: AirportData,
): SelectedProcedure | Unresolved {
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
      `${issuer} clears the flight on heading ${heading}, opposite runway ${runway.designator} on ${runway.magneticBearing}, which leaves no shorter turn`,
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
  const tec = usableTecRoute(ctx, flight.scenario, flight.airport);
  if (tec === undefined) return undefined;
  const head = tecHead(tec);
  if (head.kind !== 'heading' || head.heading === row.nonDpHeading) return undefined;
  return unresolved(
    'R.sid',
    `${row.id} clears the flight on heading ${row.nonDpHeading} but its TEC route ${tec.id} begins on heading ${head.heading}`,
  );
}

/**
 * A row cleared on a notice's heading in place of its SID, with the row's sector and conditions.
 *
 * @param row The assignment row whose SID family the notice took out of use.
 * @param heading The heading the notice issues in the DP's place.
 * @param notices The notices the selection cites, the one that issued the heading included.
 * @param flight The filed plan and the airport data.
 * @returns The selection, or `Unresolved` where the turn onto the heading cannot be derived.
 */
function noticeHeading(
  row: AssignmentRule,
  heading: NonDpHeading,
  notices: Notice[],
  flight: Flight,
): SidSelection | Unresolved {
  const asHeading: AssignmentRule = { ...row, sidFamily: null, nonDpHeading: heading };
  const procedure = headingProcedure(asHeading, flight.scenario, flight.airport);
  if (isUnresolved(procedure)) return procedure;
  return { procedure, row: asHeading, sector: row.sector, notices };
}

/**
 * What one applicable noise-abatement row clears the flight on, where the flight can fly it.
 *
 * @param row The noise-window row.
 * @param notice The active notice that took the row's SID family out of use and issued a heading in
 *   its place, where one did.
 * @param notices The notices that took earlier noise rows out of use.
 * @param query The flight as the table is read for it.
 * @returns The selection, `undefined` where the flight cannot fly the row's SID, or `Unresolved`
 *   where the turn onto the row's heading cannot be derived.
 */
function noiseRowSelection(
  row: AssignmentRule,
  notice: Notice | undefined,
  notices: readonly Notice[],
  query: TableQuery,
): SidSelection | Unresolved | undefined {
  const { ctx, flight } = query;
  const heading = notice?.effect.heading;
  if (notice !== undefined && heading !== undefined) {
    return noticeHeading(row, heading, [...notices, notice], flight);
  }
  if (row.sidFamily === null) {
    const procedure = headingProcedure(row, flight.scenario, flight.airport);
    if (isUnresolved(procedure)) return procedure;
    return { procedure, row, sector: row.sector, notices: [...notices] };
  }
  const sid = flight.airport.sids.find(
    (entry) => entry.family === row.sidFamily && isFlyable(entry, flight.scenario, ctx),
  );
  if (sid === undefined) return undefined;
  return { procedure: { kind: 'sid', sid }, row, sector: row.sector, notices: [...notices] };
}

/**
 * The noise-abatement row that clears a TEC-routed flight, where one applies.
 *
 * The first applicable noise-window row, in table order, whose procedure the flight can fly wins over
 * the TEC route's departure: a heading always, a SID wherever it is published off the flight's
 * runway for its equipment, whether or not it reaches the element the flight leaves on. A row whose
 * family a notice takes out of use is passed over, or cleared on the notice's heading where the notice
 * issues one, as the table walk reads it.
 *
 * @param query The flight as the table is read for it.
 * @returns The selection, `undefined` where no noise row clears the flight, or `Unresolved` where
 *   the turn onto a heading cannot be derived.
 */
function noiseSelection(query: TableQuery): SidSelection | Unresolved | undefined {
  const { ctx, exitElement, direction, flight } = query;
  const passed: Notice[] = [];
  for (const row of flight.airport.assignmentRules) {
    if (row.when?.noiseWindow === undefined) continue;
    if (!rowApplies(row, ctx, exitElement, direction, flight)) continue;
    const notice = sidOffNotice(row.sidFamily, ctx, flight.airport);
    if (notice !== undefined && notice.effect.heading === undefined) {
      passed.push(notice);
      continue;
    }
    const selection = noiseRowSelection(row, notice, passed, query);
    if (selection !== undefined) return selection;
  }
  return undefined;
}

/**
 * The heading a notice issues in place of the TEC route's own departure family.
 *
 * The row and sector are the first applicable row that assigns that family, cleared on the notice's
 * heading as the table walk clears it, whether or not its SID reaches the flight's exit element.
 * Where no row for the family applies the row the walk reached supplies the sector instead.
 *
 * @param query The flight as the table is read for it.
 * @param family The TEC route's departure family.
 * @param notice The active notice that took the family out of use.
 * @param heading The heading the notice issues in the DP's place.
 * @param walked What the table walk answered.
 * @returns The selection, or `Unresolved` where neither a row for the family nor the walk gives a
 *   sector, or the turn onto the heading cannot be derived.
 */
function familyNoticeSelection(
  query: TableQuery,
  family: string,
  notice: Notice,
  heading: NonDpHeading,
  walked: SidSelection | Unresolved,
): SidSelection | Unresolved {
  const { ctx, exitElement, direction, flight } = query;
  const row = flight.airport.assignmentRules.find(
    (entry) => entry.sidFamily === family && rowApplies(entry, ctx, exitElement, direction, flight),
  );
  if (row !== undefined) return noticeHeading(row, heading, [notice], flight);
  if (isUnresolved(walked)) return walked;
  const procedure = headingTurn(heading, notice.id, flight.scenario, flight.airport);
  if (isUnresolved(procedure)) return procedure;
  return { ...walked, procedure, notices: [...walked.notices, notice] };
}

/**
 * The TEC route's own departure: the current SID of its family, or the heading it begins on.
 *
 * @param tec The TEC row that routes the flight.
 * @param head What the row begins on.
 * @param flight The filed plan and the airport data.
 * @returns The procedure, or `Unresolved` where the airport no longer publishes the family or the
 *   turn onto the heading cannot be derived.
 */
function tecProcedure(
  tec: TecRoute,
  head: DepartureHead,
  flight: Flight,
): SelectedProcedure | Unresolved {
  const { scenario, airport } = flight;
  if (head.kind === 'heading') return headingTurn(head.heading, tec.id, scenario, airport);
  const sid = airport.sids.find((entry) => entry.family === head.family);
  if (sid === undefined) {
    return unresolved(
      'R.sid',
      `${tec.id} begins on the ${head.family} departure, which ${airport.airport.icao} no longer publishes`,
    );
  }
  return { kind: 'sid', sid };
}

/** The first of the rows where they all name one sector, `undefined` where they name none or more. */
function soleSectorRow(rows: readonly AssignmentRule[]): AssignmentRule | undefined {
  const [first] = rows;
  if (first === undefined) return undefined;
  return rows.every((row) => row.sector === first.sector) ? first : undefined;
}

/**
 * The row whose sector a TEC route's departure family is handed off on, read off the DP.
 *
 * SOP 2-2 a lists the departure sector per DP. The rows read are those that put the family in use
 * from the flight's runway family in this configuration, noise-window rows aside. Where they name one
 * sector, the first of them gives it: TRUKN, SNTNA and SFO# off KSFO are Richmond whatever the route
 * leaves on. Where they name more, the rows whose direction matches the TEC route's must name one:
 * KSFO GAPP# off the 28s is Richmond for a route leaving over OAK and Sutro for one leaving over OSI.
 *
 * @param family The departure family the TEC route begins on.
 * @param query The flight as the table is read for it, placed by the TEC route's direction.
 * @returns The row, or `undefined` where the DP's rows leave the sector undecided.
 */
function dpSectorRow(family: string, query: TableQuery): AssignmentRule | undefined {
  const { ctx, direction, flight } = query;
  const rows = inUseRows(family, ctx, flight.airport).filter(
    (row) => row.when?.noiseWindow === undefined,
  );
  return (
    soleSectorRow(rows) ??
    soleSectorRow(rows.filter((row) => row.direction === 'any' || row.direction === direction))
  );
}

/**
 * What a flight whose TEC route begins on a departure is cleared on, once no noise row has won.
 *
 * A notice that takes the route's own family out of use and issues a heading gives that heading.
 * Otherwise the route's departure stands, and the TEC row travels with the selection so the
 * clearance cites it beside the row that gives the sector. A family's sector is read off the DP
 * (`dpSectorRow`); a heading, or a family whose rows leave the sector undecided, takes the sector of
 * the row the table walk reached, and a walk that reached no row leaves no sector, so its gap stands.
 */
function tecOverride(
  query: TableQuery,
  tec: TecRoute,
  head: DepartureHead,
  walked: SidSelection | Unresolved,
): SidSelection | Unresolved {
  if (head.kind === 'family') {
    const notice = sidOffNotice(head.family, query.ctx, query.flight.airport);
    const heading = notice?.effect.heading;
    if (notice !== undefined && heading !== undefined) {
      return familyNoticeSelection(query, head.family, notice, heading, walked);
    }
  }
  const procedure = tecProcedure(tec, head, query.flight);
  if (isUnresolved(procedure)) return procedure;
  const row = head.kind === 'family' ? dpSectorRow(head.family, query) : undefined;
  if (row !== undefined) return { procedure, row, sector: row.sector, notices: [], tec };
  if (isUnresolved(walked)) return walked;
  return { ...walked, procedure, tec };
}

/**
 * Selects the procedure the flight is cleared on: the assignment table's answer, or the departure
 * its TEC route begins on.
 *
 * The table is walked first. A flight with no TEC route, or whose route begins on a fix or an
 * airway, takes the walk's answer. A flight whose TEC route begins on a departure family or an
 * initial heading is issued that departure in place of the walk's, with two exceptions: a
 * noise-abatement row the flight can fly wins, and a notice that takes the route's own family out of
 * use and issues a heading gives that heading. The departure's sector is read off the DP where its
 * rows decide it, else off the row the walk reached.
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
  const query: TableQuery = { ctx, exitElement, direction, flight: { scenario, airport } };
  const walked = walkTable(query);
  const tec = usableTecRoute(ctx, scenario, airport);
  if (tec === undefined) return walked;
  const head = tecHead(tec);
  if (head.kind === 'none') return walked;
  return noiseSelection(query) ?? tecOverride(query, tec, head, walked);
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
 * @param query The flight as the table is read for it.
 * @returns The selected SID or heading with its row and sector, or `Unresolved` naming the gap.
 */
function walkTable(query: TableQuery): SidSelection | Unresolved {
  const { ctx, exitElement, direction, flight } = query;
  const { scenario, airport } = flight;
  const incompatible: string[] = [];
  const notices: Notice[] = [];
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
