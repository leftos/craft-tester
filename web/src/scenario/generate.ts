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
import { resolveAmendments } from '@/rules/amend/engine.ts';
import type { ResolvedAmendment } from '@/rules/amend/types.ts';
import { resolveClearance } from '@/rules/engine.ts';
import { directionOf } from '@/rules/route.ts';
import type { ClearanceElement, Unresolved } from '@/rules/types.ts';
import { isUnresolved, unresolved } from '@/rules/unresolved.ts';
import type { ConfigFilter, ScenarioFilter, TimeFilter } from '@/scenario/filter.ts';
import { matchesConfig } from '@/scenario/filter.ts';
import type { Rng, Weighted } from '@/scenario/rng.ts';

/** A half-open span of local minutes past midnight. */
type MinuteRange = { from: number; to: number };

/**
 * The time-of-day mix: 70% daytime, 20% the shoulders of the noise window, 10% late night.
 *
 * A training choice kept in code rather than in the airport data, because it does not vary by
 * airport: it keeps most scenarios in the ordinary day while still drilling the noise abatement
 * rows, which only fire between 2200L and 0700L (0800L on Sunday).
 */
const DAY_RANGES: readonly MinuteRange[] = [{ from: 8 * 60, to: 22 * 60 }];

/**
 * The buckets outside the day, which the night filter draws among by the same weights.
 *
 * The two together span 2200L to 0800L, so every scenario is in one bucket or the other.
 */
