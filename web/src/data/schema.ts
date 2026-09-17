import { z } from 'zod';

/** Aircraft performance class as the SFO SOP tables use it: piston, turboprop, jet. */
export const AircraftClassSchema = z.enum(['P', 'T', 'J']);

/** Aircraft approach category as the published Vref bands define it, from A (slowest) to D. */
export const ApproachCategorySchema = z.enum(['A', 'B', 'C', 'D']);

/**
 * A named group of aircraft an SOP row addresses at once, by class and/or by type designator.
 *
 * The OAK SOP writes rows against "J & DH8D", a set no single class covers: the group names the
 * classes it takes whole and the individual type designators it adds, e.g.
 * `jets_and_dh8d: { classes: ['J'], types: ['DH8D'] }`. A flight matches a rule row when its class
 * is in the row's `classes` or it is in any group the row lists.
 */
export const AircraftGroupSchema = z.strictObject({
  classes: z.array(AircraftClassSchema),
  types: z.array(z.string()),
});

/** SOP departure direction that a gate fix belongs to. */
export const DirectionSchema = z.enum(['north', 'south', 'oceanic']);

/**
 * Shape of the route element of a clearance, and of the phrase used to speak it.
 *
 * `radar_vectors_airway` is the form a route that joins an airway straight off the SID takes, and
 * its `fix` carries the airway token rather than a fix.
 */
export const RouteTemplateSchema = z.enum([
  'transition',
  'radar_vectors_fix',
  'radar_vectors_airway',
  'as_filed',
]);

/** Shape of the altitude element of a clearance. */
export const AltitudePhraseSchema = z.enum(['climb_via', 'climb_via_except', 'maintain']);

/** Day of the week, needed because noise windows end later on Sunday. */
export const DayOfWeekSchema = z.enum([
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]);

const feet = z.number().int().positive();
const localTime = z.string().regex(/^([01]\d|2[0-3])[0-5]\d$/);
const courseDegrees = z.number().int().min(0).max(359);

/** Airport identity and the position that issues the clearance. */
export const AirportIdentitySchema = z.strictObject({
  icao: z.string(),
  faa: z.string(),
  spoken: z.string(),
  clearanceDelivery: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /**
   * Degrees, east positive, from the CIFP airport row; the direction-of-flight checks subtract it
   * from the true course to get the magnetic course the parity rule is read against.
   */
  magneticVariation: z.number().min(-180).max(180),
});

/**
 * Where every generated fact came from, so a stale build is visible in the diff.
 *
 * `sop.version` is the SOP's own document version, which moves independently of the sha256.
 * `secondarySources` lists the documents a rule row may cite besides the SOP, such as the ZOA
 * training deck; it is absent when every row comes from the SOP itself.
 */
export const ProvenanceSchema = z.strictObject({
  airac: z.strictObject({
    cycle: z.string(),
    effective: z.string(),
    cifpSha256: z.string(),
  }),
  chartsApi: z.url(),
  sop: z.strictObject({
    url: z.url(),
    version: z.string(),
    sha256: z.string(),
    transcribedAt: z.string(),
  }),
  secondarySources: z
    .array(
      z.strictObject({
        id: z.string(),
        title: z.string(),
        dated: z.string(),
        url: z.url(),
      }),
    )
    .optional(),
});

/**
 * One runway end the CIFP publishes for the airport, with the bearing it is flown on.
 *
 * `magneticBearing` is the runway's magnetic bearing in degrees, from the CIFP `PG` record. It is
 * what a numbered-heading clearance derives its turn direction from: the shorter way round from the
 * runway bearing to the assigned heading is the direction the turn is issued in.
 */
export const RunwaySchema = z.strictObject({
  designator: z.string(),
  magneticBearing: z.number().min(0).max(360),
});

/**
 * One departure runway of a config and the aircraft classes that may use it.
 *
 * `note` carries the SOP caveat that limits the runway to some of those aircraft, e.g. the 28s in
 * the 28/01 config being for oceanic, Far East and cargo departures.
 */
