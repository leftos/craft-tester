import type {
  AircraftClass,
  AirportData,
  DayOfWeek,
  Direction,
  FleetEntry,
  RouteLibraryEntry,
  RunwayAssignment,
  RunwayConfig,
  Scenario,
} from '@/data/schema.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { directionOf } from '@/rules/route.ts';
import type { Unresolved } from '@/rules/types.ts';
import { isUnresolved, unresolved } from '@/rules/unresolved.ts';
import type { Rng, Weighted } from '@/scenario/rng.ts';

/**
 * How often each runway configuration is drawn, keyed by configuration id.
 *
 * This is a training mix, not SOP data: the configurations a trainee meets most often on the live
 * field get the most practice, while the rare ones still come up. A configuration the airport data
 * adds later is drawn at `UNKNOWN_CONFIG_WEIGHT` until it gets a weight here.
 */
const CONFIG_WEIGHTS: Readonly<Record<string, number>> = {
  '28/01': 55,
  '28 RT': 15,
  '28 SO': 8,
  '19/10': 10,
  '01/01': 4,
  '10/10': 4,
  '19/19': 4,
};

/** The weight a configuration gets when the training mix above does not name it. */
const UNKNOWN_CONFIG_WEIGHT = 1;

/** A half-open span of local minutes past midnight. */
type MinuteRange = { from: number; to: number };

/**
 * The time-of-day mix: 70% daytime, 20% the shoulders of the noise window, 10% late night.
 *
 * Also a training choice rather than data: it keeps most scenarios in the ordinary day while still
 * drilling the noise abatement rows, which only fire between 2200L and 0700L (0800L on Sunday).
 */
const TIME_BUCKETS: readonly Weighted<readonly MinuteRange[]>[] = [
  { item: [{ from: 8 * 60, to: 22 * 60 }], weight: 70 },
  {
    item: [
      { from: 22 * 60, to: 24 * 60 },
      { from: 0, to: 60 },
      { from: 5 * 60, to: 8 * 60 },
    ],
    weight: 20,
  },
  { item: [{ from: 60, to: 5 * 60 }], weight: 10 },
];

/** How the filed route presents the procedure: the assigned one, none at all, or a wrong one. */
type SidTokenChoice = 'correct' | 'none' | 'wrong';

/** The filed-SID mix the trainer drills: half correct, a third missing, the rest wrong. */
const SID_TOKEN_MIX: readonly Weighted<SidTokenChoice>[] = [
  { item: 'correct', weight: 50 },
  { item: 'none', weight: 30 },
  { item: 'wrong', weight: 20 },
];

