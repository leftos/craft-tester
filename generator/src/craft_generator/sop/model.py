"""Typed model of the hand-authored YAML files of an airport.

``generator/airports/<icao>/`` holds ``sop.yaml`` (:class:`SopData`), ``overrides.yaml``
(:class:`Overrides`), ``routes.yaml`` (:class:`RouteLibrary`) and the two optional files ``tec.yaml``
(:class:`TecData`) and ``loa.yaml`` (:class:`LoaData`); :class:`AirportInputs` is all of them loaded
together. ``worksheets.yaml`` (:class:`WorksheetConfig`) is read on its own, by
``craft-gen import-worksheets`` only, because no part of the airport document depends on it.

Every closed set is a :data:`typing.Literal` with a companion tuple of its
members, so :mod:`craft_generator.sop.load` rejects a transcription typo by name instead of carrying
it into the airport JSON, and every repeated field is a tuple so a loaded airport cannot be mutated
by a later pipeline stage.

Field names follow the YAML keys, except ``class``, which is a Python keyword and is spelled
``aircraft_class`` on :class:`FleetEntry`.
"""

from dataclasses import dataclass
from datetime import date
from typing import ClassVar, Literal

from craft_generator.chart_text import TopAltitudeKind

AircraftClass = Literal["P", "T", "J"]
TecRouteKind = Literal["tec", "adr"]
LoaRuleKindName = Literal["parity_rotated", "even", "odd", "max", "route"]
Direction = Literal["north", "south", "oceanic", "any"]
GateDirection = Literal["north", "south", "oceanic"]
WakeCategory = Literal["L", "M", "H", "J"]
RoutePhrasing = Literal["transition", "radar_vectors_fix", "as_filed"]
DepartureSidKind = Literal["rnav_pilot_nav", "conventional_pilot_nav", "vector_hybrid", "radar_vectors"]
AltitudeOutcomeKind = Literal["interim", "climb_via"]
NoticeEffectKind = Literal["sid_off"]
ExpectAltitudePolicy = Literal["always", "unless_chart_publishes_it", "never"]
WorksheetKind = Literal["phraseology", "amendment"]
PhraseologyReading = Literal["abbreviated", "full_route"]
OnRequestKind = Literal["cargo", "heavy", "oceanic"]

AIRCRAFT_CLASSES: tuple[AircraftClass, ...] = ("P", "T", "J")
TEC_ROUTE_KINDS: tuple[TecRouteKind, ...] = ("tec", "adr")
LOA_RULE_KIND_NAMES: tuple[LoaRuleKindName, ...] = ("parity_rotated", "even", "odd", "max", "route")
DIRECTIONS: tuple[Direction, ...] = ("north", "south", "oceanic", "any")
GATE_DIRECTIONS: tuple[GateDirection, ...] = ("north", "south", "oceanic")
WAKE_CATEGORIES: tuple[WakeCategory, ...] = ("L", "M", "H", "J")
ROUTE_PHRASINGS: tuple[RoutePhrasing, ...] = ("transition", "radar_vectors_fix", "as_filed")
DEPARTURE_SID_KINDS: tuple[DepartureSidKind, ...] = ("rnav_pilot_nav", "conventional_pilot_nav", "vector_hybrid", "radar_vectors")
ALTITUDE_OUTCOME_KINDS: tuple[AltitudeOutcomeKind, ...] = ("interim", "climb_via")
NOTICE_EFFECT_KINDS: tuple[NoticeEffectKind, ...] = ("sid_off",)
EXPECT_ALTITUDE_POLICIES: tuple[ExpectAltitudePolicy, ...] = ("always", "unless_chart_publishes_it", "never")
TOP_ALTITUDE_KINDS: tuple[TopAltitudeKind, ...] = ("published", "assigned_by_atc", "none")
WORKSHEET_KINDS: tuple[WorksheetKind, ...] = ("phraseology", "amendment")
PHRASEOLOGY_READINGS: tuple[PhraseologyReading, ...] = ("abbreviated", "full_route")
ON_REQUEST_KINDS: tuple[OnRequestKind, ...] = ("cargo", "heavy", "oceanic")