export const RunwayAssignmentSchema = z.strictObject({
  runway: z.string(),
  classes: z.array(AircraftClassSchema),
  /**
   * The ICAO airline codes that depart this runway by default in this configuration, before the
   * class default.
   *
   * Each code is the callsign prefix `routeLibrary.telephony` keys the airline by, and the row must
   * also list the flight's class in `classes` for the default to apply: at OAK the props of the
   * airline parked south of 28L depart it while the rest of the props depart 28R. An empty array
   * means the row defaults no airline.
   */
  defaultForAirlines: z.array(z.string()),
  /**
   * The `aircraftGroups` ids that depart this runway by default in this configuration, after the
   * airline default and before the class default.
   *
   * A flight is in a group when the group lists its class or its type designator, and the row must
   * also list the flight's class in `classes` for the default to apply: the OAK SOP keeps the
   * turboprops over 17,000 lbs off the 28s by grouping the Dash 8 with the jets. An empty array
   * means the row defaults no group.
   */
  defaultForGroups: z.array(z.string()),
  /**
   * The aircraft classes that depart this runway by default in this configuration, after the
   * airline and group defaults and before the direction-of-turn preference.
   *
   * Each class must also be in `classes`, and at most one row per configuration may default a
   * class. An empty array means the row is no default.
   */
  defaultForClasses: z.array(AircraftClassSchema),
  /**
   * The kinds of flight this runway is issued to only on request, rather than as a normal choice.
   *
   * A non-empty array means the runway is the exception the SOP holds for those flights: a cargo
   * airline, a heavy wake category, or a flight bound oceanic by the gate direction of its exit fix,
   * e.g. the 28s of the 28/01 configuration. An empty array means the runway is a normal choice.
   */
  onRequestFor: z.array(z.enum(['cargo', 'heavy', 'oceanic'])),
  note: z.string().optional(),
});

/** An ATIS runway configuration, e.g. `28/01` on the SFOW plan, with the SOP's name for it. */
export const RunwayConfigSchema = z.strictObject({
  id: z.string(),
  /**
   * The SOP section the configuration and its departure runways come from, cited when the runway
   * element is graded.
   */
  source: z.string(),
  name: z.string(),
  plan: z.string(),
  /**
   * How often the scenario generator draws this configuration relative to the others.
   *
   * A training mix chosen by the airport's maintainer rather than SOP data: the configurations a
   * trainee meets most often on the live field get the most practice, while the rare ones still
   * come up.
   */
  trainingWeight: z.number().int().positive(),
  arrivalRunways: z.array(z.string()),
  departureRunways: z.array(RunwayAssignmentSchema),
});

/** A departure control sector and the frequency the clearance hands off to. */
export const DepartureSectorSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  frequency: z.string(),
});

/** Exit fixes grouped by the SOP direction they belong to. */
export const GatesSchema = z.strictObject({
  north: z.array(z.string()),
  south: z.array(z.string()),
  oceanic: z.array(z.string()),
});

/** How a SID is flown, which decides whether "climb via SID" is available. */
export const SidKindSchema = z.enum([
  'rnav_pilot_nav',
  'conventional_pilot_nav',
  'vector_hybrid',
  'radar_vectors',
]);

/** Whether a transition is a published enroute transition or a CIFP vector transition. */
export const SidTransitionKindSchema = z.enum(['enroute', 'vector']);

/** One transition of a SID plus whether it is spoken as "(fix) transition". */
export const SidTransitionSchema = z.strictObject({
  fix: z.string(),
  spoken: z.string(),
  kind: SidTransitionKindSchema,
  spokenAsTransition: z.boolean(),
});

/** Published top altitude of a SID; `feet` exists only when the chart publishes a number. */
export const TopAltitudeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('published'), feet }),
  z.strictObject({ kind: z.literal('assigned_by_atc') }),
  z.strictObject({ kind: z.literal('none') }),
]);

/** One crossing restriction sliced out of the CIFP records for a SID leg. */
export const SidRestrictionSchema = z.strictObject({
  fix: z.string(),
  transition: z.string().optional(),
  altitudeDescription: z.string(),
  altitudeOneFeet: z.number().int().optional(),
  altitudeTwoFeet: z.number().int().optional(),
});

/** A departure frequency printed on the SID chart, with its sector note when the chart has one. */
export const ChartFrequencySchema = z.strictObject({
  frequency: z.string(),
  note: z.string().optional(),
});