const DAYS_OF_WEEK: readonly DayOfWeek[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/** Codes a scenario must never issue: VFR and the three emergency squawks. */
const RESERVED_SQUAWKS = new Set(['1200', '7500', '7600', '7700']);

/** The letters a US registration uses; I and O are left out so they cannot read as 1 and 0. */
const REGISTRATION_LETTERS = [...'ABCDEFGHJKLMNPQRSTUVWXYZ'];

/** How often a scenario presents every operational notice as cancelled. */
const NOTICES_OFF_CHANCE = 0.2;

/**
 * How often a flight that may ask for an on-request runway is drawn as having asked for it.
 *
 * SOP 2-1 e lets oceanic, Far East and cargo flights have the 28s while the 01s are the advertised
 * departure runway, but the request is the pilot's to make, so half the drilling is the flight that
 * takes the advertised runway like everyone else.
 */
const ON_REQUEST_CHANCE = 0.5;

/** How many scenarios may be drawn before the generator gives up on the airport data. */
const MAX_ATTEMPTS = 50;

/**
 * A drawn scenario plus the two facts the strip does not carry.
 *
 * `suffix` is the equipment suffix the type filed, which the strip shows next to the type but the
 * `Scenario` schema does not hold; `correctSidId` is the procedure the SOP assigns, which the
 * filed route may or may not name.
 */
export type GeneratedScenario = {
  scenario: Scenario;
  suffix: string;
  correctSidId: string;
};

/** Draws a runway configuration by the training mix. */
function pickConfig(rng: Rng, airport: AirportData): RunwayConfig {
  return rng.weighted(
    airport.runwayConfigs.map((config) => ({
      item: config,
      weight: CONFIG_WEIGHTS[config.id] ?? UNKNOWN_CONFIG_WEIGHT,
    })),
  );
}

/** Draws a fleet type that may fly the route. */
function pickFleet(rng: Rng, airport: AirportData, route: RouteLibraryEntry): FleetEntry {
  const candidates = airport.routeLibrary.fleet.filter((entry) =>
    route.classes.includes(entry.class),
  );
  if (candidates.length === 0) {
    throw new Error(
      `no fleet type flies the route via ${route.exitFix} for classes ${route.classes.join('/')}`,
    );
  }
  return rng.pick(candidates);
}

/** Draws an airline flight number, or a registration for the types that fly without an airline. */
function pickCallsign(rng: Rng, fleet: FleetEntry): string {
  if (fleet.airlines.length > 0) return `${rng.pick(fleet.airlines)}${1 + rng.int(9999)}`;
  const digits = `${1 + rng.int(9)}${rng.int(10)}${rng.int(10)}`;
  return `N${digits}${rng.pick(REGISTRATION_LETTERS)}${rng.pick(REGISTRATION_LETTERS)}`;
}

/** Draws a beacon code: four octal digits that are neither the VFR code nor an emergency code. */
function pickSquawk(rng: Rng): string {
  let code = rng.int(0o10_000).toString(8).padStart(4, '0');
  while (RESERVED_SQUAWKS.has(code)) {
    code = rng.int(0o10_000).toString(8).padStart(4, '0');
  }
  return code;
}

/** Draws a local minute uniformly across the spans of one time bucket. */
function pickMinute(rng: Rng, ranges: readonly MinuteRange[]): number {
  const span = ranges.reduce((sum, range) => sum + (range.to - range.from), 0);
  let offset = rng.int(span);
  for (const range of ranges) {
    const width = range.to - range.from;
    if (offset < width) return range.from + offset;
    offset -= width;
  }
  return ranges[0]?.from ?? 0;
}

/** Draws the local time and day of the week the scenario is set at. */
function pickTime(rng: Rng): { localTime: string; dayOfWeek: DayOfWeek } {
  const minute = pickMinute(rng, rng.weighted(TIME_BUCKETS));
  const hours = String(Math.floor(minute / 60) % 24).padStart(2, '0');
  const minutes = String(minute % 60).padStart(2, '0');
  return { localTime: `${hours}${minutes}`, dayOfWeek: rng.pick(DAYS_OF_WEEK) };
}

/**
 * The departure runways of a configuration the class may use unasked, grouped by runway family.
 *
 * A row with an `onRequestFor` list is left out: that runway is the exception the SOP issues to a
 * flight that asks for it, which `onRequestRunway` draws, not one of the runways in normal use.
 */
function runwaysByFamily(
  config: RunwayConfig,
  aircraftClass: AircraftClass,
): Map<string, string[]> {
  const families = new Map<string, string[]>();
  for (const assignment of config.departureRunways) {
    if (!assignment.classes.includes(aircraftClass) || assignment.onRequestFor.length > 0) continue;
    const family = assignment.runway.slice(0, 2);
    families.set(family, [...(families.get(family) ?? []), assignment.runway]);
  }
  return families;
}

/** The kinds of flight an `onRequestFor` list names. */
type OnRequestKind = RunwayAssignment['onRequestFor'][number];

/** Which of those kinds this flight is: a cargo airline, a heavy, or bound out the oceanic gate. */
function flightKinds(
  fleet: FleetEntry,
  cargoAirlines: readonly string[],
  direction: Direction | undefined,
): OnRequestKind[] {
  const kinds: OnRequestKind[] = [];
  if (fleet.airlines.some((airline) => cargoAirlines.includes(airline))) kinds.push('cargo');
  if (fleet.wtc === 'H') kinds.push('heavy');
  if (direction === 'oceanic') kinds.push('oceanic');
  return kinds;
}

/**
 * The runway this flight could ask for in the configuration, e.g. the 28s of 28/01 for a freighter.
 *
 * The direction preference splits the requested family the way it splits any other, so the request
 * settles the family and the direction of the first turn settles the runway within it.
 */
function onRequestRunway(
  airport: AirportData,
  config: RunwayConfig,
  fleet: FleetEntry,
  direction: Direction | undefined,
): string | undefined {
  const kinds = flightKinds(fleet, airport.routeLibrary.cargoAirlines, direction);
  if (kinds.length === 0) return undefined;
  const assignment = config.departureRunways.find(
    (row) =>
      row.classes.includes(fleet.class) && row.onRequestFor.some((kind) => kinds.includes(kind)),
  );
  if (assignment === undefined) return undefined;
  const family = assignment.runway.slice(0, 2);
  const preferred =
    direction === undefined
      ? undefined
      : airport.directionRunwayPreference[config.plan]?.[direction]?.[family];
  return preferred ?? assignment.runway;
}

/** The runway a configuration departs a class from by default, e.g. the GA 28R in 28/01. */
function classDefaultRunway(
  config: RunwayConfig,
  aircraftClass: AircraftClass,
): string | undefined {
  return config.departureRunways.find((assignment) =>
    assignment.defaultForClasses.includes(aircraftClass),
  )?.runway;
}

/**
 * Draws the departure runway: a family the class may use, then the runway that direction departs.
 *
 * A configuration that defaults the class to a runway (`defaultForClasses`) settles it before any
 * draw, so those aircraft never take the direction-of-turn split. A flight that may ask for an
 * `onRequestFor` runway is drawn as asking for it `ON_REQUEST_CHANCE` of the time, and takes the
 * runways in normal use the rest. Otherwise `directionRunwayPreference` holds the SOP's split, e.g.
 * SFOW northbound off the 01s departing 1R and southbound 1L; a family the table has no entry for
 * falls back to the first runway of it.
 *
 * @param rng The seeded generator; the on-request draw advances it.
 * @param airport The airport data, for the cargo airlines and the direction preference.
 * @param config The runway configuration in force.
 * @param fleet The fleet row of the type, for its class, wake category and airlines.
 * @param direction The gate direction of the exit fix, or undefined when it has none.
 * @returns The runway, and whether the flight asked for it, which is what the strip remarks say.
 */
function pickRunway(
  rng: Rng,
  airport: AirportData,
  config: RunwayConfig,
  fleet: FleetEntry,
  direction: Direction | undefined,
): { runway: string; requested: boolean } {
  const defaulted = classDefaultRunway(config, fleet.class);
  if (defaulted !== undefined) return { runway: defaulted, requested: false };
  const requested = onRequestRunway(airport, config, fleet, direction);
  if (requested !== undefined && rng.next() < ON_REQUEST_CHANCE) {
    return { runway: requested, requested: true };
  }
  const families = runwaysByFamily(config, fleet.class);
  if (families.size === 0) {
    if (requested !== undefined) return { runway: requested, requested: false };
    throw new Error(`configuration ${config.id} has no departure runway for class ${fleet.class}`);
  }
  const family = rng.pick([...families.keys()]);
  const preferred =
    direction === undefined
      ? undefined
      : airport.directionRunwayPreference[config.plan]?.[direction]?.[family];
  const runway = preferred ?? families.get(family)?.[0];
  if (runway === undefined) {
    throw new Error(`configuration ${config.id} has no runway in family ${family}`);
  }
  return { runway, requested: false };
}

/** The same procedure one version back, e.g. `TRUKN1` for `TRUKN2`; undefined at version one. */
function staleToken(sidId: string): string | undefined {
  const parsed = /^([A-Z]+)(\d)$/.exec(sidId);
  const family = parsed?.[1];
  const version = parsed?.[2];
  if (family === undefined || version === undefined) return undefined;
  const previous = Number(version) - 1;
  return previous < 1 ? undefined : `${family}${previous}`;
}

/**
 * Draws a procedure token the SOP would not assign: a stale version, or another SID of the field.
 *
 * A procedure already at version one has no stale form, so those draw another SID's id instead.
 */
function wrongToken(rng: Rng, airport: AirportData, correctSidId: string): string {
  const stale = staleToken(correctSidId);
  if (stale !== undefined && rng.next() < 0.5) return stale;
  return rng.pick(airport.sids.map((sid) => sid.id).filter((id) => id !== correctSidId));
}

/** Draws the procedure token the route files: the assigned one, none, or a wrong one. */
function pickSidToken(rng: Rng, airport: AirportData, correctSidId: string): string | undefined {
  const choice = rng.weighted(SID_TOKEN_MIX);
  if (choice === 'none') return undefined;
  return choice === 'correct' ? correctSidId : wrongToken(rng, airport, correctSidId);
}

/**
 * Draws one candidate scenario and runs the engine over it.
 *
 * The filed route is assembled after the engine has spoken, because the procedure token depends on
 * the procedure the SOP assigns. That is sound because `parseFiledRoute` strips a leading procedure
 * token whatever it says, so the clearance the engine resolved here is the clearance of the
 * returned scenario as well.
 *
 * @param rng The seeded generator; every draw advances it.
 * @param airport The airport data the scenario is drawn from.
 * @returns The scenario with its suffix and assigned procedure, or the reason the engine could not
 *   clear it, which is the caller's cue to draw again.
 */
export function drawScenario(rng: Rng, airport: AirportData): GeneratedScenario | Unresolved {
  const config = pickConfig(rng, airport);
  const route = rng.pick(airport.routeLibrary.routes);
  const fleet = pickFleet(rng, airport, route);
  const suffix = rng.pick(fleet.suffixes);
  const picked = pickRunway(rng, airport, config, fleet, directionOf(route.exitFix, airport.gates));
  const time = pickTime(rng);
  const noticesOff = rng.next() < NOTICES_OFF_CHANCE;
  const filed: Scenario = {
    callsign: pickCallsign(rng, fleet),
    aircraftType: fleet.type,
    rnavCapable: airport.equipmentSuffixes.find((entry) => entry.suffix === suffix)?.rnav ?? false,
    destination: route.destination,
    filedRoute: route.tail,
    filedAltitude: rng.pick(route.altitudes),
    runwayConfigId: config.id,
    departureRunway: picked.runway,
    localTime: time.localTime,
    dayOfWeek: time.dayOfWeek,
    squawk: pickSquawk(rng),
    ...(picked.requested ? { remarks: `REQ RWY ${picked.runway.slice(0, 2)}` } : {}),
    ...(noticesOff ? { activeNotices: [] } : {}),
  };
  const result = resolveClearance(filed, airport);
  if (!result.ok) {
    return result.unresolved[0] ?? unresolved('R.sid', `no clearance for ${filed.callsign}`);
  }
  const correctSidId = result.clearance.sid.value.id;
  const token = pickSidToken(rng, airport, correctSidId);
  const scenario = token === undefined ? filed : { ...filed, filedRoute: `${token} ${route.tail}` };
  return { scenario, suffix, correctSidId };
}

/**
 * Generates a scenario the engine can clear, drawing again while the data cannot clear the draw.
 *
 * The airport data deliberately leaves some flights without a procedure, such as the non-RNAV prop
 * off the 01s inside the noise window that the SOP sends off on runway heading; those draws are
 * discarded rather than presented, because clearance mode has no way to issue them.
 *
 * @param rng The seeded generator; the same seed always yields the same scenario.
 * @param airport The airport data the scenario is drawn from.
 * @returns The scenario with its equipment suffix and the procedure the SOP assigns it.
 * @throws Error When `MAX_ATTEMPTS` draws in a row were all unclearable, naming the last reason.
 */
export function generateScenario(rng: Rng, airport: AirportData): GeneratedScenario {
  let last: Unresolved | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const drawn = drawScenario(rng, airport);
    if (!isUnresolved(drawn)) return drawn;
    last = drawn;
  }
  const reason = last === undefined ? 'no draw was attempted' : `${last.element}: ${last.reason}`;
  throw new Error(`no clearable scenario in ${MAX_ATTEMPTS} draws; last was blocked by ${reason}`);
}