@dataclass(frozen=True, slots=True)
class SopSource:
    """The SOP document a transcription came from, as ``craft-gen verify-sop`` checks it."""

    title: str
    version: str
    url: str
    sha256: str
    transcribed_at: date
    sentinels: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SecondarySource:
    """A document other than the SOP that rule rows cite, e.g. the ZOA training deck."""

    id: str
    title: str
    dated: date
    url: str


@dataclass(frozen=True, slots=True)
class AirportInfo:
    """Identifiers and the clearance delivery frequency of the airport."""

    icao: str
    faa: str
    spoken: str
    clearance_delivery: str


@dataclass(frozen=True, slots=True)
class DepartureRunway:
    """One runway of a configuration and the aircraft classes that depart from it.

    ``default_for_classes`` names the classes this runway is the default for in the configuration,
    ahead of the direction-of-turn preference; it is empty on a row that is no default.
    ``on_request_for`` names the kinds of flight the runway is issued to only on request, after the
    class default and ahead of the direction preference; it is empty on a row that is a normal
    choice, and a row that is a class default may not carry it.
    """

    runway: str
    classes: tuple[AircraftClass, ...]
    default_for_classes: tuple[AircraftClass, ...]
    on_request_for: tuple[OnRequestKind, ...]
    note: str | None


@dataclass(frozen=True, slots=True)
class RunwayConfig:
    """One runway configuration, e.g. ``28/01``."""

    id: str
    source: str
    name: str
    plan: str
    arrival_runways: tuple[str, ...]
    departure_runways: tuple[DepartureRunway, ...]


@dataclass(frozen=True, slots=True)
class DepartureSector:
    """A departure control sector, or one of the staffing fallbacks that replaces the pair."""

    id: str
    name: str
    frequency: str


@dataclass(frozen=True, slots=True)
class FrequencyOption:
    """One entry of the frequency distractor pool."""

    label: str
    value: str


@dataclass(frozen=True, slots=True)
class Gates:
    """Exit fixes grouped into the SOP's three destination directions."""

    north: tuple[str, ...]
    south: tuple[str, ...]
    oceanic: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class NoSid:
    """Where a departure without a DP may be issued, and how it is phrased."""

    runway_families: tuple[str, ...]
    phrasing: RoutePhrasing


@dataclass(frozen=True, slots=True)
class NoiseWindow:
    """A local-time window in which the noise abatement rules apply."""

    id: str
    start: str
    end: str
    sunday_end: str | None


@dataclass(frozen=True, slots=True)
class AssignmentCondition:
    """The ``when`` block of an assignment rule; every field is optional and unset means unrestricted."""

    configs: tuple[str, ...] | None
    not_configs: tuple[str, ...] | None
    noise_window: str | None
    rnav: bool | None
    exit_fixes: tuple[str, ...] | None
    forced_transition: str | None


@dataclass(frozen=True, slots=True)
class AssignmentRule:
    """One row of SOP 2-2 a or 2-4 e: which DP (or non-DP heading) a departure gets."""

    id: str
    source: str
    text: str
    plan: str
    direction: Direction
    runway_families: tuple[str, ...]
    classes: tuple[AircraftClass, ...]
    sid_family: str | None
    non_dp_heading: str | None
    sector: str
    when: AssignmentCondition | None


@dataclass(frozen=True, slots=True)
class AltitudeOutcome:
    """The altitude an altitude rule produces."""

    kind: AltitudeOutcomeKind
    feet: int | None


@dataclass(frozen=True, slots=True)
class AltitudeRule:
    """One row of SOP 2-2 c: the interim altitude issued when no top altitude is published."""

    id: str
    source: str
    text: str
    plan: str
    runway_families: tuple[str, ...]
    classes: tuple[AircraftClass, ...]
    sid_families: tuple[str, ...] | None
    outcome: AltitudeOutcome
    when_top_altitude_published: AltitudeOutcomeKind
    expect_after_minutes: int


@dataclass(frozen=True, slots=True)
class NoticeEffect:
    """What an operational notice does while it is active."""

    kind: NoticeEffectKind
    sid_family: str


@dataclass(frozen=True, slots=True)
class Notice:
    """An operational notice that changes which DPs are available."""

    id: str
    source: str
    dated: date
    text: str
    plan: str
    effect: NoticeEffect
    default_active: bool