/** A published SID, merged from the chart text, the CIFP records, and the overrides file. */
export const SidSchema = z.strictObject({
  id: z.string(),
  family: z.string(),
  chartName: z.string(),
  spoken: z.string(),
  kind: SidKindSchema,
  rnavRequired: z.boolean(),
  runways: z.array(z.string()),
  transitions: z.array(SidTransitionSchema),
  topAltitude: TopAltitudeSchema,
  /**
   * The minutes in the chart's "expect filed altitude N minutes after departure" note, and null
   * when the chart publishes no such note.
   */
  chartExpectFiledAltitudeMinutes: z.number().int().positive().nullable(),
  hasCrossingRestrictions: z.boolean(),
  restrictions: z.array(SidRestrictionSchema),
  climbViaEligible: z.boolean(),
  baseFix: z.string().optional(),
  routePhrasing: RouteTemplateSchema,
  chartFrequencies: z.array(ChartFrequencySchema),
  chart: z.strictObject({ pdfUrl: z.url() }),
  crossingRestrictionsByRunwayFamily: z.record(z.string(), z.boolean()).optional(),
  note: z.string().optional(),
});

/**
 * Extra conditions that narrow an assignment rule beyond plan, direction, runway, and class.
 *
 * `noiseWindow` is the id of a `NoiseWindowSchema` row, so a rule applies only inside that window.
 * `exitFixes` limits the rule to flights leaving the SID at one of those fixes, and
 * `forcedTransition` names the transition the clearance must use when the rule matches.
 */
export const AssignmentConditionSchema = z.strictObject({
  configs: z.array(z.string()).optional(),
  notConfigs: z.array(z.string()).optional(),
  noiseWindow: z.string().optional(),
  rnav: z.boolean().optional(),
  exitFixes: z.array(z.string()).optional(),
  forcedTransition: z.string().optional(),
  /**
   * Holds when the TEC row keyed for the flight — by destination, plan, runway family and class —
   * begins on no departure placeholder, i.e. on a heading token or on a fix or an airway, which SOP
   * 2-1 c makes the case for an initial heading. A flight with no TEC row never satisfies it.
   */
  tecRouteWithoutDp: z.boolean().optional(),
});

/**
 * The heading a rule clears a flight on where it assigns no departure procedure.
 *
 * Either the runway heading, which needs no number, or a magnetic heading in degrees from 1 to 360,
 * which the flight is turned onto the shorter way round from its departure runway's bearing.
 */
export const NonDpHeadingSchema = z.union([
  z.literal('runway heading'),
  z.number().int().min(1).max(360),
]);

/**
 * One row of the SOP DP assignment table; the engine takes the first compatible match.
 *
 * `direction` is `any` on rows that apply whichever way the flight is going, such as the noise
 * abatement row that sends non-RNAV props off runway heading. A row either assigns a SID family or
 * clears the flight without a DP on `nonDpHeading`, never both and never neither, which is what the
 * refinement enforces; `sidFamily` is `null` on the `nonDpHeading` rows.
 *
 * `groups` are `aircraftGroups` ids: a flight matches the row when its class is in `classes` or it
 * is in any listed group. `approachCategories` narrows the row to the aircraft approach categories
 * it names, as the OAK SOP's "P and Cat A/B" row does; absent means any category.
 */
export const AssignmentRuleSchema = z
  .strictObject({
    id: z.string(),
    source: z.string(),
    text: z.string(),
    plan: z.string(),
    direction: z.union([DirectionSchema, z.literal('any')]),
    runwayFamilies: z.array(z.string()),
    classes: z.array(AircraftClassSchema),
    groups: z.array(z.string()).optional(),
    approachCategories: z.array(ApproachCategorySchema).optional(),
    sidFamily: z.string().nullable(),
    nonDpHeading: NonDpHeadingSchema.optional(),
    sector: z.string(),
    when: AssignmentConditionSchema.optional(),
  })
  .refine((rule) => (rule.sidFamily !== null) !== (rule.nonDpHeading !== undefined), {
    error:
      'an assignment rule must set exactly one of sidFamily (non-null) or nonDpHeading: a rule either assigns a SID family or clears the flight without a DP',
  });

/** A local-time window during which the noise abatement rows apply. */
export const NoiseWindowSchema = z.strictObject({
  id: z.string(),
  start: localTime,
  end: localTime,
  sundayEnd: localTime.optional(),
});

/** What an altitude rule yields: an interim altitude in feet, or a plain climb via SID. */
export const AltitudeOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('interim'), feet }),
  z.strictObject({ kind: z.literal('climb_via') }),
]);