const NIGHT_BUCKETS: readonly Weighted<readonly MinuteRange[]>[] = [
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

const TIME_BUCKETS: readonly Weighted<readonly MinuteRange[]>[] = [
  { item: DAY_RANGES, weight: 70 },
  ...NIGHT_BUCKETS,
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
 * The clearance element a draw rejected over a strip box is reported under.
 *
 * The rejection is a note to whoever reads the generator's reasons, not a clearance the player is
 * shown, so it reuses the elements the engine already reports: the route box and the type box both
 * decide what the route reads, and the altitude box decides the altitude the clearance speaks.
 */
const BOX_ELEMENTS: Record<ResolvedAmendment['box'], ClearanceElement> = {
  type: 'R.route',
  altitude: 'A.phrase',
  route: 'R.route',
};

/** Names a configuration filter the way the error that nothing matches it reads. */
function describeConfigFilter(filter: ConfigFilter): string {
  if (filter.kind === 'plan') return `plan ${filter.plan}`;
  return filter.kind === 'id' ? `id ${filter.id}` : 'any configuration';
}

/**
 * Draws a runway configuration the filter admits, by the training mix.
 *
 * @param rng The seeded generator; the weighted draw advances it.
 * @param airport The airport data, for its configurations.
 * @param filter Which configurations the draw may pick from.
 * @returns The drawn configuration.
 * @throws Error When the airport has no configuration the filter admits, naming the ones it has.
 */
function pickConfig(rng: Rng, airport: AirportData, filter: ConfigFilter): RunwayConfig {
  const candidates = airport.runwayConfigs.filter((config) => matchesConfig(filter, config));
  if (candidates.length === 0) {
    const known = airport.runwayConfigs.map((config) => `${config.id} (${config.plan})`).join(', ');
    throw new Error(
      `no runway configuration matches the filter ${describeConfigFilter(filter)}; ` +
        `${airport.airport.icao} has ${known}`,
    );
  }
  return rng.weighted(
    candidates.map((config) => ({ item: config, weight: config.trainingWeight })),
  );
}

/**
 * Draws a route library row, narrowed to the forced destination where the filter names one.
 *
 * @param rng The seeded generator; the draw advances it.
 * @param airport The airport data, for its route library.
 * @param destination The ICAO code the draw is forced onto, or undefined for the whole library.
 * @returns The drawn row.
 * @throws Error When no row files the forced destination, naming the ones the library files.
 */
function pickRoute(
  rng: Rng,
  airport: AirportData,
  destination: string | undefined,
): RouteLibraryEntry {
  const routes = airport.routeLibrary.routes;
  if (destination === undefined) return rng.pick(routes);
  const candidates = routes.filter((route) => route.destination === destination);
  if (candidates.length === 0) {
    const known = [...new Set(routes.map((route) => route.destination))].sort().join(', ');
    throw new Error(
      `no route library row files ${destination}; ${airport.airport.icao} files ${known}`,
    );
  }
  return rng.pick(candidates);
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

/**
 * The spans the time of day is drawn from: the whole mix, the day alone, or the night buckets.
 *
 * The day filter takes its span outright rather than through a one-candidate weighted draw, so it
 * leaves the generator where it found it.
 */
function timeRanges(rng: Rng, filter: TimeFilter): readonly MinuteRange[] {
  if (filter === 'day') return DAY_RANGES;
  return rng.weighted(filter === 'night' ? NIGHT_BUCKETS : TIME_BUCKETS);
}

/** Draws the local time and day of the week the scenario is set at, within the filtered spans. */
function pickTime(rng: Rng, filter: TimeFilter): { localTime: string; dayOfWeek: DayOfWeek } {
  const minute = pickMinute(rng, timeRanges(rng, filter));
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

/**
 * What the amendment engine has to say about a composed plan, which is what makes it unclean.
 *
 * @param clean The plan as it would be presented, with the assigned procedure at the head.
 * @param airport The airport data.
 * @returns The gap to reject the draw over — a box the amendment engine could not answer, or the
 *   first amendment it raised — or `undefined` when it has nothing to amend.
 */
function amendmentGap(clean: Scenario, airport: AirportData): Unresolved | undefined {
  const result = resolveAmendments(clean, airport);
  if (!result.ok) {
    return (
      result.unresolved[0] ?? unresolved('R.route', `no amendment result for ${clean.callsign}`)
    );
  }
  const amendment = result.amendments[0];
  if (amendment === undefined) return undefined;
  return unresolved(
    BOX_ELEMENTS[amendment.box],
    `${clean.callsign} to ${clean.destination} is not clean as filed: ${amendment.reason}`,
  );
}

/**
 * The clean plan as the amendment engine writes it, where the composed one only needed its route.
 *
 * A clean plan is by definition the plan the amendment engine would not amend, and prepending the
 * assigned procedure to the library tail cannot always reach one: the route builder answers a
 * southbound night departure with `NIITE4 GOBBS …` and a route that leaves at a connection target
 * with the transition that connects to it, neither of which the prepend can write. Adopting the
 * corrected route gives the draw the plan the flight would really file. Only the route box may be
 * adopted: an amended type or altitude is a fault in the drawn plan itself, which clearance mode
 * throws away rather than corrects.
 *
 * @param clean The composed plan, with the assigned procedure at the head of the filed route.
 * @param airport The airport data.
 * @returns The plan with the built route adopted, or the composed plan where nothing was adopted.
 */
function withBuiltRoute(clean: Scenario, airport: AirportData): Scenario {
  const result = resolveAmendments(clean, airport);
  if (!result.ok || result.amendments.length === 0) return clean;
  if (!result.amendments.every((amendment) => amendment.box === 'route')) return clean;
  return result.corrected;
}

/**
 * Draws one candidate scenario and runs both engines over it.
 *
 * The filed route is assembled after the clearance engine has spoken, because it names the
 * procedure the SOP assigns: a clean flight plan is one the controller can read aloud as filed.
 * That is sound because `parseFiledRoute` strips a leading procedure token whatever it says, so the
 * clearance the engine resolved here is the clearance of the returned scenario as well.
 *
 * A scenario is then one the clearance engine can clear *and* the amendment engine has nothing to
 * amend: the amendment engine is the single definition of a plan that is correct as filed, so a
 * route library row is drawn only in the configurations, classes and suffixes where its tail and
 * altitude are the correctly-filed plan, and a draw where they are not is thrown away. Where the
 * route box alone is what the engine would write differently, the plan takes the route the engine
 * writes rather than being thrown away, because that route is what the flight would have filed.
 *
 * A filter that names a destination narrows the route draw to the route library rows filed to it.
 *
 * @param rng The seeded generator; every draw advances it.
 * @param airport The airport data the scenario is drawn from.
 * @param filter The time of day, the runway configurations and the destination the draw is narrowed
 *   to.
 * @returns The scenario, or the reason the engine could not clear it or would amend it, which is
 *   the caller's cue to draw again.
 */
export function drawScenario(
  rng: Rng,
  airport: AirportData,
  filter: ScenarioFilter,
): Scenario | Unresolved {
  const config = pickConfig(rng, airport, filter.config);
  const route = pickRoute(rng, airport, filter.destination);
  const fleet = pickFleet(rng, airport, route);
  const equipmentSuffix = rng.pick(fleet.suffixes);
  const picked = pickRunway(rng, airport, config, fleet, directionOf(route.exitFix, airport.gates));
  const time = pickTime(rng, filter.time);
  const noticesOff = rng.next() < NOTICES_OFF_CHANCE;
  const filed: Scenario = {
    callsign: pickCallsign(rng, fleet),
    aircraftType: fleet.type,
    equipmentSuffix,
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
  const composed: Scenario = {
    ...filed,
    filedRoute: `${result.clearance.sid.value.id} ${route.tail}`,
  };
  const clean = withBuiltRoute(composed, airport);
  return amendmentGap(clean, airport) ?? clean;
}

/**
 * Generates a scenario the engine can clear and would not amend, drawing again while a draw is
 * neither.
 *
 * The airport data deliberately leaves some flights without a procedure, such as the non-RNAV prop
 * off the 01s inside the noise window that the SOP sends off on runway heading; those draws are
 * discarded rather than presented, because clearance mode has no way to issue them. So is a draw
 * the amendment engine would amend: a route library row is written for the flights it is the
 * correct plan for, and the configuration, class and suffix are drawn independently of it.
 *
 * A filter that names a destination draws only the route library rows filed to it.
 *
 * @param rng The seeded generator; the same seed and filter always yield the same scenario.
 * @param airport The airport data the scenario is drawn from.
 * @param filter The time of day, the runway configurations and the destination the draw is narrowed
 *   to.
 * @returns The scenario, whose filed route names the procedure the SOP assigns it.
 * @throws Error When `MAX_ATTEMPTS` draws in a row were all unclearable, naming the last reason, or
 *   when no route library row files the destination the filter names.
 */
export function generateScenario(rng: Rng, airport: AirportData, filter: ScenarioFilter): Scenario {
  let last: Unresolved | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const drawn = drawScenario(rng, airport, filter);
    if (!isUnresolved(drawn)) return drawn;
    last = drawn;
  }
  const reason = last === undefined ? 'no draw was attempted' : `${last.element}: ${last.reason}`;
  throw new Error(`no clearable scenario in ${MAX_ATTEMPTS} draws; last was blocked by ${reason}`);
}