@dataclass(frozen=True, slots=True)
class Phraseology:
    """Airport-level phrasing toggles the engine reads."""

    expect_altitude: ExpectAltitudePolicy
    non_standard_interim_expect_minutes: int
    vector_hybrid_transitions_spoken: bool


@dataclass(frozen=True, slots=True)
class PhraseologyRule:
    """A phrasing rule quoted for citation, e.g. FAA JO 7110.65 4-3-2 c 5."""

    id: str
    source: str
    text: str


@dataclass(frozen=True, slots=True)
class SopData:
    """Everything transcribed from one airport's SOP."""

    source: SopSource
    secondary_sources: tuple[SecondarySource, ...]
    airport: AirportInfo
    runways: tuple[str, ...]
    runway_configs: tuple[RunwayConfig, ...]
    departure_sectors: tuple[DepartureSector, ...]
    departure_staffing_fallbacks: tuple[DepartureSector, ...]
    direction_runway_preference: dict[str, dict[GateDirection, dict[str, str]]]
    frequencies: tuple[FrequencyOption, ...]
    gates: Gates
    no_sid: NoSid
    noise_windows: tuple[NoiseWindow, ...]
    assignment_rules: tuple[AssignmentRule, ...]
    altitude_rules: tuple[AltitudeRule, ...]
    notices: tuple[Notice, ...]
    phraseology: Phraseology
    phraseology_rules: tuple[PhraseologyRule, ...]


@dataclass(frozen=True, slots=True)
class SidTopAltitude:
    """A top altitude an override states, for a DP whose chart the generator cannot read."""

    kind: TopAltitudeKind
    feet: int | None


@dataclass(frozen=True, slots=True)
class SidOverride:
    """Per-DP facts the CIFP and the chart text do not carry, keyed by charts-API chart name.

    Every field but ``chart_name`` and ``cifp_id`` is optional: an absent field means the merge step
    keeps what CIFP and the chart said.
    """

    chart_name: str
    cifp_id: str
    spoken: str | None
    kind: DepartureSidKind | None
    runways: tuple[str, ...] | None
    top_altitude: SidTopAltitude | None
    has_crossing_restrictions: bool | None
    crossing_restrictions_by_runway_family: dict[str, bool] | None
    route_phrasing: RoutePhrasing | None
    transitions_spoken_as_transition: bool | None
    note: str | None


@dataclass(frozen=True, slots=True)
class Overrides:
    """``overrides.yaml``: per-DP corrections and the spoken form of transition fixes."""

    sids: dict[str, SidOverride]
    fix_spoken: dict[str, str]


@dataclass(frozen=True, slots=True)
class Destination:
    """One destination a scenario can file to."""

    icao: str
    spoken: str
    artcc: str
    nct: bool
    lat: float | None
    lon: float | None


@dataclass(frozen=True, slots=True)
class FleetEntry:
    """One aircraft type of the curated fleet; ``aircraft_class`` is the YAML ``class`` key."""

    type: str
    aircraft_class: AircraftClass
    wtc: WakeCategory
    ceiling_feet: int
    suffixes: tuple[str, ...]
    airlines: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RouteEntry:
    """One filed route, keyed by the fix where the aircraft leaves the DP."""

    exit_fix: str
    destination: str
    tail: str
    classes: tuple[AircraftClass, ...]
    altitudes: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class RouteLibrary:
    """``routes.yaml``: the destinations, fleet, telephony and filed routes scenarios are built from.

    ``cargo_airlines`` are the ICAO codes of ``telephony`` that fly all-cargo, which is what makes a
    flight of theirs a cargo flight for the runway rules.
    """

    destinations: tuple[Destination, ...]
    telephony: dict[str, str]
    cargo_airlines: tuple[str, ...]
    fleet: tuple[FleetEntry, ...]
    routes: tuple[RouteEntry, ...]


@dataclass(frozen=True, slots=True)
class TecSource:
    """The route tool a ``tec.yaml`` transcription came from."""

    title: str
    url: str
    transcribed_at: date