/**
 * One row of the SOP interim altitude table; the engine takes the first match.
 *
 * `groups` are `aircraftGroups` ids: a flight matches the row when its class is in `classes` or it
 * is in any listed group, which is how a row addresses a type its class does not cover.
 */
export const AltitudeRuleSchema = z.strictObject({
  id: z.string(),
  source: z.string(),
  text: z.string(),
  plan: z.string(),
  runwayFamilies: z.array(z.string()),
  classes: z.array(AircraftClassSchema),
  groups: z.array(z.string()).optional(),
  sidFamilies: z.array(z.string()).optional(),
  /**
   * The headings this row answers for, on a row written for flights cleared without a DP.
   *
   * A row carries `sidFamilies` or `nonDpHeadings`, never both: `sidFamilies` keys the row to the
   * DP families it names, `nonDpHeadings` to the headings a flight cleared on no procedure is on,
   * and a row carrying neither answers whatever procedure the flight flies.
   */
  nonDpHeadings: z.array(NonDpHeadingSchema).optional(),
  outcome: AltitudeOutcomeSchema,
  whenTopAltitudePublished: z.enum(['interim', 'climb_via']),
  expectAfterMinutes: z.number().int().positive(),
});

/** Phraseology toggles that the worksheets settle, kept as data so no engine edit is needed. */
export const PhraseologySchema = z.strictObject({
  /**
   * When the controller speaks "expect (filed altitude) (minutes) minutes after departure".
   *
   * `always` speaks it on every clearance whose filed altitude is above the altitude cleared to.
   * `unless_chart_publishes_it` speaks it on those same clearances, except where the SID's
   * `chartExpectFiledAltitudeMinutes` is not null, because the chart already tells the pilot to
   * expect the filed altitude. `never` speaks it on no clearance.
   */
  expectAltitude: z.enum(['always', 'unless_chart_publishes_it', 'never']),
  nonStandardInterimExpectMinutes: z.number().int().positive(),
  vectorHybridTransitionsSpoken: z.boolean(),
});

/** A quotable phraseology reference (7110.65 paragraphs) used for citations. */
export const PhraseologyRuleSchema = z.strictObject({
  id: z.string(),
  source: z.string(),
  text: z.string(),
});

/** One row of FAA JO 7110.65 Table 5-4-1, used for RNAV and RVSM eligibility checks. */
export const EquipmentSuffixSchema = z.strictObject({
  suffix: z.string().regex(/^\/[A-Z]$/),
  rnav: z.boolean(),
  gnss: z.boolean(),
  rvsm: z.boolean(),
  transponderModeC: z.boolean(),
  text: z.string(),
});

/**
 * One arrow of the ZOA route-building cheat sheet: `SUSEY` always connects onward to `EBAYE`.
 * `always` is the sheet's `ac`, `usually` its `c`; `to` may be an airway. The rows are national,
 * so every airport inherits all of them.
 */
export const RouteConnectionSchema = z.strictObject({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  connects: z.enum(['always', 'usually']),
  source: z.string(),
  text: z.string(),
});

/**
 * One airway whose direction of flight the route structure fixes.
 *
 * A one-way airway carries no opposing traffic, so the direction-of-flight altitude rule has nothing
 * to separate on it and an altitude filed on it stands whichever half of the table it falls in. The
 * rows are national, so every airport inherits all of them.
 */
export const AirwaySchema = z.strictObject({
  id: z.string(),
  oneWay: z.boolean(),
});

/**
 * A transcribed TEC route for an NCT destination, keyed by plan, runway family, and class.
 *
 * `initialAltitudeFeet` is the altitude the TEC route is issued with and `finalAltitudeFeet` the
 * cruise altitude it assigns; a row that carries neither publishes no altitude at all. A row that
 * states an initial states a final too, and never one above it, which is what the check enforces.
 */
