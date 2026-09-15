"""Typed model of the three hand-authored YAML files of an airport.

``generator/airports/<icao>/`` holds ``sop.yaml`` (:class:`SopData`), ``overrides.yaml``
(:class:`Overrides`) and ``routes.yaml`` (:class:`RouteLibrary`); :class:`AirportInputs` is the three
of them loaded together. Every closed set is a :data:`typing.Literal` with a companion tuple of its
members, so :mod:`craft_generator.sop.load` rejects a transcription typo by name instead of carrying
it into the airport JSON, and every repeated field is a tuple so a loaded airport cannot be mutated
by a later pipeline stage.

Field names follow the YAML keys, except ``class``, which is a Python keyword and is spelled
``aircraft_class`` on :class:`FleetEntry`.
"""

from dataclasses import dataclass
from datetime import date
from typing import Literal

from craft_generator.chart_text import TopAltitudeKind

AircraftClass = Literal["P", "T", "J"]
Direction = Literal["north", "south", "oceanic", "any"]
GateDirection = Literal["north", "south", "oceanic"]
WakeCategory = Literal["L", "M", "H", "J"]
RoutePhrasing = Literal["transition", "radar_vectors_fix", "as_filed"]
DepartureSidKind = Literal["rnav_pilot_nav", "conventional_pilot_nav", "vector_hybrid", "radar_vectors"]
AltitudeOutcomeKind = Literal["interim", "climb_via"]
NoticeEffectKind = Literal["sid_off"]
ExpectAltitudePolicy = Literal["always", "only_when_interim_below_filed", "never"]

AIRCRAFT_CLASSES: tuple[AircraftClass, ...] = ("P", "T", "J")
DIRECTIONS: tuple[Direction, ...] = ("north", "south", "oceanic", "any")
GATE_DIRECTIONS: tuple[GateDirection, ...] = ("north", "south", "oceanic")
WAKE_CATEGORIES: tuple[WakeCategory, ...] = ("L", "M", "H", "J")
ROUTE_PHRASINGS: tuple[RoutePhrasing, ...] = ("transition", "radar_vectors_fix", "as_filed")
DEPARTURE_SID_KINDS: tuple[DepartureSidKind, ...] = ("rnav_pilot_nav", "conventional_pilot_nav", "vector_hybrid", "radar_vectors")
ALTITUDE_OUTCOME_KINDS: tuple[AltitudeOutcomeKind, ...] = ("interim", "climb_via")
NOTICE_EFFECT_KINDS: tuple[NoticeEffectKind, ...] = ("sid_off",)
EXPECT_ALTITUDE_POLICIES: tuple[ExpectAltitudePolicy, ...] = ("always", "only_when_interim_below_filed", "never")
TOP_ALTITUDE_KINDS: tuple[TopAltitudeKind, ...] = ("published", "assigned_by_atc", "none")


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
    """One runway of a configuration and the aircraft classes that depart from it."""

    runway: str
    classes: tuple[AircraftClass, ...]
    note: str | None


@dataclass(frozen=True, slots=True)
class RunwayConfig:
    """One runway configuration, e.g. ``28/01``."""

    id: str
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
    """``routes.yaml``: the destinations, fleet, telephony and filed routes scenarios are built from."""

    destinations: tuple[Destination, ...]
    telephony: dict[str, str]
    fleet: tuple[FleetEntry, ...]
    routes: tuple[RouteEntry, ...]


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
class AirportInputs:
    """The three YAML files of one airport, loaded and cross-checked against each other."""

    icao: str
    sop: SopData
    overrides: Overrides
    routes: RouteLibrary
