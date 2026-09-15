import { z } from 'zod';

/** Aircraft performance class as the SFO SOP tables use it: piston, turboprop, jet. */
export const AircraftClassSchema = z.enum(['P', 'T', 'J']);

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
 * One departure runway of a config and the aircraft classes that may use it.
 *
 * `note` carries the SOP caveat that limits the runway to some of those aircraft, e.g. the 28s in
 * the 28/01 config being for oceanic, Far East and cargo departures.
 */
export const RunwayAssignmentSchema = z.strictObject({
  runway: z.string(),
  classes: z.array(AircraftClassSchema),
  /**
   * The aircraft classes that depart this runway by default in this configuration, before the
   * direction-of-turn preference.
   *
   * Each class must also be in `classes`, and at most one row per configuration may default a
   * class. An empty array means the row is no default.
   */
  defaultForClasses: z.array(AircraftClassSchema),
  note: z.string().optional(),
});

/** An ATIS runway configuration, e.g. `28/01` on the SFOW plan, with the SOP's name for it. */
export const RunwayConfigSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  plan: z.string(),
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
});

/**
 * One row of the SOP DP assignment table; the engine takes the first compatible match.
 *
 * `direction` is `any` on rows that apply whichever way the flight is going, such as the noise
 * abatement row that sends non-RNAV props off runway heading. A row either assigns a SID family or
 * clears the flight without a DP on `nonDpHeading`, never both and never neither, which is what the
 * refinement enforces; `sidFamily` is `null` on the `nonDpHeading` rows.
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
    sidFamily: z.string().nullable(),
    nonDpHeading: z.string().optional(),
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

/** One row of the SOP interim altitude table; the engine takes the first match. */
export const AltitudeRuleSchema = z.strictObject({
  id: z.string(),
  source: z.string(),
  text: z.string(),
  plan: z.string(),
  runwayFamilies: z.array(z.string()),
  classes: z.array(AircraftClassSchema),
  sidFamilies: z.array(z.string()).optional(),
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

/** A transcribed TEC route for an NCT destination, keyed by plan, runway family, and class. */
export const TecRouteSchema = z.strictObject({
  id: z.string(),
  source: z.string(),
  kind: z.enum(['tec', 'adr']),
  destination: z.string(),
  plan: z.string(),
  runwayFamilies: z.array(z.string()),
  classes: z.array(AircraftClassSchema),
  route: z.string(),
  altitudeCapFeet: feet.optional(),
});

/**
 * What an LOA row demands of a flight.
 *
 * `parity_rotated` carries the boundary courses of a rotated odd/even split: courses from
 * `oddCourseFrom` through `oddCourseTo` take odd altitudes and the rest take even ones.
 */
export const LoaRuleKindSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('parity_rotated'),
    oddCourseFrom: courseDegrees,
    oddCourseTo: courseDegrees,
  }),
  z.strictObject({ kind: z.literal('even') }),
  z.strictObject({ kind: z.literal('odd') }),
  z.strictObject({ kind: z.literal('max'), feet }),
  z.strictObject({ kind: z.literal('route'), tokens: z.array(z.string()) }),
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
 * A destination airport with the coordinates and ARTCC the altitude checks need.
 *
 * `nct` marks a destination inside NorCal TRACON, which is where the TEC route rows apply.
 */
export const DestinationSchema = z.strictObject({
  icao: z.string(),
  spoken: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  artcc: z.string(),
  nct: z.boolean().optional(),
});

/**
 * One curated fleet type, its class, and the service ceiling the altitude checks compare against.
 *
 * `wtc` is the ICAO wake turbulence category (`L`, `M`, `H`, `J`), `suffixes` are the equipment
 * suffixes the type normally files, and `airlines` are the callsign prefixes that operate it, empty
 * when the type flies as a registration.
 */
export const FleetEntrySchema = z.strictObject({
  type: z.string(),
  class: AircraftClassSchema,
  wtc: z.string(),
  ceilingFeet: feet,
  suffixes: z.array(z.string().regex(/^\/[A-Z]$/)),
  airlines: z.array(z.string()),
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
  fleet: z.array(FleetEntrySchema),
  routes: z.array(RouteLibraryEntrySchema),
});

/**
 * An operational notice that changes SID availability, such as a ZOA advisory taking a DP out of use.
 *
 * `sid_off` removes every assignment row for that SID family while the notice is active;
 * `defaultActive` is whether a scenario starts with it in force, and `plan` narrows it to one
 * operating plan when the notice only applies to one.
 */
export const NoticeSchema = z.strictObject({
  id: z.string(),
  source: z.string(),
  dated: z.string(),
  text: z.string(),
  plan: z.string().optional(),
  effect: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('sid_off'), sidFamily: z.string() }),
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
 * identifier to how it is spoken, e.g. `OSI` to `Woodside`.
 */
export const AirportDataSchema = z.strictObject({
  airport: AirportIdentitySchema,
  provenance: ProvenanceSchema,
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
  tecRoutes: z.array(TecRouteSchema),
  loaRules: z.array(LoaRuleSchema),
  notices: z.array(NoticeSchema),
  aircraftClasses: z.record(z.string(), AircraftClassSchema),
  routeLibrary: RouteLibrarySchema,
});

/** A filed flight plan plus the conditions it is cleared under. */
export const ScenarioSchema = z.strictObject({
  callsign: z.string(),
  aircraftType: z.string(),
  rnavCapable: z.boolean(),
  destination: z.string(),
  filedRoute: z.string(),
  filedAltitude: feet,
  runwayConfigId: z.string(),
  departureRunway: z.string(),
  localTime,
  dayOfWeek: DayOfWeekSchema,
  squawk: z.string().regex(/^[0-7]{4}$/),
  activeNotices: z.array(z.string()).optional(),
});

/** The clearance a fixture expects, element by element, as clearance mode grades it. */
export const ExpectedClearanceSchema = z.strictObject({
  clearedTo: z.string(),
  sidFamily: z.string(),
  route: z.strictObject({
    template: RouteTemplateSchema,
    fix: z.string().optional(),
  }),
  altitude: z.strictObject({
    phrase: AltitudePhraseSchema,
    feet: feet.optional(),
  }),
  expect: z
    .strictObject({
      feet,
      minutes: z.number().int().positive(),
    })
    .nullable(),
  frequency: z.string(),
  spoken: z.string().optional(),
});

/** One box of the strip that amendment mode expects the player to correct. */
export const AmendmentSchema = z.strictObject({
  box: z.enum(['type', 'altitude', 'route']),
  proposed: z.string(),
  reason: z.string(),
});

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
export type AssignmentRule = z.infer<typeof AssignmentRuleSchema>;
export type NoiseWindow = z.infer<typeof NoiseWindowSchema>;
export type AltitudeOutcome = z.infer<typeof AltitudeOutcomeSchema>;
export type AltitudeRule = z.infer<typeof AltitudeRuleSchema>;
export type Phraseology = z.infer<typeof PhraseologySchema>;
export type PhraseologyRule = z.infer<typeof PhraseologyRuleSchema>;
export type EquipmentSuffix = z.infer<typeof EquipmentSuffixSchema>;
export type TecRoute = z.infer<typeof TecRouteSchema>;
export type LoaRuleKind = z.infer<typeof LoaRuleKindSchema>;
export type LoaRule = z.infer<typeof LoaRuleSchema>;
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
export type AirportsIndexEntry = z.infer<typeof AirportsIndexEntrySchema>;
export type AirportsIndex = z.infer<typeof AirportsIndexSchema>;