export const TecRouteSchema = z
  .strictObject({
    id: z.string(),
    source: z.string(),
    kind: z.enum(['tec', 'adr']),
    destination: z.string(),
    plan: z.string(),
    runwayFamilies: z.array(z.string()),
    classes: z.array(AircraftClassSchema),
    route: z.string(),
    initialAltitudeFeet: feet.optional(),
    finalAltitudeFeet: feet.optional(),
  })
  .check((ctx) => {
    const row = ctx.value;
    const { initialAltitudeFeet: initial, finalAltitudeFeet: final } = row;
    if (initial === undefined) return;
    if (final === undefined) {
      ctx.issues.push({
        code: 'custom',
        input: row,
        message: `TEC route ${row.id} states initialAltitudeFeet without finalAltitudeFeet: a row that publishes an initial altitude publishes the final altitude it climbs to as well`,
      });
      return;
    }
    if (initial > final) {
      ctx.issues.push({
        code: 'custom',
        input: row,
        message: `TEC route ${row.id} has initialAltitudeFeet ${initial} above finalAltitudeFeet ${final}: the initial altitude is the one the route is issued with, so it is never above the final altitude`,
      });
    }
  });

/**
 * What an LOA row demands of a flight.
 *
 * `parity_rotated` carries the boundary courses of a rotated odd/even split: courses from
 * `oddCourseFrom` through `oddCourseTo` take odd altitudes and the rest take even ones.
 *
 * A `route` row with `classes` applies only to flights of those classes, because an attachment cell
 * routes props differently from jets; one with `rnavOnly` applies only to an RNAV-capable flight,
 * because the cell's conventional column reads "via filed route" and so demands no fix.
 */
export const LoaRuleKindSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('parity_rotated'),
    oddCourseFrom: courseDegrees,
    oddCourseTo: courseDegrees,
  }),
  z.strictObject({ kind: z.literal('even') }),
  z.strictObject({ kind: z.literal('odd') }),
  z.strictObject({
    kind: z.literal('route'),
    tokens: z.array(z.string()),
    classes: z.array(AircraftClassSchema).optional(),
    rnavOnly: z.boolean().optional(),
  }),
]);

/** One letter-of-agreement row, cited like an SOP row when it overrides a default. */
export const LoaRuleSchema = z.strictObject({
  id: z.string(),
  source: z.string(),
  text: z.string(),
  artcc: z.string().optional(),
  destinations: z.array(z.string()).optional(),
  rule: LoaRuleKindSchema,
});

/**
 * One arrival a destination publishes, as the CIFP codes it.
 *
 * `family` is the identifier without its revision (`IRNMN` for `IRNMN2`), which is what a route
 * names, since the revision changes with the AIRAC cycle. `rnav` is whether the procedure is coded
 * on the RNAV route types, and `transitions` are the fixes its enroute transitions begin on, in the
 * order the chart lists them; an arrival with no enroute transition has none.
 */
export const ArrivalSchema = z.strictObject({
  id: z.string(),
  family: z.string(),
  rnav: z.boolean(),
  transitions: z.array(z.string()),
});

/**
 * A destination airport with the coordinates and ARTCC the altitude checks need.
 *
 * `nct` marks a destination inside NorCal TRACON, which is where the TEC route rows apply.
 * `arrivals` is every arrival the field publishes, empty for a field the FAA file carries no
 * procedures for - every foreign one - and for one that publishes no arrival at all.
 */
export const DestinationSchema = z.strictObject({
  icao: z.string(),
  spoken: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  artcc: z.string(),
  nct: z.boolean().optional(),
  arrivals: z.array(ArrivalSchema),
});

/**
 * One curated fleet type and its class.
 *
 * `wtc` is the ICAO wake turbulence category (`L`, `M`, `H`, `J`), `suffixes` are the equipment
 * suffixes the type normally files, and `airlines` are the callsign prefixes that operate it, empty
 * when the type flies as a registration.
 */
export const FleetEntrySchema = z.strictObject({
  type: z.string(),
  class: AircraftClassSchema,
  wtc: z.string(),
  suffixes: z.array(z.string().regex(/^\/[A-Z]$/)),
  airlines: z.array(z.string()),
  /**
   * The aircraft approach category from the published Vref, needed only where a rule row names
   * categories; it is absent at an airport whose rows never do.
   */
  approachCategory: ApproachCategorySchema.optional(),
});

/** A curated filed route: the gate fix, the rest of the route string, and where it goes. */
export const RouteLibraryEntrySchema = z.strictObject({
  exitFix: z.string(),
  tail: z.string(),
  destination: z.string(),
  classes: z.array(AircraftClassSchema),
  altitudes: z.array(feet),
});

/** The curated pool the runtime scenario generator draws from. */
export const RouteLibrarySchema = z.strictObject({
  destinations: z.array(DestinationSchema),
  telephony: z.record(z.string(), z.string()),
  /** The ICAO codes of the all-cargo airlines of `telephony`, which fly the cargo flights. */
  cargoAirlines: z.array(z.string()),
  fleet: z.array(FleetEntrySchema),
  routes: z.array(RouteLibraryEntrySchema),
});

