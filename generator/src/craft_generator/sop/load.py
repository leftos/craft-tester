"""Strict loading and cross-reference checking of the hand-authored airport YAML.

Strict in both directions. An unknown key anywhere is a :class:`ValueError`, so a mistyped key
cannot silently drop a rule row or a condition the game then never applies; and every reference one
row makes to another - a sector, a runway configuration, a noise window, a DP family, a runway, a
gate fix, a destination - is resolved while loading, so a broken reference fails the build instead
of the clearance. Every message names the file, the row id and the key it came from.

Each file is loaded separately (:func:`load_sop`, :func:`load_overrides`, :func:`load_routes`,
:func:`load_tec`, :func:`load_loa`), checking what it can see on its own; :func:`load_airport` loads
them all and adds the checks that span files. The facts of a destination, an airline and an aircraft
type hold at every airport, and so do the inter-ARTCC LOA rows, so they live in ``generator/shared/``
(:func:`load_shared_route_facts`, :func:`load_shared_loa_rules`) and ``routes.yaml`` lists only codes
into them. ``tec.yaml`` is optional - an airport without it has no TEC route - and is checked when
present; ``loa.yaml`` is optional too and holds only what the airport overrides by id or adds to the
shared rows (:func:`joined_loa_rules`), which are checked against the airport once joined.
"""

import re
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date
from pathlib import Path
from typing import Any

import yaml

from craft_generator.sop.model import (
    AIRCRAFT_CLASSES,
    ALTITUDE_OUTCOME_KINDS,
    APPROACH_CATEGORIES,
    CONNECTION_STRENGTHS,
    DEPARTURE_SID_KINDS,
    DIRECTIONS,
    EXPECT_ALTITUDE_POLICIES,
    GATE_DIRECTIONS,
    LOA_RULE_KIND_NAMES,
    NOTICE_EFFECT_KINDS,
    ON_REQUEST_KINDS,
    PHRASEOLOGY_READINGS,
    ROUTE_PHRASINGS,
    RUNWAY_HEADING,
    TEC_ROUTE_KINDS,
    TOP_ALTITUDE_KINDS,
    WAKE_CATEGORIES,
    WORKSHEET_KINDS,
    AircraftClass,
    AircraftGroup,
    AircraftType,
    Airline,
    AirportInfo,
    AirportInputs,
    Airway,
    AltitudeOutcome,
    AltitudeRule,
    AssignmentCondition,
    AssignmentRule,
    CommonArrival,
    DepartureRunway,
    DepartureSector,
    Destination,
    EquipmentSuffix,
    EvenAltitudeRule,
    FleetEntry,
    FrequencyOption,
    GateDirection,
    Gates,
    LoaData,
    LoaRule,
    LoaRuleKind,
    LoaRuleKindName,
    NoiseWindow,
    NonDpHeading,
    NoSid,
    Notice,
    NoticeEffect,
    OddAltitudeRule,
    Overrides,
    ParityRotatedRule,
    Phraseology,
    PhraseologyRule,
    RouteConnection,
    RouteEntry,
    RouteLibrary,
    RouteTokenRule,
    RunwayConfig,
    SecondarySource,
    SharedRouteFacts,
    SidOverride,
    SidTopAltitude,
    SopData,
    SopSource,
    TecData,
    TecRoute,
    TecSource,
    Worksheet,
    WorksheetConfig,
)

SOP_FILE = "sop.yaml"
OVERRIDES_FILE = "overrides.yaml"
ROUTES_FILE = "routes.yaml"
TEC_FILE = "tec.yaml"
LOA_FILE = "loa.yaml"
WORKSHEETS_FILE = "worksheets.yaml"
EQUIPMENT_SUFFIXES_FILE = "equipment_suffixes.yaml"
PHRASEOLOGY_RULES_FILE = "phraseology_rules.yaml"
LOA_RULES_FILE = "loa_rules.yaml"
ROUTE_CONNECTIONS_FILE = "route_connections.yaml"
AIRWAYS_FILE = "airways.yaml"
COMMON_ARRIVALS_FILE = "common_arrivals.yaml"
AIRCRAFT_CHARACTERISTICS_FILE = "faa_aircraft_characteristics.yaml"
NCT_BOUNDARY_FILE = "nct_boundary.yaml"
DESTINATIONS_FILE = "destinations.yaml"
AIRLINES_FILE = "airlines.yaml"
AIRCRAFT_TYPES_FILE = "aircraft_types.yaml"

RUNWAY_FAMILY_LENGTH = 2
SID_PLACEHOLDER = "#"
COURSE_DEGREES_MAX = 359

_SUFFIX_PATTERN = re.compile(r"^/[A-Z]$")
_CIFP_ID_PATTERN = re.compile(r"^(?P<family>[A-Z]+)\d+$")
_DESIGNATOR_PATTERN = re.compile(r"^[A-Z0-9]{2,4}$")
_AIRLINE_CODE_PATTERN = re.compile(r"^[A-Z]{3}$")
_AIRPORT_ICAO_PATTERN = re.compile(r"^[A-Z]{4}$")
_ROUTE_TOKEN_PATTERN = re.compile(r"^[A-Z0-9]{2,5}$")
_AIRWAY_ID_PATTERN = re.compile(r"^[A-Z]{1,2}\d{1,3}$")
_PROCEDURE_FAMILY_PATTERN = re.compile(r"^[A-Z]{3,5}$")
_DESTINATION_CODE_PATTERN = re.compile(r"^[A-Z0-9]{4}$")

# How a common-arrival row reads its aircraft classes back: the sheet's own words for the two sets it
# prints, and one word per class for any other set.
_COMMON_ARRIVAL_CLASS_WORDS = {frozenset({"P", "T"}): "props", frozenset({"J", "T"}): "jets and turboprops"}
_AIRCRAFT_CLASS_WORDS = {"P": "props", "T": "turboprops", "J": "jets"}


def airports_dir() -> Path:
    """Return the directory holding one subdirectory of hand-authored YAML per airport."""
    return Path(__file__).resolve().parents[3] / "airports"


def shared_dir() -> Path:
    """Return the directory holding the hand-authored YAML every airport shares."""
    return Path(__file__).resolve().parents[3] / "shared"


def airport_dir(icao: str) -> Path:
    """Return the hand-authored YAML directory of one airport.

    Args:
        icao: Four-letter ICAO identifier, e.g. ``KSFO``; case is ignored.

    Returns:
        ``generator/airports/<icao lower-cased>``. The directory is not checked for existence.
    """
    return airports_dir() / icao.lower()


def _where(path: Path) -> str:
    return f"{path.parent.name}/{path.name}"


def _kind(value: object) -> str:
    return type(value).__name__