@dataclass(frozen=True, slots=True)
class TecRoute:
    """One row of the route tool: the route a departure to one NCT or ADR destination is cleared on.

    ``route`` keeps the ``FAMILY#`` placeholder the transcription uses in place of a versioned DP
    id, so an AIRAC bump cannot stale the row; the engine substitutes the current procedure.
    """

    id: str
    kind: TecRouteKind
    destination: str
    plan: str
    runway_families: tuple[str, ...]
    classes: tuple[AircraftClass, ...]
    route: str
    altitude_cap_feet: int | None


@dataclass(frozen=True, slots=True)
class TecData:
    """``tec.yaml``: the transcribed TEC and ADR rows and the tool they were read from."""

    source: TecSource
    routes: tuple[TecRoute, ...]


@dataclass(frozen=True, slots=True)
class LoaSource:
    """One letter of agreement a ``loa.yaml`` rule row cites."""

    id: str
    title: str
    effective: date
    url: str


@dataclass(frozen=True, slots=True)
class ParityRotatedRule:
    """Altitude parity assigned by a course window rotated off the FAA JO 7110.65 hemispheres."""

    kind: ClassVar[LoaRuleKindName] = "parity_rotated"
    odd_course_from: int
    odd_course_to: int


@dataclass(frozen=True, slots=True)
class EvenAltitudeRule:
    """Every altitude to the destinations the rule covers is even."""

    kind: ClassVar[LoaRuleKindName] = "even"


@dataclass(frozen=True, slots=True)
class OddAltitudeRule:
    """Every altitude to the destinations the rule covers is odd."""

    kind: ClassVar[LoaRuleKindName] = "odd"


@dataclass(frozen=True, slots=True)
class MaxAltitudeRule:
    """The altitudes the rule covers are capped at ``feet``."""

    kind: ClassVar[LoaRuleKindName] = "max"
    feet: int


@dataclass(frozen=True, slots=True)
class RouteTokenRule:
    """The route to the destinations the rule covers is built from one of ``tokens``."""

    kind: ClassVar[LoaRuleKindName] = "route"
    tokens: tuple[str, ...]


LoaRuleKind = ParityRotatedRule | EvenAltitudeRule | OddAltitudeRule | MaxAltitudeRule | RouteTokenRule


@dataclass(frozen=True, slots=True)
class LoaRule:
    """One letter-of-agreement row: which departures it covers and what it does to their clearance.

    ``artcc`` covers every destination whose centre matches, ``destinations`` names airports; a row
    may carry either, both or neither, and neither means the rule covers every departure.
    """

    id: str
    source: str
    text: str
    artcc: str | None
    destinations: tuple[str, ...] | None
    rule: LoaRuleKind


@dataclass(frozen=True, slots=True)
class LoaData:
    """``loa.yaml``: the letters of agreement and the rule rows transcribed from them."""

    sources: tuple[LoaSource, ...]
    rules: tuple[LoaRule, ...]


@dataclass(frozen=True, slots=True)
class EquipmentSuffix:
    """One row of FAA JO 7110.65 table 5-4-1: what an equipment suffix says about an aircraft."""

    suffix: str
    rnav: bool
    gnss: bool
    rvsm: bool
    transponder_mode_c: bool
    text: str


@dataclass(frozen=True, slots=True)
class Worksheet:
    """One trainer worksheet: a public Google Doc of flight plans and the configuration it declares."""

    id: str
    title: str
    kind: WorksheetKind
    config: str | None
    phraseology: PhraseologyReading | None


@dataclass(frozen=True, slots=True)
class WorksheetConfig:
    """``worksheets.yaml``: the trainer worksheets of one airport and the type aliases they file under.

    ``type_aliases`` maps a designator a sheet files to the designator vNAS and the fleet use, e.g.
    ``A32N`` to ``A20N``; a type the sheets spell correctly is not listed.
    """

    worksheets: tuple[Worksheet, ...]
    type_aliases: dict[str, str]


@dataclass(frozen=True, slots=True)
class AirportInputs:
    """The YAML files of one airport, loaded and cross-checked against each other.

    ``tec`` and ``loa`` are ``None`` when the airport directory carries no ``tec.yaml`` or
    ``loa.yaml``; the airport document then emits an empty table for them.
    """

    icao: str
    sop: SopData
    overrides: Overrides
    routes: RouteLibrary
    tec: TecData | None
    loa: LoaData | None