/**
 * An operational notice that changes SID availability, such as a ZOA advisory taking a DP out of use.
 *
 * `sid_off` removes every assignment row for that SID family while the notice is active;
 * `defaultActive` is whether a scenario starts with it in force, and `plan` narrows it to one
 * operating plan when the notice only applies to one.
 *
 * A `sid_off` notice that carries a `heading` puts something in the DP's place: the row is not
 * removed but read as clearing the flight on that heading, with the sector and conditions it
 * already carries.
 */
export const NoticeSchema = z.strictObject({
  id: z.string(),
  source: z.string(),
  dated: z.string(),
  text: z.string(),
  plan: z.string().optional(),
  effect: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('sid_off'),
      sidFamily: z.string(),
      heading: NonDpHeadingSchema.optional(),
    }),
  ]),
  defaultActive: z.boolean(),
});

/**
 * The whole generated airport file, `data/<icao>.json`.
 *
 * `frequencies` is the labelled distractor pool the frequency dropdown draws from.
 * `departureStaffingFallbacks` are the sectors a departure goes to when Area D is combined or
 * offline, and have the same shape as the staffed sectors. `directionRunwayPreference` maps a plan,
 * then a departure direction, then a runway family to the runway a flight in that direction departs
 * from, e.g. SFOW north off the 01s departing 01R. `noSid` is the runway families that can be
 * cleared without a DP and the route phrasing that clearance uses. `fixSpoken` maps a fix or navaid
 * identifier to how it is spoken, e.g. `OSI` to `Woodside`. `runways` is every runway end the CIFP
 * publishes for the airport with its magnetic bearing, and `aircraftGroups` the named aircraft sets
 * the assignment and altitude rows address, empty at an airport whose rows only name classes.
 */
export const AirportDataSchema = z.strictObject({
  airport: AirportIdentitySchema,
  provenance: ProvenanceSchema,
  runways: z.array(RunwaySchema),
  runwayConfigs: z.array(RunwayConfigSchema),
  departureSectors: z.array(DepartureSectorSchema),
  departureStaffingFallbacks: z.array(DepartureSectorSchema),
  frequencies: z.array(z.strictObject({ label: z.string(), value: z.string() })),
  directionRunwayPreference: z.record(
    z.string(),
    z.record(DirectionSchema, z.record(z.string(), z.string())),
  ),
  gates: GatesSchema,
  noSid: z.strictObject({
    runwayFamilies: z.array(z.string()),
    phrasing: RouteTemplateSchema,
  }),
  sids: z.array(SidSchema),
  fixSpoken: z.record(z.string(), z.string()),
  assignmentRules: z.array(AssignmentRuleSchema),
  noiseWindows: z.array(NoiseWindowSchema),
  altitudeRules: z.array(AltitudeRuleSchema),
  phraseology: PhraseologySchema,
  phraseologyRules: z.array(PhraseologyRuleSchema),
  equipmentSuffixes: z.array(EquipmentSuffixSchema),
  routeConnections: z.array(RouteConnectionSchema),
  airways: z.array(AirwaySchema),
  tecRoutes: z.array(TecRouteSchema),
  loaRules: z.array(LoaRuleSchema),
  notices: z.array(NoticeSchema),
  aircraftClasses: z.record(z.string(), AircraftClassSchema),
  aircraftGroups: z.record(z.string(), AircraftGroupSchema),
  routeLibrary: RouteLibrarySchema,
});

/** A filed flight plan plus the conditions it is cleared under. */
export const ScenarioSchema = z.strictObject({
  callsign: z.string(),
  aircraftType: z.string(),
  /**
   * The FAA equipment suffix the pilot filed with the type (`/L`), or `null` when none was filed.
   * RNAV and RVSM capability are read from `equipmentSuffixes`, and a suffix not in that table
   * reads as neither.
   */
  equipmentSuffix: z
    .string()
    .regex(/^\/[A-Z]$/)
    .nullable(),
  destination: z.string(),
  filedRoute: z.string(),
  filedAltitude: feet,
  runwayConfigId: z.string(),
  departureRunway: z.string(),
  localTime,
  dayOfWeek: DayOfWeekSchema,
  squawk: z.string().regex(/^[0-7]{4}$/),
  /**
   * Strip remarks the pilot filed, e.g. `REQ RWY 28` when the flight asks for the on-request
   * runways. Absent on most plans.
   */
  remarks: z.string().optional(),
  activeNotices: z.array(z.string()).optional(),
});

