import type {
  AircraftClass,
  AirportData,
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
  plan: string;
  runwayFamily: string;
  config: RunwayConfig;
  activeNoiseWindows: string[];
  activeNotices: string[];
};

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
    plan: config.plan,
    runwayFamily: scenario.departureRunway.slice(0, 2),
    config,
    activeNoiseWindows: airport.noiseWindows
      .filter((window) => isNoiseWindowActive(window, scenario.localTime, scenario.dayOfWeek))
      .map((window) => window.id),
    activeNotices: activeNoticeIds(scenario, airport),
  };
}
