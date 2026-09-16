import type {
  AircraftClass,
  AircraftGroup,
  AirportData,
  ApproachCategory,
  DayOfWeek,
  NoiseWindow,
  RunwayConfig,
  Scenario,
} from '@/data/schema.ts';
import type { Unresolved } from '@/rules/types.ts';
import { unresolved } from '@/rules/unresolved.ts';

/** What the rest of the pipeline needs to know about the flight and the field. */
export type Classification = {
  aircraftClass: AircraftClass;
  /** The filed type designator, which is how a row addresses a type its class does not cover. */
  aircraftType: string;
  /**
   * The aircraft approach category from the fleet row for the type, `undefined` where the fleet
   * does not list the type or its row publishes no category.
   */
  approachCategory: ApproachCategory | undefined;
  plan: string;
  runwayFamily: string;
  config: RunwayConfig;
  /** Whether the filed equipment suffix is an RNAV one in `equipmentSuffixes`; no suffix is not. */
  rnavCapable: boolean;
  activeNoiseWindows: string[];
  activeNotices: string[];
};

/** The audience fields a rule row is keyed by, carried by both assignment and altitude rows. */
export type RuleAudience = {
  id: string;
  classes: AircraftClass[];
  groups?: string[] | undefined;
  approachCategories?: ApproachCategory[] | undefined;
};

/**
 * The group ids a row names, checked against the airport data.
 *
 * @param row The rule row.
 * @param airport The airport data.
 * @returns The ids, in the order the row names them.
 * @throws Error When the row names a group the airport data does not define.
 */
function groupIdsOf(row: RuleAudience, airport: AirportData): string[] {
  return (row.groups ?? []).map((id) => {
    if (airport.aircraftGroups[id] === undefined) {
      throw new Error(`rule ${row.id} names aircraft group ${id}, which the airport data has not`);
    }
    return id;
  });
}

/**
 * Whether a flight belongs to any of the named aircraft groups.
 *
 * A group takes whole classes and adds individual type designators, so a flight is in it when its
 * class is one of the group's `classes` or its type designator is one of the group's `types`. This
 * is the membership an SOP row keyed on a group asks about, and the one a departure runway's
 * `defaultForGroups` asks about.
 *
 * @param groupIds The `aircraftGroups` ids to test, in any order.
 * @param aircraftClass The class the flight was classified into.
 * @param aircraftType The filed type designator.
 * @param airport The airport data, which defines the groups.
 * @returns True when the flight is in at least one of the groups.
 * @throws Error When an id is not an `aircraftGroups` id of the airport data.
 */
export function inAnyGroup(
  groupIds: readonly string[],
  aircraftClass: AircraftClass,
  aircraftType: string,
  airport: AirportData,
): boolean {
  return groupIds.some((id) => {
    const group: AircraftGroup | undefined = airport.aircraftGroups[id];
    if (group === undefined) {
      throw new Error(`aircraft group ${id} is not in the airport data`);
    }
    return group.classes.includes(aircraftClass) || group.types.includes(aircraftType);
  });
}

/**
 * Whether a rule row is written for this flight.
 *
 * A row reaches a flight whose class it lists, and a flight in any `aircraftGroups` id it lists: a
 * group takes whole classes and adds individual type designators, which is how the OAK SOP writes a
 * row against "J & DH8D". Where the row also names approach categories it reaches only a flight
 * whose category is one of them, so a flight the fleet publishes no category for matches no such
 * row; a row naming no categories reaches every category.
 *
 * @param row The assignment or altitude row, with the audience fields it is keyed by.
 * @param ctx The classified flight.
 * @param airport The airport data, which defines the groups.
 * @returns True when the row addresses the flight.
 * @throws Error When the row names a group the airport data does not define.
 */
export function addresses(row: RuleAudience, ctx: Classification, airport: AirportData): boolean {
  const inGroup = inAnyGroup(
    groupIdsOf(row, airport),
    ctx.aircraftClass,
    ctx.aircraftType,
    airport,
  );
  if (!row.classes.includes(ctx.aircraftClass) && !inGroup) return false;
  if (row.approachCategories === undefined || row.approachCategories.length === 0) return true;
  return (
    ctx.approachCategory !== undefined && row.approachCategories.includes(ctx.approachCategory)
  );
}

/**
 * Whether a noise window is open at a local time.
 *
 * The window runs from `start` inclusive to `end` exclusive and wraps past midnight, so 2200-0700
 * is open at 2300 and at 0300. On Sunday the window ends at `sundayEnd` where the row has one.
 *
 * @param window The noise window row.
 * @param localTime Local time as `HHMM`.
 * @param dayOfWeek The local day, which decides whether `sundayEnd` applies.
 * @returns True while the window is open.
 */
export function isNoiseWindowActive(
  window: NoiseWindow,
  localTime: string,
  dayOfWeek: DayOfWeek,
): boolean {
  const end = dayOfWeek === 'sunday' ? (window.sundayEnd ?? window.end) : window.end;
  const now = Number(localTime);
  const opens = Number(window.start);
  const closes = Number(end);
  return opens <= closes ? now >= opens && now < closes : now >= opens || now < closes;
}

/** The notices in force: the scenario's list where it has one, else the data's defaults. */
function activeNoticeIds(scenario: Scenario, airport: AirportData): string[] {
  return (
    scenario.activeNotices ??
    airport.notices.filter((notice) => notice.defaultActive).map((notice) => notice.id)
  );
}

/**
 * Classifies a scenario into the facts the assignment and altitude tables are keyed by.
 *
 * @param scenario The filed flight plan and the conditions it is cleared under.
 * @param airport The airport data.
 * @returns The classification, or `Unresolved` when the aircraft type or the runway configuration
 *   is not in the data, which blocks the SID element.
 */
export function classify(scenario: Scenario, airport: AirportData): Classification | Unresolved {
  const aircraftClass = airport.aircraftClasses[scenario.aircraftType];
  if (aircraftClass === undefined) {
    return unresolved('R.sid', `aircraft type ${scenario.aircraftType} has no class in the data`);
  }
  const config = airport.runwayConfigs.find((entry) => entry.id === scenario.runwayConfigId);
  if (config === undefined) {
    return unresolved(
      'R.sid',
      `runway configuration ${scenario.runwayConfigId} is not in the data`,
    );
  }
  return {
    aircraftClass,
    aircraftType: scenario.aircraftType,
    approachCategory: airport.routeLibrary.fleet.find(
      (entry) => entry.type === scenario.aircraftType,
    )?.approachCategory,
    plan: config.plan,
    runwayFamily: scenario.departureRunway.slice(0, 2),
    config,
    rnavCapable:
      airport.equipmentSuffixes.find((entry) => entry.suffix === scenario.equipmentSuffix)?.rnav ??
      false,
    activeNoiseWindows: airport.noiseWindows
      .filter((window) => isNoiseWindowActive(window, scenario.localTime, scenario.dayOfWeek))
      .map((window) => window.id),
    activeNotices: activeNoticeIds(scenario, airport),
  };
}