/** The clearance a fixture expects, element by element, as clearance mode grades it. */
export const ExpectedClearanceSchema = z.strictObject({
  clearedTo: z.string(),
  /** The family of the assigned procedure, `null` on a clearance flown without a DP. */
  sidFamily: z.string().nullable(),
  /**
   * The heading a clearance with no DP sends the flight out on, absent wherever a procedure is
   * assigned: the runway heading, or the magnetic heading in degrees the flight is turned onto.
   */
  heading: NonDpHeadingSchema.optional(),
  route: z.strictObject({
    template: RouteTemplateSchema,
    fix: z.string().optional(),
  }),
  altitude: z.strictObject({
    phrase: AltitudePhraseSchema,
    feet: feet.optional(),
  }),
  expect: z
    .union([
      z.strictObject({
        feet,
        minutes: z.number().int().positive(),
        /**
         * Set on the clause the controller speaks after amending the final altitude, which names the
         * amended altitude rather than the filed one; absent on an ordinary expect clause.
         */
        amended: z.boolean().optional(),
      }),
      z.strictObject({
        feet,
        /**
         * Set on the clause spoken when the amended altitude is the one the flight is cleared
         * straight to: the altitude just spoken is the final one, so the clause carries no delay.
         */
        final: z.literal(true),
      }),
    ])
    .nullable(),
  frequency: z.string(),
  spoken: z.string().optional(),
});

/** One box of the strip that amendment mode expects the player to correct. */
export const AmendmentSchema = z.discriminatedUnion('box', [
  z.strictObject({
    box: z.literal('route'),
    /** The whole route box text as the strip should read it once amended. */
    proposed: z.string(),
    /** One sentence for the player, saying why the box is wrong. */
    reason: z.string(),
    /**
     * Set where the box as filed is acceptable and the proposal is only the fuller way to write it:
     * the student is not marked wrong for leaving it alone, nor for writing the proposal in.
     */
    warning: z.boolean().optional(),
    /**
     * The other box this amendment pairs with: the two are two ways to fix the same fault, and
     * either alone is a full answer.
     */
    alternativeTo: z.enum(['type', 'altitude', 'route']).optional(),
  }),
  z.strictObject({
    box: z.literal('altitude'),
    proposedFeet: feet,
    /** One sentence for the player, saying why the box is wrong. */
    reason: z.string(),
    /**
     * The other box this amendment pairs with: the two are two ways to fix the same fault, and
     * either alone is a full answer.
     */
    alternativeTo: z.enum(['type', 'altitude', 'route']).optional(),
  }),
  z.strictObject({
    box: z.literal('type'),
    /** The designator plus the equipment suffix, e.g. `B752/L`. */
    proposed: z.string(),
    /** One sentence for the player, saying why the box is wrong. */
    reason: z.string(),
    /**
     * The other box this amendment pairs with: the two are two ways to fix the same fault, and
     * either alone is a full answer.
     */
    alternativeTo: z.enum(['type', 'altitude', 'route']).optional(),
  }),
]);

/** What an amendment-mode fixture expects: every box that needs changing, in any order. */
export const ExpectedAmendmentsSchema = z.strictObject({
  amendments: z.array(AmendmentSchema),
});

/** A fixture expects either a full clearance or a list of amendments, never both. */
export const ExpectedSchema = z.union([ExpectedClearanceSchema, ExpectedAmendmentsSchema]);

/** Where a fixture came from: a trainer worksheet, or generated by hand for a rule row. */
export const FixtureSourceSchema = z.strictObject({
  kind: z.enum(['worksheet', 'synthetic']),
  trainer: z.string().optional(),
  date: z.string().optional(),
  note: z.string().optional(),
});

/**
 * One test case, `fixtures/<icao>/**\/*.json`.
 *
 * `expected` is absent while the fixture is still `pending`, which is how worksheet ingestion
 * records a plan whose answer the user has not confirmed yet.
 */