def _string_keys(value: object, where: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{where}: expected a mapping of keys, got {_kind(value)}")
    for key in value:
        if not isinstance(key, str):
            raise ValueError(f'{where}: key {key!r} is a {_kind(key)}, not a string; quote it in the YAML, e.g. "{key}"')
    return dict(value)


def _as_text(value: object, where: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{where}: expected text, got {_kind(value)} {value!r}; quote the value in the YAML")
    return value


def _as_choice[Choice: str](value: object, allowed: tuple[Choice, ...], where: str) -> Choice:
    text = _as_text(value, where)
    for option in allowed:
        if option == text:
            return option
    raise ValueError(f"{where}: {text!r} is not one of {list(allowed)}; use one of those")


def _as_flag(value: object, where: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{where}: expected true or false, got {_kind(value)} {value!r}")
    return value


def _as_sequence(value: object, where: str) -> Sequence[Any]:
    if isinstance(value, str) or not isinstance(value, Sequence):
        raise ValueError(f"{where}: expected a list, got {_kind(value)} {value!r}")
    return value


class _Row:
    """One YAML mapping being read key by key; :meth:`finish` rejects every key nothing read."""

    def __init__(self, where: str, data: object) -> None:
        self.where = where
        self._data = _string_keys(data, where)
        self._unread = set(self._data)

    def _raw(self, key: str) -> Any:
        self._unread.discard(key)
        if key not in self._data:
            raise ValueError(f"{self.where}: required key {key!r} is missing")
        return self._data[key]

    def _optional_raw(self, key: str) -> Any:
        self._unread.discard(key)
        return self._data.get(key)

    def _at(self, key: str) -> str:
        return f"{self.where}.{key}"

    def text(self, key: str) -> str:
        return _as_text(self._raw(key), self._at(key))

    def optional_text(self, key: str) -> str | None:
        value = self._optional_raw(key)
        return None if value is None else _as_text(value, self._at(key))

    def optional_raw(self, key: str) -> Any:
        """The value as YAML wrote it, for a key whose type the caller checks itself."""
        return self._optional_raw(key)

    def number(self, key: str) -> int:
        value = self._raw(key)
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"{self._at(key)}: expected a whole number, got {_kind(value)} {value!r}")
        return value

    def optional_number(self, key: str) -> int | None:
        value = self._optional_raw(key)
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"{self._at(key)}: expected a whole number, got {_kind(value)} {value!r}")
        return value

    def optional_decimal(self, key: str) -> float | None:
        value = self._optional_raw(key)
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise ValueError(f"{self._at(key)}: expected a number, got {_kind(value)} {value!r}")
        return float(value)

    def flag(self, key: str) -> bool:
        return _as_flag(self._raw(key), self._at(key))

    def optional_flag(self, key: str, *, default: bool | None = None) -> bool | None:
        value = self._optional_raw(key)
        return default if value is None else _as_flag(value, self._at(key))

    def day(self, key: str) -> date:
        value = self._raw(key)
        if isinstance(value, date):
            return value
        try:
            return date.fromisoformat(_as_text(value, self._at(key)))
        except ValueError as exc:
            raise ValueError(f"{self._at(key)}: {value!r} is not a YYYY-MM-DD date: {exc}") from exc

    def texts(self, key: str) -> tuple[str, ...]:
        at = self._at(key)
        return tuple(_as_text(item, f"{at}[{index}]") for index, item in enumerate(_as_sequence(self._raw(key), at)))

    def optional_texts(self, key: str) -> tuple[str, ...] | None:
        value = self._optional_raw(key)
        if value is None:
            return None
        at = self._at(key)
        return tuple(_as_text(item, f"{at}[{index}]") for index, item in enumerate(_as_sequence(value, at)))

    def numbers(self, key: str) -> tuple[int, ...]:
        at = self._at(key)
        items = _as_sequence(self._raw(key), at)
        for index, item in enumerate(items):
            if isinstance(item, bool) or not isinstance(item, int):
                raise ValueError(f"{at}[{index}]: expected a whole number, got {_kind(item)} {item!r}")
        return tuple(items)

    def choice[Choice: str](self, key: str, allowed: tuple[Choice, ...]) -> Choice:
        return _as_choice(self._raw(key), allowed, self._at(key))

    def optional_choice[Choice: str](self, key: str, allowed: tuple[Choice, ...]) -> Choice | None:
        value = self._optional_raw(key)
        return None if value is None else _as_choice(value, allowed, self._at(key))

    def choices[Choice: str](self, key: str, allowed: tuple[Choice, ...]) -> tuple[Choice, ...]:
        at = self._at(key)
        return tuple(_as_choice(item, allowed, f"{at}[{index}]") for index, item in enumerate(_as_sequence(self._raw(key), at)))

    def optional_choices[Choice: str](self, key: str, allowed: tuple[Choice, ...]) -> tuple[Choice, ...]:
        return self.optional_choices_or_none(key, allowed) or ()

    def optional_choices_or_none[Choice: str](self, key: str, allowed: tuple[Choice, ...]) -> tuple[Choice, ...] | None:
        """Read an optional list of choices, keeping an absent key distinct from an empty list."""
        value = self._optional_raw(key)
        if value is None:
            return None
        at = self._at(key)
        return tuple(_as_choice(item, allowed, f"{at}[{index}]") for index, item in enumerate(_as_sequence(value, at)))

    def child(self, key: str) -> "_Row":
        return _Row(self._at(key), self._raw(key))

    def optional_child(self, key: str) -> "_Row | None":
        value = self._optional_raw(key)
        return None if value is None else _Row(self._at(key), value)

    def children(self, key: str) -> list["_Row"]:
        at = self._at(key)
        rows: list[_Row] = []
        for index, item in enumerate(_as_sequence(self._raw(key), at)):
            label = item.get("id", index) if isinstance(item, Mapping) else index
            rows.append(_Row(f"{at}[{label}]", item))
        return rows

    def table(self, key: str) -> dict[str, Any]:
        return _string_keys(self._raw(key), self._at(key))

    def optional_table(self, key: str) -> dict[str, Any] | None:
        value = self._optional_raw(key)
        return None if value is None else _string_keys(value, self._at(key))

    def finish(self) -> None:
        if self._unread:
            raise ValueError(f"{self.where}: unknown key(s) {sorted(self._unread)}; remove them or fix the spelling, the loader ignores nothing")


def _load_yaml_mapping(path: Path, where: str) -> dict[str, Any]:
    try:
        body = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ValueError(f"{where}: not valid YAML: {exc}") from exc
    return _string_keys(body, where)


def _text_table(value: object, where: str) -> dict[str, str]:
    table = _string_keys(value, where)
    return {key: _as_text(item, f"{where}.{key}") for key, item in table.items()}


def _flag_table(value: object, where: str) -> dict[str, bool]:
    table = _string_keys(value, where)
    return {key: _as_flag(item, f"{where}.{key}") for key, item in table.items()}


def _sop_source(row: _Row) -> SopSource:
    source = SopSource(
        title=row.text("title"),
        version=row.text("version"),
        url=row.text("url"),
        sha256=row.text("sha256"),
        transcribed_at=row.day("transcribed_at"),
        sentinels=row.texts("sentinels"),
    )
    row.finish()
    return source


def _secondary_source(row: _Row) -> SecondarySource:
    source = SecondarySource(id=row.text("id"), title=row.text("title"), dated=row.day("dated"), url=row.text("url"))
    row.finish()
    return source


def _airport_info(row: _Row) -> AirportInfo:
    info = AirportInfo(icao=row.text("icao"), faa=row.text("faa"), spoken=row.text("spoken"), clearance_delivery=row.text("clearance_delivery"))
    row.finish()
    return info


def _aircraft_group(row: _Row) -> AircraftGroup:
    group = AircraftGroup(classes=row.optional_choices("classes", AIRCRAFT_CLASSES), types=row.optional_texts("types") or ())
    row.finish()
    if not group.classes and not group.types:
        raise ValueError(f"{row.where}: an aircraft group addresses nobody; give it `classes`, `types`, or both")
    return group


def _aircraft_groups(root: _Row) -> dict[str, AircraftGroup]:
    table = root.optional_table("aircraft_groups")
    if table is None:
        return {}
    at = f"{root.where}.aircraft_groups"
    return {name: _aircraft_group(_Row(f"{at}[{name}]", value)) for name, value in table.items()}


def _airline_codes(row: _Row, key: str) -> tuple[str, ...]:
    codes = row.optional_texts(key) or ()
    for index, code in enumerate(codes):
        if _AIRLINE_CODE_PATTERN.fullmatch(code) is None:
            raise ValueError(
                f"{row.where}.{key}[{index}]: {code!r} is not a three-letter upper-case ICAO airline code, e.g. PCM; "
                "write the callsign prefix `telephony` in routes.yaml keys the airline by"
            )
    return codes


def _departure_runway(row: _Row) -> DepartureRunway:
    runway = DepartureRunway(
        runway=row.text("runway"),
        classes=row.choices("classes", AIRCRAFT_CLASSES),
        default_for_airlines=_airline_codes(row, "default_for_airlines"),
        default_for_groups=row.optional_texts("default_for_groups") or (),
        default_for_classes=row.optional_choices("default_for_classes", AIRCRAFT_CLASSES),
        on_request_for=row.optional_choices("on_request_for", ON_REQUEST_KINDS),
        note=row.optional_text("note"),
    )
    row.finish()
    if runway.on_request_for and runway.default_for_classes:
        raise ValueError(
            f"{row.where}: runway {runway.runway!r} is the default for class(es) {list(runway.default_for_classes)} and also "
            f"on request for {list(runway.on_request_for)}; a runway is either the normal choice of a class or an exception it is "
            "asked for, so split the two into separate rows"
        )
    if runway.on_request_for and runway.default_for_airlines:
        raise ValueError(
            f"{row.where}: runway {runway.runway!r} is the default for airline(s) {list(runway.default_for_airlines)} and also "
            f"on request for {list(runway.on_request_for)}; a runway is either the normal choice of an airline or an exception it is "
            "asked for, so split the two into separate rows"
        )
    if runway.on_request_for and runway.default_for_groups:
        raise ValueError(
            f"{row.where}: runway {runway.runway!r} is the default for group(s) {list(runway.default_for_groups)} and also "
            f"on request for {list(runway.on_request_for)}; a runway is either the normal choice of a group or an exception it is "
            "asked for, so split the two into separate rows"
        )
    return runway


def _runway_config(row: _Row) -> RunwayConfig:
    config = RunwayConfig(
        id=row.text("id"),
        source=row.text("source"),
        name=row.text("name"),
        plan=row.text("plan"),
        training_weight=row.number("training_weight"),
        arrival_runways=row.texts("arrival_runways"),
        departure_runways=tuple(_departure_runway(child) for child in row.children("departure_runways")),
    )
    row.finish()
    if config.training_weight < 1:
        raise ValueError(
            f"{row.where}: training_weight must be a positive integer, got {config.training_weight}; it is the scenario "
            "generator's draw weight relative to the other configurations"
        )
    return config


def _departure_sector(row: _Row) -> DepartureSector:
    sector = DepartureSector(id=row.text("id"), name=row.text("name"), frequency=row.text("frequency"))
    row.finish()
    return sector


def _frequency_option(row: _Row) -> FrequencyOption:
    option = FrequencyOption(label=row.text("label"), value=row.text("value"))
    row.finish()
    return option


def _gates(row: _Row) -> Gates:
    gates = Gates(north=row.texts("north"), south=row.texts("south"), oceanic=row.texts("oceanic"))
    row.finish()
    return gates


def _no_sid(row: _Row) -> NoSid:
    no_sid = NoSid(runway_families=row.texts("runway_families"), phrasing=row.choice("phrasing", ROUTE_PHRASINGS))
    row.finish()
    return no_sid


def _noise_window(row: _Row) -> NoiseWindow:
    window = NoiseWindow(id=row.text("id"), start=row.text("start"), end=row.text("end"), sunday_end=row.optional_text("sunday_end"))
    row.finish()
    return window


def _assignment_condition(row: _Row) -> AssignmentCondition:
    condition = AssignmentCondition(
        configs=row.optional_texts("configs"),
        not_configs=row.optional_texts("not_configs"),
        noise_window=row.optional_text("noise_window"),
        rnav=row.optional_flag("rnav"),
        exit_fixes=row.optional_texts("exit_fixes"),
        forced_transition=row.optional_text("forced_transition"),
        tec_route_without_dp=row.optional_flag("tec_route_without_dp"),
    )
    row.finish()
    return condition


def _check_non_dp_heading(value: object, where: str) -> NonDpHeading:
    """One non-DP heading as YAML wrote it: the runway heading, or a magnetic heading of 1 to 360 degrees."""
    if value == RUNWAY_HEADING:
        return RUNWAY_HEADING
    if isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 360:
        return value
    raise ValueError(f"{where}: non_dp_heading is {value!r}; write 'runway heading' or a magnetic heading as an integer from 1 to 360")


def _non_dp_heading(row: _Row) -> NonDpHeading | None:
    """The heading a row clears a flight on where it assigns no DP: the runway heading, or 1 to 360 degrees."""
    value = row.optional_raw("non_dp_heading")
    return None if value is None else _check_non_dp_heading(value, row.where)


def _non_dp_headings(row: _Row) -> tuple[NonDpHeading, ...] | None:
    """The headings a row is keyed to, for a row that answers only flights cleared without a DP."""
    value = row.optional_raw("non_dp_headings")
    if value is None:
        return None
    at = f"{row.where}.non_dp_headings"
    return tuple(_check_non_dp_heading(item, at) for item in _as_sequence(value, at))


def _assignment_rule(row: _Row) -> AssignmentRule:
    when = row.optional_child("when")
    rule = AssignmentRule(
        id=row.text("id"),
        source=row.text("source"),
        text=row.text("text"),
        plan=row.text("plan"),
        direction=row.choice("direction", DIRECTIONS),
        runway_families=row.texts("runway_families"),
        classes=row.choices("classes", AIRCRAFT_CLASSES),
        groups=row.optional_texts("groups"),
        approach_categories=row.optional_choices_or_none("approach_categories", APPROACH_CATEGORIES),
        sid_family=row.optional_text("sid_family"),
        non_dp_heading=_non_dp_heading(row),
        sector=row.text("sector"),
        when=None if when is None else _assignment_condition(when),
    )
    row.finish()
    if (rule.sid_family is None) == (rule.non_dp_heading is None):
        raise ValueError(
            f"{row.where}: a rule needs exactly one of `sid_family` and `non_dp_heading`, "
            f"got sid_family={rule.sid_family!r} and non_dp_heading={rule.non_dp_heading!r}; "
            "name the DP family, or set sid_family to null and give the heading"
        )
    return rule


def _altitude_outcome(row: _Row) -> AltitudeOutcome:
    outcome = AltitudeOutcome(kind=row.choice("kind", ALTITUDE_OUTCOME_KINDS), feet=row.number("feet"))
    row.finish()
    return outcome


def _altitude_rule(row: _Row) -> AltitudeRule:
    rule = AltitudeRule(
        id=row.text("id"),
        source=row.text("source"),
        text=row.text("text"),
        plan=row.text("plan"),
        runway_families=row.texts("runway_families"),
        classes=row.choices("classes", AIRCRAFT_CLASSES),
        groups=row.optional_texts("groups"),
        sid_families=row.optional_texts("sid_families"),
        non_dp_headings=_non_dp_headings(row),
        outcome=_altitude_outcome(row.child("outcome")),
        when_top_altitude_published=row.choice("when_top_altitude_published", ALTITUDE_OUTCOME_KINDS),
        expect_after_minutes=row.number("expect_after_minutes"),
    )
    row.finish()
    if rule.sid_families is not None and rule.non_dp_headings is not None:
        raise ValueError(
            f"{row.where}: a rule keys on `sid_families` or on `non_dp_headings`, never both; "
            "drop one of them, or drop both to key the row to every procedure"
        )
    return rule


def _notice_effect(row: _Row) -> NoticeEffect:
    heading = row.optional_raw("heading")
    effect = NoticeEffect(
        kind=row.choice("kind", NOTICE_EFFECT_KINDS),
        sid_family=row.text("sid_family"),
        heading=None if heading is None else _check_non_dp_heading(heading, f"{row.where}.heading"),
    )
    row.finish()
    return effect


def _notice(row: _Row) -> Notice:
    notice = Notice(
        id=row.text("id"),
        source=row.text("source"),
        dated=row.day("dated"),
        text=row.text("text"),
        plan=row.text("plan"),
        effect=_notice_effect(row.child("effect")),
        default_active=row.flag("default_active"),
    )
    row.finish()
    return notice


def _phraseology(row: _Row) -> Phraseology:
    phraseology = Phraseology(
        expect_altitude=row.choice("expect_altitude", EXPECT_ALTITUDE_POLICIES),
        non_standard_interim_expect_minutes=row.number("non_standard_interim_expect_minutes"),
        vector_hybrid_transitions_spoken=row.flag("vector_hybrid_transitions_spoken"),
    )
    row.finish()
    return phraseology


def _phraseology_rule(row: _Row) -> PhraseologyRule:
    rule = PhraseologyRule(id=row.text("id"), source=row.text("source"), text=row.text("text"))
    row.finish()
    return rule


def _check_phraseology_rules(rules: Sequence[PhraseologyRule], where: str) -> None:
    seen: set[str] = set()
    for rule in rules:
        if rule.id in seen:
            raise ValueError(
                f"{where} phraseology_rules[{rule.id}]: the id {rule.id!r} is already used by an earlier row of this file; "
                "the engine cites a rule by its id, so a file states each id once"
            )
        seen.add(rule.id)


def _plan_preference(value: object, where: str) -> dict[GateDirection, dict[str, str]]:
    table = _string_keys(value, where)
    return {_as_choice(key, GATE_DIRECTIONS, f"{where} key"): _text_table(item, f"{where}.{key}") for key, item in table.items()}


def _direction_runway_preference(table: Mapping[str, Any], where: str) -> dict[str, dict[GateDirection, dict[str, str]]]:
    return {plan: _plan_preference(value, f"{where}.{plan}") for plan, value in table.items()}


def _sop_data(root: _Row) -> SopData:
    sop = SopData(
        source=_sop_source(root.child("source")),
        secondary_sources=tuple(_secondary_source(child) for child in root.children("secondary_sources")),
        airport=_airport_info(root.child("airport")),
        aircraft_groups=_aircraft_groups(root),
        runways=root.texts("runways"),
        runway_configs=tuple(_runway_config(child) for child in root.children("runway_configs")),
        departure_sectors=tuple(_departure_sector(child) for child in root.children("departure_sectors")),
        departure_staffing_fallbacks=tuple(_departure_sector(child) for child in root.children("departure_staffing_fallbacks")),
        direction_runway_preference=_direction_runway_preference(
            root.table("direction_runway_preference"), f"{root.where}.direction_runway_preference"
        ),
        frequencies=tuple(_frequency_option(child) for child in root.children("frequencies")),
        gates=_gates(root.child("gates")),
        no_sid=_no_sid(root.child("no_sid")),
        noise_windows=tuple(_noise_window(child) for child in root.children("noise_windows")),
        assignment_rules=tuple(_assignment_rule(child) for child in root.children("assignment_rules")),
        altitude_rules=tuple(_altitude_rule(child) for child in root.children("altitude_rules")),
        notices=tuple(_notice(child) for child in root.children("notices")),
        phraseology=_phraseology(root.child("phraseology")),
        phraseology_rules=tuple(_phraseology_rule(child) for child in root.children("phraseology_rules")),
    )
    root.finish()
    return sop


def _runway_families(runways: Sequence[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(runway[:RUNWAY_FAMILY_LENGTH] for runway in runways))


def _check_runway_families(families: Sequence[str], known: Sequence[str], where: str) -> None:
    for family in families:
        if family not in known:
            raise ValueError(f"{where}: runway family {family!r} is not a two-character prefix of any runway in `runways`; use one of {list(known)}")


def _check_audience(classes: Sequence[AircraftClass], groups: Sequence[str] | None, at: str, sop: SopData) -> None:
    """Check that a rule row addresses somebody, by class or by a group the SOP defines."""
    if not classes and not groups:
        raise ValueError(f"{at}: the row addresses nobody; list the aircraft `classes` it applies to, or the `groups` of `aircraft_groups`")
    for group in groups or ():
        if group not in sop.aircraft_groups:
            known = sorted(sop.aircraft_groups)
            raise ValueError(f"{at}: groups names {group!r}, which is not an `aircraft_groups` id; use one of {known} or add the group")


def _check_assignment_rule(rule: AssignmentRule, where: str, sop: SopData, families: Sequence[str]) -> None:
    at = f"{where} assignment_rules[{rule.id}]"
    _check_runway_families(rule.runway_families, families, at)
    _check_audience(rule.classes, rule.groups, at, sop)
    if rule.sector not in {sector.id for sector in sop.departure_sectors}:
        known = [sector.id for sector in sop.departure_sectors]
        raise ValueError(f"{at}: sector {rule.sector!r} is not a `departure_sectors` id; use one of {known} or add the sector")
    if rule.when is None:
        return
    if rule.when.noise_window is not None and rule.when.noise_window not in {window.id for window in sop.noise_windows}:
        known = [window.id for window in sop.noise_windows]
        raise ValueError(f"{at}: when.noise_window {rule.when.noise_window!r} is not a `noise_windows` id; use one of {known} or add the window")
    config_ids = [config.id for config in sop.runway_configs]
    for key, values in (("configs", rule.when.configs), ("not_configs", rule.when.not_configs)):
        for value in values or ():
            if value not in config_ids:
                raise ValueError(f"{at}: when.{key} names {value!r}, which is not a `runway_configs` id; use one of {config_ids}")


def _check_gates(gates: Gates, where: str) -> None:
    seen: dict[str, GateDirection] = {}
    for direction, fixes in _gate_items(gates):
        for fix in fixes:
            if fix in seen:
                raise ValueError(
                    f"{where} gates.{direction}: fix {fix!r} is already listed under gates.{seen[fix]}; "
                    "a fix belongs to exactly one direction, so drop one of the two"
                )
            seen[fix] = direction


def _gate_items(gates: Gates) -> Iterator[tuple[GateDirection, tuple[str, ...]]]:
    yield "north", gates.north
    yield "south", gates.south
    yield "oceanic", gates.oceanic


def _check_direction_runway_preference(sop: SopData, where: str, families: Sequence[str]) -> None:
    for plan, directions in sop.direction_runway_preference.items():
        for direction, preference in directions.items():
            at = f"{where} direction_runway_preference.{plan}.{direction}"
            _check_runway_families(tuple(preference), families, at)
            for family, runway in preference.items():
                if runway not in sop.runways:
                    raise ValueError(f"{at}.{family}: runway {runway!r} is not in `runways`; use one of {list(sop.runways)}")


def _check_runway_airlines(config: RunwayConfig, where: str) -> None:
    defaulted: dict[str, str] = {}
    for runway in config.departure_runways:
        at = f"{where} runway_configs[{config.id}].departure_runways[{runway.runway}].default_for_airlines"
        for code in runway.default_for_airlines:
            if code in defaulted:
                raise ValueError(
                    f"{at}: airline {code!r} already defaults to runway {defaulted[code]!r} in this configuration; "
                    "at most one departure runway per configuration may default an airline"
                )
            defaulted[code] = runway.runway


def _check_runway_groups(config: RunwayConfig, where: str, sop: SopData) -> None:
    defaulted: dict[str, str] = {}
    for runway in config.departure_runways:
        at = f"{where} runway_configs[{config.id}].departure_runways[{runway.runway}].default_for_groups"
        for group in runway.default_for_groups:
            if group not in sop.aircraft_groups:
                known = sorted(sop.aircraft_groups)
                raise ValueError(f"{at}: {group!r} is not an `aircraft_groups` id; use one of {known} or add the group")
            if group in defaulted:
                raise ValueError(
                    f"{at}: group {group!r} already defaults to runway {defaulted[group]!r} in this configuration; "
                    "at most one departure runway per configuration may default a group"
                )
            defaulted[group] = runway.runway


def _check_runway_config(config: RunwayConfig, where: str, sop: SopData) -> None:
    _check_runway_airlines(config, where)
    _check_runway_groups(config, where, sop)
    defaulted: dict[AircraftClass, str] = {}
    for runway in config.departure_runways:
        at = f"{where} runway_configs[{config.id}].departure_runways[{runway.runway}].default_for_classes"
        for aircraft_class in runway.default_for_classes:
            if aircraft_class not in runway.classes:
                raise ValueError(
                    f"{at}: class {aircraft_class!r} is not in the row's `classes` {list(runway.classes)}; "
                    "a runway cannot be the default for a class that may not use it"
                )
            if aircraft_class in defaulted:
                raise ValueError(
                    f"{at}: class {aircraft_class!r} already defaults to runway {defaulted[aircraft_class]!r} in this configuration; "
                    "at most one departure runway per configuration may default a class"
                )
            defaulted[aircraft_class] = runway.runway


def _check_sop(sop: SopData, where: str) -> None:
    families = _runway_families(sop.runways)
    for config in sop.runway_configs:
        _check_runway_config(config, where, sop)
    for rule in sop.assignment_rules:
        _check_assignment_rule(rule, where, sop, families)
    for altitude_rule in sop.altitude_rules:
        at = f"{where} altitude_rules[{altitude_rule.id}]"
        _check_runway_families(altitude_rule.runway_families, families, at)
        _check_audience(altitude_rule.classes, altitude_rule.groups, at, sop)
    _check_runway_families(sop.no_sid.runway_families, families, f"{where} no_sid")
    _check_direction_runway_preference(sop, where, families)
    _check_gates(sop.gates, where)
    _check_phraseology_rules(sop.phraseology_rules, where)


def load_sop(path: Path) -> SopData:
    """Load and check one airport's ``sop.yaml``.

    Args:
        path: Path to the file.

    Returns:
        The transcribed SOP.

    Raises:
        ValueError: The file is not a YAML mapping, carries an unknown or mistyped key, holds a rule
            whose sector, runway configuration, noise window, aircraft group or runway family does
            not exist, holds a rule that addresses no aircraft at all, holds an aircraft group that
            names neither a class nor a type, holds a departure runway that is both a class, group
            or airline default and on request, holds a malformed airline code, holds a departure
            runway defaulting a group that is not an ``aircraft_groups`` id, defaults one airline or
            one group to two runways of a configuration, or states one phraseology rule id twice.
    """
    where = _where(path)
    sop = _sop_data(_Row(where, _load_yaml_mapping(path, where)))
    _check_sop(sop, where)
    return sop


def _sid_top_altitude(row: _Row) -> SidTopAltitude:
    top_altitude = SidTopAltitude(kind=row.choice("kind", TOP_ALTITUDE_KINDS), feet=row.optional_number("feet"))
    row.finish()
    return top_altitude


def _sid_override(chart_name: str, row: _Row) -> SidOverride:
    top_altitude = row.optional_child("top_altitude")
    restrictions = row.optional_table("crossing_restrictions_by_runway_family")
    override = SidOverride(
        chart_name=chart_name,
        cifp_id=row.text("cifp_id"),
        spoken=row.optional_text("spoken"),
        kind=row.optional_choice("kind", DEPARTURE_SID_KINDS),
        runways=row.optional_texts("runways"),
        top_altitude=None if top_altitude is None else _sid_top_altitude(top_altitude),
        has_crossing_restrictions=row.optional_flag("has_crossing_restrictions"),
        crossing_restrictions_by_runway_family=None
        if restrictions is None
        else _flag_table(restrictions, f"{row.where}.crossing_restrictions_by_runway_family"),
        route_phrasing=row.optional_choice("route_phrasing", ROUTE_PHRASINGS),
        transitions_spoken_as_transition=row.optional_flag("transitions_spoken_as_transition"),
        climb_via_eligible=row.optional_flag("climb_via_eligible"),
        expect_filed_altitude_minutes=row.optional_number("expect_filed_altitude_minutes"),
        note=row.optional_text("note"),
    )
    row.finish()
    minutes = override.expect_filed_altitude_minutes
    if minutes is not None and minutes < 1:
        raise ValueError(
            f"{row.where}: expect_filed_altitude_minutes must be a positive whole number, got {minutes}; it is the minutes the "
            "chart's expect filed altitude note publishes"
        )
    return override


def sid_family_of(cifp_id: str, where: str) -> str:
    """Return the family of a CIFP procedure id, i.e. the letters before its version number.

    Args:
        cifp_id: A procedure identifier such as ``TRUKN2``.
        where: The file and row the id came from, used in the error message.

    Returns:
        The family, e.g. ``TRUKN``.

    Raises:
        ValueError: The identifier is not upper-case letters followed by a version number.
    """
    match = _CIFP_ID_PATTERN.fullmatch(cifp_id)
    if match is None:
        raise ValueError(f"{where}: cifp_id {cifp_id!r} is not upper-case letters followed by a version number, e.g. TRUKN2")
    return match.group("family")


def _check_overrides(overrides: Overrides, where: str) -> None:
    seen: dict[str, str] = {}
    for chart_name, override in overrides.sids.items():
        at = f"{where} sids[{chart_name}]"
        sid_family_of(override.cifp_id, at)
        if override.cifp_id in seen:
            raise ValueError(f"{at}: cifp_id {override.cifp_id!r} is already used by sids[{seen[override.cifp_id]}]; one chart per procedure id")
        seen[override.cifp_id] = chart_name


def load_overrides(path: Path) -> Overrides:
    """Load and check one airport's ``overrides.yaml``.

    Args:
        path: Path to the file.

    Returns:
        The per-DP corrections and spoken fix names.

    Raises:
        ValueError: The file carries an unknown key, a malformed ``cifp_id``, an
            ``expect_filed_altitude_minutes`` that is not a positive whole number, or two charts
            claiming the same procedure id.
    """
    where = _where(path)
    root = _Row(where, _load_yaml_mapping(path, where))
    sids = root.table("sids")
    overrides = Overrides(
        sids={chart_name: _sid_override(chart_name, _Row(f"{where}.sids[{chart_name}]", value)) for chart_name, value in sids.items()},
        fix_spoken=_text_table(root.table("fix_spoken"), f"{where}.fix_spoken"),
    )
    root.finish()
    _check_overrides(overrides, where)
    return overrides


def _outside_nct(row: _Row) -> str | None:
    reason = row.optional_text("outside_nct")
    if reason is not None and not reason.strip():
        raise ValueError(f"{row.where}.outside_nct: the key states no reason; write which facility owns the airspace over the field instead")
    return reason


def _destination(icao: str, row: _Row) -> Destination:
    if row.optional_raw("nct") is not None:
        raise ValueError(
            f"{row.where}: `nct` is computed at build time from generator/shared/{NCT_BOUNDARY_FILE}, never stated by hand; remove the key, and "
            "state `outside_nct: <reason>` where another facility owns the airspace over a field that polygon holds"
        )
    destination = Destination(
        icao=icao,
        spoken=row.text("spoken"),
        artcc=row.text("artcc"),
        outside_nct=_outside_nct(row),
        lat=row.optional_decimal("lat"),
        lon=row.optional_decimal("lon"),
    )
    row.finish()
    return destination


def load_shared_destinations(path: Path) -> dict[str, Destination]:
    """Load the destination facts every airport shares.

    Args:
        path: Path to ``generator/shared/destinations.yaml``.

    Returns:
        One row per destination, keyed by its code.

    Raises:
        ValueError: The file is not a YAML mapping or carries an unknown key.
        OSError: The file is missing.
    """
    where = _where(path)
    root = _Row(where, _load_yaml_mapping(path, where))
    table = root.table("destinations")
    destinations = {icao: _destination(icao, _Row(f"{where}.destinations[{icao}]", value)) for icao, value in table.items()}
    root.finish()
    return destinations


def _airline(code: str, row: _Row) -> Airline:
    airline = Airline(
        code=code,
        telephony=row.text("telephony"),
        cargo=bool(row.optional_flag("cargo", default=False)),
        types=row.texts("types"),
    )
    row.finish()
    return airline


def load_airlines(path: Path) -> dict[str, Airline]:
    """Load the airline facts every airport shares.

    Args:
        path: Path to ``generator/shared/airlines.yaml``.

    Returns:
        One row per airline, keyed by its ICAO code.

    Raises:
        ValueError: The file is not a YAML mapping or carries an unknown key.
        OSError: The file is missing.
    """
    where = _where(path)
    root = _Row(where, _load_yaml_mapping(path, where))
    table = root.table("airlines")
    airlines = {code: _airline(code, _Row(f"{where}.airlines[{code}]", value)) for code, value in table.items()}
    root.finish()
    return airlines


def _aircraft_type(designator: str, row: _Row) -> AircraftType:
    aircraft = AircraftType(
        designator=designator,
        aircraft_class=row.choice("class", AIRCRAFT_CLASSES),
        wtc=row.choice("wtc", WAKE_CATEGORIES),
        suffixes=row.texts("suffixes"),
        approach_category=row.optional_choice("approach_category", APPROACH_CATEGORIES),
        note=row.optional_text("note"),
    )
    row.finish()
    for suffix in aircraft.suffixes:
        if _SUFFIX_PATTERN.fullmatch(suffix) is None:
            raise ValueError(f"{row.where}: suffix {suffix!r} is not a slash and one upper-case letter, e.g. /L; see FAA JO 7110.65 TBL 2-3-10")
    return aircraft


def load_aircraft_types(path: Path) -> dict[str, AircraftType]:
    """Load the aircraft-type facts every airport shares.

    Args:
        path: Path to ``generator/shared/aircraft_types.yaml``.

    Returns:
        One row per type, keyed by its designator.

    Raises:
        ValueError: The file is not a YAML mapping, carries an unknown key, names an aircraft class
            outside P/T/J or a wake category outside L/M/H/J, or holds a malformed equipment suffix.
        OSError: The file is missing.
    """
    where = _where(path)
    root = _Row(where, _load_yaml_mapping(path, where))
    table = root.table("types")
    types = {designator: _aircraft_type(designator, _Row(f"{where}.types[{designator}]", value)) for designator, value in table.items()}
    root.finish()
    return types


def load_shared_route_facts(shared: Path) -> SharedRouteFacts:
    """Load the destination, airline and aircraft-type tables, the LOA rows, airways and common arrivals every airport shares.

    Args:
        shared: The ``generator/shared`` directory, i.e. :func:`shared_dir`.

    Returns:
        The three tables, each keyed by code, that an airport's ``routes.yaml`` lists codes into, the
        inter-ARTCC LOA rows every airport inherits, the airways whose direction is fixed, and the
        arrivals ZOA puts a flight to the Los Angeles basin on.

    Raises:
        ValueError: One of the six files fails its own checks.
        OSError: One of the six files is missing.
    """
    return SharedRouteFacts(
        destinations=load_shared_destinations(shared / DESTINATIONS_FILE),
        airlines=load_airlines(shared / AIRLINES_FILE),
        aircraft_types=load_aircraft_types(shared / AIRCRAFT_TYPES_FILE),
        loa=load_shared_loa_rules(shared / LOA_RULES_FILE),
        airways=load_airways(shared / AIRWAYS_FILE),
        common_arrivals=load_common_arrivals(shared / COMMON_ARRIVALS_FILE),
    )


def _route_entry(row: _Row) -> RouteEntry:
    entry = RouteEntry(
        exit_fix=row.text("exit_fix"),
        destination=row.text("destination"),
        tail=row.text("tail"),
        classes=row.choices("classes", AIRCRAFT_CLASSES),
        altitudes=row.numbers("altitudes"),
    )
    row.finish()
    return entry


def _check_routes(routes: RouteLibrary, where: str) -> None:
    known = [destination.icao for destination in routes.destinations]
    for route in routes.routes:
        if route.destination not in known:
            at = f"{where} routes[{route.exit_fix} -> {route.destination}]"
            raise ValueError(f"{at}: destination {route.destination!r} is not in `destinations`; add it there first")


def _listed_codes(root: _Row, key: str, where: str) -> tuple[str, ...]:
    codes = root.texts(key)
    seen: set[str] = set()
    for code in codes:
        if code in seen:
            raise ValueError(f"{where}.{key}: {code!r} is listed twice; an airport names each code once")
        seen.add(code)
    return codes


def _shared_rows[Row](codes: Sequence[str], table: Mapping[str, Row], key: str, where: str, shared_file: str) -> tuple[Row, ...]:
    rows: list[Row] = []
    for code in codes:
        row = table.get(code)
        if row is None:
            raise ValueError(
                f"{where}.{key}: {code!r} is not in generator/shared/{shared_file}; add it there first, "
                "an airport lists codes and the shared file states the facts"
            )
        rows.append(row)
    return tuple(rows)


def _composed_fleet_entry(aircraft: AircraftType, airlines: Sequence[Airline]) -> FleetEntry:
    return FleetEntry(
        type=aircraft.designator,
        aircraft_class=aircraft.aircraft_class,
        wtc=aircraft.wtc,
        suffixes=aircraft.suffixes,
        airlines=tuple(airline.code for airline in airlines if aircraft.designator in airline.types),
        approach_category=aircraft.approach_category,
    )


def load_routes(path: Path, shared: SharedRouteFacts) -> RouteLibrary:
    """Load and check one airport's ``routes.yaml``, composing it against the shared facts.

    The file lists destination codes, airline codes and type designators; every fact behind them is
    read from ``shared``, so an airport states which of them it flies and never what they are.

    Args:
        path: Path to the file.
        shared: The destination, airline and aircraft-type tables of ``generator/shared``.

    Returns:
        The destinations, airline telephony, cargo airlines, fleet and filed routes, each in the
        order the file lists its codes.

    Raises:
        ValueError: The file carries an unknown key, an aircraft class outside P/T/J, a destination,
            airline or type code the shared files do not state, a code listed twice, or a route filed
            to a destination the file does not list.
    """
    where = _where(path)
    root = _Row(where, _load_yaml_mapping(path, where))
    destination_codes = _listed_codes(root, "destinations", where)
    airline_codes = _listed_codes(root, "airlines", where)
    fleet_codes = _listed_codes(root, "fleet", where)
    filed = tuple(_route_entry(child) for child in root.children("routes"))
    root.finish()
    airlines = _shared_rows(airline_codes, shared.airlines, "airlines", where, AIRLINES_FILE)
    types = _shared_rows(fleet_codes, shared.aircraft_types, "fleet", where, AIRCRAFT_TYPES_FILE)
    routes = RouteLibrary(
        destinations=_shared_rows(destination_codes, shared.destinations, "destinations", where, DESTINATIONS_FILE),
        telephony={airline.code: airline.telephony for airline in airlines},
        cargo_airlines=tuple(airline.code for airline in airlines if airline.cargo),
        fleet=tuple(_composed_fleet_entry(aircraft, airlines) for aircraft in types),
        routes=filed,
    )
    _check_routes(routes, where)
    return routes


def _equipment_suffix(row: _Row) -> EquipmentSuffix:
    suffix = EquipmentSuffix(
        suffix=row.text("suffix"),
        rnav=row.optional_flag("rnav"),
        gnss=row.optional_flag("gnss"),
        rvsm=row.flag("rvsm"),
        transponder_mode_c=row.flag("transponder_mode_c"),
        text=row.text("text"),
    )
    row.finish()
    if _SUFFIX_PATTERN.fullmatch(suffix.suffix) is None:
        raise ValueError(f"{row.where}: suffix {suffix.suffix!r} is not a slash and one upper-case letter, e.g. /L; see FAA JO 7110.65 TBL 2-3-10")
    return suffix


def load_equipment_suffixes(path: Path) -> tuple[EquipmentSuffix, ...]:
    """Load the shared equipment suffix table.

    Args:
        path: Path to ``generator/shared/equipment_suffixes.yaml``.

    Returns:
        One row per suffix, in file order.

    Raises:
        ValueError: The file is not a YAML mapping, or carries an unknown key or a malformed suffix.
        OSError: The file is missing.
    """
    where = _where(path)
    root = _Row(where, _load_yaml_mapping(path, where))
    suffixes = tuple(_equipment_suffix(child) for child in root.children("suffixes"))
    root.finish()
    return suffixes


def load_phraseology_rules(path: Path) -> tuple[PhraseologyRule, ...]:
    """Load the phraseology rule rows every airport shares.

    Args:
        path: Path to ``generator/shared/phraseology_rules.yaml``.

    Returns:
        One row per rule, in file order. An airport's own ``sop.yaml`` overrides a row of the same id.

    Raises:
        ValueError: The file is not a YAML mapping, carries an unknown key, or states one rule id twice.
        OSError: The file is missing.
    """
    where = _where(path)
    root = _Row(where, _load_yaml_mapping(path, where))
    rules = tuple(_phraseology_rule(child) for child in root.children("phraseology_rules"))
    root.finish()
    _check_phraseology_rules(rules, where)
    return rules


def _route_token(value: str, key: str, row: _Row) -> str:
    if _ROUTE_TOKEN_PATTERN.fullmatch(value) is None:
        raise ValueError(f"{row.where}.{key}: {value!r} is not an upper-case route token of two to five letters or digits, e.g. EBAYE, AVE or Q120")
    return value


def _route_connection(source: str, row: _Row) -> RouteConnection:
    connection = RouteConnection(
        from_fix=_route_token(row.text("from"), "from", row),
        to=_route_token(row.text("to"), "to", row),
        connects=row.choice("connects", CONNECTION_STRENGTHS),
        source=source,
    )
    row.finish()
    return connection


def _check_route_connections(connections: Sequence[RouteConnection], where: str) -> None:
    seen: set[tuple[str, str]] = set()
    for connection in connections:
        pair = (connection.from_fix, connection.to)
        if pair in seen:
            raise ValueError(
                f"{where} connections[{connection.from_fix} -> {connection.to}]: the pair is already stated by an earlier row of this file; "
                "the engine cites a connection by its pair, so a file states each pair once"
            )
        seen.add(pair)


def load_route_connections(path: Path) -> tuple[RouteConnection, ...]:
    """Load the route-connection rows every airport shares.

    Args:
        path: Path to ``generator/shared/route_connections.yaml``.

    Returns:
        One row per arrow of the cheat sheet, in file order, each carrying the file-level source.

    Raises:
        ValueError: The file is not a YAML mapping, carries an unknown key, names a strength other
            than ``always`` or ``usually``, holds a ``from`` or ``to`` that is not an upper-case
            route token, or states one ``(from, to)`` pair twice.
        OSError: The file is missing.
    """
    where = _where(path)
    root = _Row(where, _load_yaml_mapping(path, where))
    source = root.text("source")
    connections = tuple(_route_connection(source, child) for child in root.children("connections"))
    root.finish()
    _check_route_connections(connections, where)
    return connections


def _airway(row: _Row) -> Airway:
    identifier = row.text("id")
    if _AIRWAY_ID_PATTERN.fullmatch(identifier) is None:
        raise ValueError(
            f"{row.where}.id: {identifier!r} is not an airway identifier of one or two letters and one to three digits, e.g. R464, J1 or Q120"
        )
    airway = Airway(id=identifier, one_way=row.flag("one_way"), note=row.text("note"))
    row.finish()
    return airway


def _check_airways(airways: Sequence[Airway], where: str) -> None:
    seen: set[str] = set()
    for airway in airways:
        if airway.id in seen:
            raise ValueError(
                f"{where} airways[{airway.id}]: the identifier is already stated by an earlier row of this file; "
                "the engine reads an airway by its identifier, so a file states each one once"
            )
        seen.add(airway.id)


def load_airways(path: Path) -> tuple[Airway, ...]:
    """Load the airway rows every airport shares.

    The ``source`` block is checked for shape - it records where the directions were read from and
    when - and the ``airways`` rows are what the engine reads a filed route against. Nothing cites an
    airway row, so the source stays in the file rather than reaching the airport document.

    Args:
        path: Path to ``generator/shared/airways.yaml``.

    Returns:
        One row per airway, in file order.

    Raises:
        ValueError: The file is not a YAML mapping, carries an unknown key, holds an ``id`` that is
            no airway identifier, or states one identifier twice.
        OSError: The file is missing.
    """
    where = _where(path)
    root = _Row(where, _load_yaml_mapping(path, where))
    source = root.child("source")
    source.text("title")
    source.day("dated")
    source.finish()
    airways = tuple(_airway(child) for child in root.children("airways"))
    root.finish()
    _check_airways(airways, where)
    return airways


def _class_words(classes: Sequence[AircraftClass] | None) -> str:
    """Return the sheet's word for an aircraft-class set: ``props`` for P and T, ``all`` for none."""
    if classes is None:
        return "all"
    named = _COMMON_ARRIVAL_CLASS_WORDS.get(frozenset(classes))
    return named if named is not None else " and ".join(_AIRCRAFT_CLASS_WORDS[item] for item in classes)


def _listed(values: Sequence[str]) -> str:
    """Return ``A``, ``A or B`` or ``A, B or C``: the way the sheet reads a cell's entry fixes."""
    if len(values) < 2:
        return "".join(values)
    return f"{', '.join(values[:-1])} or {values[-1]}"


def _common_arrival_text(arrival: CommonArrival, note: str | None) -> str:
    """Return the sheet's cell in words, e.g. ``LAX jets: IRNMN# via BURGL or REBRG (west flow)``."""
    covered = ", ".join(icao.removeprefix("K") for icao in arrival.destinations)
    cargo = ", cargo aircraft" if arrival.cargo else ""
    text = f"{covered} {_class_words(arrival.classes)}{cargo}: {arrival.family}{SID_PLACEHOLDER} via {_listed(arrival.transitions)}"
    return text if note is None else f"{text} ({note})"


def _common_arrival(source: str, row: _Row) -> CommonArrival:
    destinations = row.texts("destinations")
    if not destinations:
        raise ValueError(f"{row.where}.destinations: no airport is named; a row states the destinations the sheet's cell covers")
    for icao in destinations:
        if _DESTINATION_CODE_PATTERN.fullmatch(icao) is None:
            raise ValueError(f"{row.where}.destinations: {icao!r} is not a four-character upper-case airport code, e.g. KLAX")
    classes = row.optional_choices_or_none("classes", AIRCRAFT_CLASSES)
    if classes is not None and len(set(classes)) != len(classes):
        raise ValueError(f"{row.where}.classes: {list(classes)} names a class twice; a row states each of P, T and J at most once")
    family = row.text("family")
    if _PROCEDURE_FAMILY_PATTERN.fullmatch(family) is None:
        raise ValueError(
            f"{row.where}.family: {family!r} is not an arrival family of three to five upper-case letters, e.g. IRNMN; state it without its revision"
        )
    transitions = row.texts("transitions")
    for transition in transitions:
        if _PROCEDURE_FAMILY_PATTERN.fullmatch(transition) is None:
            raise ValueError(f"{row.where}.transitions: {transition!r} is not a transition of three to five upper-case letters, e.g. BURGL or EHF")
    arrival = CommonArrival(
        id=f"CA-{destinations[0].removeprefix('K')}-{family}",
        source=source,
        text="",
        destinations=destinations,
        classes=classes,
        cargo=row.optional_flag("cargo", default=False) or False,
        family=family,
        transitions=transitions,
    )
    note = row.optional_text("note")
    row.finish()
    return replace(arrival, text=_common_arrival_text(arrival, note))


def _check_common_arrivals(arrivals: Sequence[CommonArrival], where: str) -> None:
    seen: set[str] = set()
    for arrival in arrivals:
        if arrival.id in seen:
            raise ValueError(
                f"{where} arrivals[{arrival.id}]: the identifier is already stated by an earlier row of this file; "
                "the engine cites an arrival row by its identifier, so a file states each family once per first destination"
            )
        seen.add(arrival.id)


def load_common_arrivals(path: Path) -> tuple[CommonArrival, ...]:
    """Load the common-arrival rows every airport shares.

    Each row is one cell of the ZOA sheet: which arrival of which destinations a flight is put on and
    at which entry fix. The rows keep the sheet's order, which is the order the engine tries them in.
    The row's ``id`` is derived as ``CA-<first destination without its leading K>-<family>`` and its
    ``text`` reads the cell back in words; ``note`` is for the reader of the file and is not carried.

    Args:
        path: Path to ``generator/shared/common_arrivals.yaml``.

    Returns:
        One row per cell, in file order, each carrying the file-level source title.

    Raises:
        ValueError: The file is not a YAML mapping, carries an unknown key, names no destination or
            one that is no four-character airport code, repeats an aircraft class, holds a ``family``
            or a transition that is no three-to-five-letter identifier, or derives one id twice.
        OSError: The file is missing.
    """
    where = _where(path)
    root = _Row(where, _load_yaml_mapping(path, where))
    source = root.child("source")
    title = source.text("title")
    source.day("dated")
    source.finish()
    arrivals = tuple(_common_arrival(title, child) for child in root.children("arrivals"))
    root.finish()
    _check_common_arrivals(arrivals, where)
    return arrivals


def _tec_source(row: _Row) -> TecSource:
    source = TecSource(title=row.text("title"), url=row.text("url"), transcribed_at=row.day("transcribed_at"))
    row.finish()
    return source


def _check_tec_altitudes(initial_feet: int | None, final_feet: int | None, where: str) -> None:
    if initial_feet is None:
        return
    if final_feet is None:
        raise ValueError(
            f"{where}: initial_altitude_feet {initial_feet} is stated without final_altitude_feet; "
            "state final_altitude_feet too; a blank final on the tool means final = initial"
        )
    if initial_feet > final_feet:
        raise ValueError(
            f"{where}: initial_altitude_feet {initial_feet} is above final_altitude_feet {final_feet}; "
            "the initial altitude is the one the route is issued with, so it is never above the final altitude"
        )


def _tec_route(row: _Row) -> TecRoute:
    kind = row.optional_choice("kind", TEC_ROUTE_KINDS)
    initial_feet = row.optional_number("initial_altitude_feet")
    final_feet = row.optional_number("final_altitude_feet")
    _check_tec_altitudes(initial_feet, final_feet, row.where)
    route = TecRoute(
        id=row.text("id"),
        kind=kind if kind is not None else "tec",
        destination=row.text("destination"),
        plan=row.text("plan"),
        runway_families=row.texts("runway_families"),
        classes=row.choices("classes", AIRCRAFT_CLASSES),
        route=row.text("route"),
        initial_altitude_feet=initial_feet,
        final_altitude_feet=final_feet,
    )
    row.finish()
    return route


def load_tec(path: Path) -> TecData:
    """Load and check one airport's ``tec.yaml``.

    Args:
        path: Path to the file.

    Returns:
        The transcribed TEC and ADR rows.

    Raises:
        ValueError: The file carries an unknown key, a route kind other than ``tec`` or ``adr``, an
            aircraft class outside P/T/J, or a row stating an initial altitude without a final one
            or above it.
        OSError: The file is missing.
    """
    where = _where(path)
    root = _Row(where, _load_yaml_mapping(path, where))
    data = TecData(source=_tec_source(root.child("source")), routes=tuple(_tec_route(child) for child in root.children("routes")))
    root.finish()
    return data


def _check_course(degrees: int, where: str) -> int:
    if not 0 <= degrees <= COURSE_DEGREES_MAX:
        raise ValueError(f"{where}: course {degrees} is not a magnetic course between 0 and {COURSE_DEGREES_MAX} degrees")
    return degrees


def _loa_route_classes(row: _Row) -> tuple[AircraftClass, ...] | None:
    classes = row.optional_choices_or_none("classes", AIRCRAFT_CLASSES)
    if classes is not None and not classes:
        raise ValueError(
            f"{row.where}.classes: the list is empty; a `route` rule states the classes it is written for, "
            "or leaves `classes` out to cover every class"
        )
    return classes


def _loa_rule_kind(kind: LoaRuleKindName, row: _Row) -> LoaRuleKind:
    if kind == "parity_rotated":
        return ParityRotatedRule(
            odd_course_from=_check_course(row.number("odd_course_from"), f"{row.where}.odd_course_from"),
            odd_course_to=_check_course(row.number("odd_course_to"), f"{row.where}.odd_course_to"),
        )
    if kind == "route":
        return RouteTokenRule(
            tokens=row.texts("tokens"),
            classes=_loa_route_classes(row),
            rnav_only=bool(row.optional_flag("rnav_only", default=False)),
        )
    return EvenAltitudeRule() if kind == "even" else OddAltitudeRule()


def _loa_effect(row: _Row) -> LoaRuleKind:
    effect = _loa_rule_kind(row.choice("kind", LOA_RULE_KIND_NAMES), row)
    row.finish()
    return effect


def _loa_departures(row: _Row) -> tuple[str, ...] | None:
    codes = row.optional_texts("departures")
    for index, code in enumerate(codes or ()):
        if _AIRPORT_ICAO_PATTERN.fullmatch(code) is None:
            raise ValueError(
                f"{row.where}.departures[{index}]: {code!r} is not a four-letter upper-case ICAO airport id, e.g. KOAK; "
                "`departures` lists the airports the rule applies to when they are the one being built"
            )
    return codes


def _loa_rule(row: _Row) -> LoaRule:
    rule = LoaRule(
        id=row.text("id"),
        source=row.text("source"),
        text=row.text("text"),
        artcc=row.optional_text("artcc"),
        destinations=row.optional_texts("destinations"),
        departures=_loa_departures(row),
        rule=_loa_effect(row.child("rule")),
    )
    row.finish()
    return rule


def _loa_data(path: Path) -> LoaData:
    """Read the rule rows of one LOA file."""
    where = _where(path)
    root = _Row(where, _load_yaml_mapping(path, where))
    data = LoaData(rules=tuple(_loa_rule(child) for child in root.children("rules")))
    root.finish()
    return data


def load_loa(path: Path) -> LoaData:
    """Load and check one airport's ``loa.yaml``, i.e. what it overrides by id or adds of its own.

    Args:
        path: Path to the file.

    Returns:
        The rule rows transcribed from the letters of agreement.

    Raises:
        ValueError: The file carries an unknown key, a rule kind the schema does not define, a
            rotated-parity course outside 0-359 degrees, or a malformed ``departures`` code.
        OSError: The file is missing.
    """
    return _loa_data(path)


def load_shared_loa_rules(path: Path) -> LoaData:
    """Load the inter-ARTCC letter-of-agreement rows every airport inherits.

    Args:
        path: Path to ``generator/shared/loa_rules.yaml``.

    Returns:
        The rule rows of the letters of agreement, in file order. An airport's own ``loa.yaml``
        overrides a row of the same id, and a row naming ``departures`` covers only those airports.

    Raises:
        ValueError: The file carries an unknown key, a rule kind the schema does not define, a
            rotated-parity course outside 0-359 degrees, or a malformed ``departures`` code.
        OSError: The file is missing.
    """
    return _loa_data(path)


def joined_loa_rules(shared: LoaData, airport: LoaData | None, icao: str) -> tuple[LoaRule, ...]:
    """Join the LOA rows every airport inherits with the rows one airport states itself.

    Args:
        shared: The inherited rows, in the order ``shared/loa_rules.yaml`` states them.
        airport: The rows the airport's own ``loa.yaml`` states, or ``None`` where it has no file.
        icao: The airport being built, which decides whether a row naming ``departures`` applies.

    Returns:
        The shared rows that cover ``icao``, in shared-file order, each replaced in place by the
        airport row of the same id where the airport states one, followed by the rows only the
        airport has, in its file order.
    """
    inherited = [rule for rule in shared.rules if rule.departures is None or icao in rule.departures]
    own = () if airport is None else airport.rules
    overrides = {rule.id: rule for rule in own}
    inherited_ids = {rule.id for rule in inherited}
    rules = [overrides.get(rule.id, rule) for rule in inherited]
    rules += [rule for rule in own if rule.id not in inherited_ids]
    return tuple(rules)


def _worksheet(row: _Row) -> Worksheet:
    worksheet = Worksheet(
        id=row.text("id"),
        title=row.text("title"),
        kind=row.choice("kind", WORKSHEET_KINDS),
        config=row.optional_text("config"),
        phraseology=row.optional_choice("phraseology", PHRASEOLOGY_READINGS),
    )
    row.finish()
    return worksheet


def _check_worksheets(worksheets: Sequence[Worksheet], where: str) -> None:
    for key, values in (("id", [sheet.id for sheet in worksheets]), ("title", [sheet.title for sheet in worksheets])):
        seen: set[str] = set()
        for value in values:
            if value in seen:
                raise ValueError(f"{where}: two worksheets share the {key} {value!r}; each sheet is fetched and named by it, so both must be unique")
            seen.add(value)


def _check_type_aliases(aliases: Mapping[str, str], where: str) -> None:
    for filed, read_as in aliases.items():
        at = f"{where} type_aliases[{filed}]"
        for label, designator in (("key", filed), ("value", read_as)):
            if _DESIGNATOR_PATTERN.fullmatch(designator) is None:
                raise ValueError(f"{at}: the {label} {designator!r} is not two to four upper-case letters or digits, e.g. A20N")
        if filed == read_as:
            raise ValueError(f"{at}: the alias reads {filed!r} as itself; list only the types the sheets file under a non-ICAO designator")


def load_worksheets(path: Path) -> WorksheetConfig:
    """Load one airport's ``worksheets.yaml``.

    Args:
        path: Path to the file.

    Returns:
        The trainer worksheets in file order and the aircraft type aliases the sheets file under.

    Raises:
        ValueError: The file is not a YAML mapping, carries an unknown key, names a sheet kind or a
            phraseology reading that does not exist, repeats a document id or title, or holds a type
            alias that is not a designator or that reads a type as itself.
        OSError: The file is missing.
    """
    where = _where(path)
    root = _Row(where, _load_yaml_mapping(path, where))
    aliases = root.optional_table("type_aliases")
    config = WorksheetConfig(
        worksheets=tuple(_worksheet(child) for child in root.children("worksheets")),
        type_aliases={} if aliases is None else _text_table(aliases, f"{where}.type_aliases"),
    )
    root.finish()
    _check_worksheets(config.worksheets, where)
    _check_type_aliases(config.type_aliases, where)
    return config


def _check_sid_families(sop: SopData, overrides: Overrides, where: str, overrides_where: str) -> None:
    known = sorted({sid_family_of(override.cifp_id, overrides_where) for override in overrides.sids.values()})
    wanted: list[tuple[str, str]] = [(rule.sid_family, f"assignment_rules[{rule.id}].sid_family") for rule in sop.assignment_rules if rule.sid_family]
    wanted += [(family, f"altitude_rules[{rule.id}].sid_families") for rule in sop.altitude_rules for family in rule.sid_families or ()]
    wanted += [(notice.effect.sid_family, f"notices[{notice.id}].effect.sid_family") for notice in sop.notices]
    for family, at in wanted:
        if family not in known:
            raise ValueError(
                f"{where} {at}: DP family {family!r} has no procedure in {overrides_where}; "
                f"add a chart there whose cifp_id is that family plus a version, or fix the family. Known families: {known}"
            )


def _check_route_exit_fixes(sop: SopData, routes: RouteLibrary, where: str, routes_where: str) -> None:
    gate_fixes = {fix for _, fixes in _gate_items(sop.gates) for fix in fixes}
    for route in routes.routes:
        if route.exit_fix not in gate_fixes:
            raise ValueError(
                f"{routes_where} routes[{route.exit_fix} -> {route.destination}]: exit_fix {route.exit_fix!r} is in no gate of {where}; "
                "add it to gates.north, gates.south or gates.oceanic so the engine can resolve its direction"
            )


@dataclass(frozen=True, slots=True)
class _Known:
    """The names ``sop.yaml``, ``overrides.yaml`` and ``routes.yaml`` define, as the TEC and LOA rows cite them."""

    destinations: frozenset[str]
    plans: frozenset[str]
    runway_families: tuple[str, ...]
    sid_families: frozenset[str]


def _known_names(sop: SopData, overrides: Overrides, routes: RouteLibrary, overrides_where: str) -> _Known:
    return _Known(
        destinations=frozenset(destination.icao for destination in routes.destinations),
        plans=frozenset(config.plan for config in sop.runway_configs),
        runway_families=_runway_families(sop.runways),
        sid_families=frozenset(sid_family_of(override.cifp_id, overrides_where) for override in overrides.sids.values()),
    )


def _check_destination(destination: str, known: _Known, at: str) -> None:
    if destination not in known.destinations:
        raise ValueError(f"{at}: destination {destination!r} is in no `destinations` row of {ROUTES_FILE}; add it there first")


def _check_tec_route_families(route: TecRoute, known: _Known, at: str) -> None:
    for token in route.route.split():
        if not token.endswith(SID_PLACEHOLDER):
            continue
        family = token.removesuffix(SID_PLACEHOLDER)
        if family not in known.sid_families:
            raise ValueError(
                f"{at}: route names DP family {family!r}, which has no procedure in {OVERRIDES_FILE}; "
                f"add a chart there whose cifp_id is that family plus a version, or fix the family. "
                f"Known families: {sorted(known.sid_families)}"
            )


def _check_tec(tec: TecData, known: _Known, where: str) -> None:
    for route in tec.routes:
        at = f"{where} routes[{route.id}]"
        _check_destination(route.destination, known, at)
        if route.plan not in known.plans:
            raise ValueError(f"{at}: plan {route.plan!r} is no `runway_configs` plan of {SOP_FILE}; use one of {sorted(known.plans)}")
        _check_runway_families(route.runway_families, known.runway_families, at)
        _check_tec_route_families(route, known, at)


def _optional_tec(path: Path, known: _Known) -> TecData | None:
    if not path.is_file():
        return None
    tec = load_tec(path)
    _check_tec(tec, known, _where(path))
    return tec


def _joined_loa(directory: Path, shared: SharedRouteFacts, icao: str) -> LoaData:
    """Join the shared LOA rows this airport inherits with its own ``loa.yaml`` and check them.

    An LOA row covers an arrival stream whatever airport is being built, so its destinations are held
    against the shared destinations table rather than against the airport's own ``routes.yaml``: a
    letter names fields no scenario of this airport files to.

    Args:
        directory: The airport directory, which carries a ``loa.yaml`` only where it overrides or
            adds a row.
        shared: The shared facts, whose ``loa`` holds the inherited rows and whose ``destinations``
            hold every field a row may name.
        icao: The airport being built, which decides whether a row naming ``departures`` applies.

    Returns:
        The joined rules.

    Raises:
        ValueError: A row names a destination ``shared/destinations.yaml`` does not hold, or the
            airport's own file fails its own checks.
    """
    path = directory / LOA_FILE
    airport = load_loa(path) if path.is_file() else None
    loa = LoaData(rules=joined_loa_rules(shared.loa, airport, icao))
    own = {rule.id for rule in airport.rules} if airport is not None else set()
    for rule in loa.rules:
        where = _where(path) if rule.id in own else f"shared/{LOA_RULES_FILE}"
        for destination in rule.destinations or ():
            if destination not in shared.destinations:
                raise ValueError(
                    f"{where} rules[{rule.id}]: destination {destination!r} is in no `destinations` row of "
                    f"shared/{DESTINATIONS_FILE}; add it there first"
                )
    return loa


def load_airport(directory: Path, shared: SharedRouteFacts) -> AirportInputs:
    """Load the YAML files of one airport and check them against each other.

    ``sop.yaml``, ``overrides.yaml`` and ``routes.yaml`` are required; ``tec.yaml`` and ``loa.yaml``
    are loaded when the directory holds them. The LOA rows of ``shared`` that cover this airport are
    joined with its own ``loa.yaml`` and checked together.

    Args:
        directory: The airport directory, e.g. ``generator/airports/ksfo``.
        shared: The destination, airline and aircraft-type tables ``routes.yaml`` lists codes into,
            the inherited LOA rows, the shared airways and the shared common arrivals, from
            :func:`load_shared_route_facts`.

    Returns:
        The loaded and cross-checked inputs.

    Raises:
        ValueError: Any file fails its own checks, a rule names a DP family no override declares, a
            route leaves the DP at a fix that belongs to no gate, a TEC row names a destination, a
            plan, a runway family or a DP family the other files do not define, or an LOA row names a
            destination ``shared/destinations.yaml`` does not hold.
        OSError: One of the three required files is missing.
    """
    sop_path = directory / SOP_FILE
    overrides_path = directory / OVERRIDES_FILE
    routes_path = directory / ROUTES_FILE
    sop = load_sop(sop_path)
    overrides = load_overrides(overrides_path)
    routes = load_routes(routes_path, shared)
    _check_sid_families(sop, overrides, _where(sop_path), _where(overrides_path))
    _check_route_exit_fixes(sop, routes, _where(sop_path), _where(routes_path))
    known = _known_names(sop, overrides, routes, _where(overrides_path))
    return AirportInputs(
        icao=sop.airport.icao,
        sop=sop,
        overrides=overrides,
        routes=routes,
        tec=_optional_tec(directory / TEC_FILE, known),
        loa=_joined_loa(directory, shared, sop.airport.icao),
        airways=shared.airways,
        common_arrivals=shared.common_arrivals,
    )