export const FixtureSchema = z.strictObject({
  id: z.string(),
  source: FixtureSourceSchema,
  status: z.enum(['settled', 'pending']),
  /**
   * Which engine the fixture exercises; a fixture with no `expected` yet still says which mode it
   * belongs to.
   */
  mode: z.enum(['clearance', 'amendment']),
  airport: z.string(),
  scenario: ScenarioSchema,
  expected: ExpectedSchema.optional(),
});

/** One line of `data/airports.json`: the airport and the generated file that holds it. */
export const AirportsIndexEntrySchema = z.strictObject({
  icao: z.string(),
  file: z.string(),
});

/** `data/airports.json`, the list of airports the web app can load. */
export const AirportsIndexSchema = z.array(AirportsIndexEntrySchema);

export type AircraftClass = z.infer<typeof AircraftClassSchema>;
export type ApproachCategory = z.infer<typeof ApproachCategorySchema>;
export type AircraftGroup = z.infer<typeof AircraftGroupSchema>;
export type Runway = z.infer<typeof RunwaySchema>;
export type Direction = z.infer<typeof DirectionSchema>;
export type RouteTemplate = z.infer<typeof RouteTemplateSchema>;
export type AltitudePhrase = z.infer<typeof AltitudePhraseSchema>;
export type DayOfWeek = z.infer<typeof DayOfWeekSchema>;
export type AirportIdentity = z.infer<typeof AirportIdentitySchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type RunwayAssignment = z.infer<typeof RunwayAssignmentSchema>;
export type RunwayConfig = z.infer<typeof RunwayConfigSchema>;
export type DepartureSector = z.infer<typeof DepartureSectorSchema>;
export type Gates = z.infer<typeof GatesSchema>;
export type SidKind = z.infer<typeof SidKindSchema>;
export type SidTransitionKind = z.infer<typeof SidTransitionKindSchema>;
export type SidTransition = z.infer<typeof SidTransitionSchema>;
export type TopAltitude = z.infer<typeof TopAltitudeSchema>;
export type SidRestriction = z.infer<typeof SidRestrictionSchema>;
export type ChartFrequency = z.infer<typeof ChartFrequencySchema>;
export type Sid = z.infer<typeof SidSchema>;
export type AssignmentCondition = z.infer<typeof AssignmentConditionSchema>;
export type NonDpHeading = z.infer<typeof NonDpHeadingSchema>;
export type AssignmentRule = z.infer<typeof AssignmentRuleSchema>;
export type NoiseWindow = z.infer<typeof NoiseWindowSchema>;
export type AltitudeOutcome = z.infer<typeof AltitudeOutcomeSchema>;
export type AltitudeRule = z.infer<typeof AltitudeRuleSchema>;
export type Phraseology = z.infer<typeof PhraseologySchema>;
export type PhraseologyRule = z.infer<typeof PhraseologyRuleSchema>;
export type EquipmentSuffix = z.infer<typeof EquipmentSuffixSchema>;
export type RouteConnection = z.infer<typeof RouteConnectionSchema>;
export type Airway = z.infer<typeof AirwaySchema>;
export type TecRoute = z.infer<typeof TecRouteSchema>;
export type LoaRuleKind = z.infer<typeof LoaRuleKindSchema>;
export type LoaRule = z.infer<typeof LoaRuleSchema>;
export type Arrival = z.infer<typeof ArrivalSchema>;
export type Destination = z.infer<typeof DestinationSchema>;
export type FleetEntry = z.infer<typeof FleetEntrySchema>;
export type RouteLibraryEntry = z.infer<typeof RouteLibraryEntrySchema>;
export type RouteLibrary = z.infer<typeof RouteLibrarySchema>;
export type Notice = z.infer<typeof NoticeSchema>;
export type AirportData = z.infer<typeof AirportDataSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type ExpectedClearance = z.infer<typeof ExpectedClearanceSchema>;
export type Amendment = z.infer<typeof AmendmentSchema>;
export type ExpectedAmendments = z.infer<typeof ExpectedAmendmentsSchema>;
export type Expected = z.infer<typeof ExpectedSchema>;
export type FixtureSource = z.infer<typeof FixtureSourceSchema>;
export type Fixture = z.infer<typeof FixtureSchema>;
export type FixtureMode = Fixture['mode'];
export type AirportsIndexEntry = z.infer<typeof AirportsIndexEntrySchema>;
export type AirportsIndex = z.infer<typeof AirportsIndexSchema>;
