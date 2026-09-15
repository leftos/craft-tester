"""Strict loading and cross-reference checking of the hand-authored airport YAML.

Strict in both directions. An unknown key anywhere is a :class:`ValueError`, so a mistyped key
cannot silently drop a rule row or a condition the game then never applies; and every reference one
row makes to another - a sector, a runway configuration, a noise window, a DP family, a runway, a
gate fix, a destination - is resolved while loading, so a broken reference fails the build instead
of the clearance. Every message names the file, the row id and the key it came from.

The three files are loaded separately (:func:`load_sop`, :func:`load_overrides`, :func:`load_routes`),
each checking what it can see on its own; :func:`load_airport` loads all three and adds the checks
that span files.
"""

import re
from collections.abc import Iterator, Mapping, Sequence
from datetime import date
from pathlib import Path
from typing import Any

import yaml

from craft_generator.sop.model import (
    AIRCRAFT_CLASSES,
    ALTITUDE_OUTCOME_KINDS,
    DEPARTURE_SID_KINDS,
    DIRECTIONS,
    EXPECT_ALTITUDE_POLICIES,
    GATE_DIRECTIONS,
    NOTICE_EFFECT_KINDS,
    ROUTE_PHRASINGS,
    TOP_ALTITUDE_KINDS,
    WAKE_CATEGORIES,
    AirportInfo,
    AirportInputs,
    AltitudeOutcome,
    AltitudeRule,
    AssignmentCondition,
    AssignmentRule,
    DepartureRunway,
    DepartureSector,
    Destination,
    FleetEntry,
    FrequencyOption,
    GateDirection,
    Gates,
    NoiseWindow,
    NoSid,
    Notice,
    NoticeEffect,
    Overrides,
    Phraseology,
    PhraseologyRule,
    RouteEntry,
    RouteLibrary,
    RunwayConfig,
    SecondarySource,
    SidOverride,
    SidTopAltitude,
    SopData,
    SopSource,
)

SOP_FILE = "sop.yaml"
OVERRIDES_FILE = "overrides.yaml"
ROUTES_FILE = "routes.yaml"

RUNWAY_FAMILY_LENGTH = 2

_SUFFIX_PATTERN = re.compile(r"^/[A-Z]$")
_CIFP_ID_PATTERN = re.compile(r"^(?P<family>[A-Z]+)\d+$")


def airports_dir() -> Path:
    """Return the directory holding one subdirectory of hand-authored YAML per airport."""
    return Path(__file__).resolve().parents[3] / "airports"


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


def _departure_runway(row: _Row) -> DepartureRunway:
    runway = DepartureRunway(runway=row.text("runway"), classes=row.choices("classes", AIRCRAFT_CLASSES), note=row.optional_text("note"))
    row.finish()
    return runway


def _runway_config(row: _Row) -> RunwayConfig:
    config = RunwayConfig(
        id=row.text("id"),
        name=row.text("name"),
        plan=row.text("plan"),
        arrival_runways=row.texts("arrival_runways"),
        departure_runways=tuple(_departure_runway(child) for child in row.children("departure_runways")),
    )
    row.finish()
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
    )
    row.finish()
    return condition


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
        sid_family=row.optional_text("sid_family"),
        non_dp_heading=row.optional_text("non_dp_heading"),
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
        sid_families=row.optional_texts("sid_families"),
        outcome=_altitude_outcome(row.child("outcome")),
        when_top_altitude_published=row.choice("when_top_altitude_published", ALTITUDE_OUTCOME_KINDS),
        expect_after_minutes=row.number("expect_after_minutes"),
    )
    row.finish()
    return rule


def _notice_effect(row: _Row) -> NoticeEffect:
    effect = NoticeEffect(kind=row.choice("kind", NOTICE_EFFECT_KINDS), sid_family=row.text("sid_family"))
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


def _check_assignment_rule(rule: AssignmentRule, where: str, sop: SopData, families: Sequence[str]) -> None:
    at = f"{where} assignment_rules[{rule.id}]"
    _check_runway_families(rule.runway_families, families, at)
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


def _check_sop(sop: SopData, where: str) -> None:
    families = _runway_families(sop.runways)
    for rule in sop.assignment_rules:
        _check_assignment_rule(rule, where, sop, families)
    for altitude_rule in sop.altitude_rules:
        _check_runway_families(altitude_rule.runway_families, families, f"{where} altitude_rules[{altitude_rule.id}]")
    _check_runway_families(sop.no_sid.runway_families, families, f"{where} no_sid")
    _check_direction_runway_preference(sop, where, families)
    _check_gates(sop.gates, where)


def load_sop(path: Path) -> SopData:
    """Load and check one airport's ``sop.yaml``.

    Args:
        path: Path to the file.

    Returns:
        The transcribed SOP.

    Raises:
        ValueError: The file is not a YAML mapping, carries an unknown or mistyped key, or holds a
            rule whose sector, runway configuration, noise window or runway family does not exist.
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
        note=row.optional_text("note"),
    )
    row.finish()
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
        ValueError: The file carries an unknown key, a malformed ``cifp_id``, or two charts claiming
            the same procedure id.
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


def _destination(row: _Row) -> Destination:
    destination = Destination(
        icao=row.text("icao"),
        spoken=row.text("spoken"),
        artcc=row.text("artcc"),
        nct=bool(row.optional_flag("nct", default=False)),
        lat=row.optional_decimal("lat"),
        lon=row.optional_decimal("lon"),
    )
    row.finish()
    return destination


def _fleet_entry(row: _Row) -> FleetEntry:
    entry = FleetEntry(
        type=row.text("type"),
        aircraft_class=row.choice("class", AIRCRAFT_CLASSES),
        wtc=row.choice("wtc", WAKE_CATEGORIES),
        ceiling_feet=row.number("ceiling_feet"),
        suffixes=row.texts("suffixes"),
        airlines=row.texts("airlines"),
    )
    row.finish()
    for suffix in entry.suffixes:
        if _SUFFIX_PATTERN.fullmatch(suffix) is None:
            raise ValueError(f"{row.where}: suffix {suffix!r} is not a slash and one upper-case letter, e.g. /L; see FAA JO 7110.65 table 5-4-1")
    return entry


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


def load_routes(path: Path) -> RouteLibrary:
    """Load and check one airport's ``routes.yaml``.

    Args:
        path: Path to the file.

    Returns:
        The destinations, fleet and filed routes.

    Raises:
        ValueError: The file carries an unknown key, a malformed equipment suffix, an aircraft class
            outside P/T/J, or a route filed to a destination the file does not list.
    """
    where = _where(path)
    root = _Row(where, _load_yaml_mapping(path, where))
    routes = RouteLibrary(
        destinations=tuple(_destination(child) for child in root.children("destinations")),
        fleet=tuple(_fleet_entry(child) for child in root.children("fleet")),
        routes=tuple(_route_entry(child) for child in root.children("routes")),
    )
    root.finish()
    _check_routes(routes, where)
    return routes


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


def load_airport(directory: Path) -> AirportInputs:
    """Load the three YAML files of one airport and check them against each other.

    Args:
        directory: The airport directory, e.g. ``generator/airports/ksfo``.

    Returns:
        The loaded and cross-checked inputs.

    Raises:
        ValueError: Any file fails its own checks, a rule names a DP family no override declares, or
            a route leaves the DP at a fix that belongs to no gate.
        OSError: One of the three files is missing.
    """
    sop_path = directory / SOP_FILE
    overrides_path = directory / OVERRIDES_FILE
    routes_path = directory / ROUTES_FILE
    sop = load_sop(sop_path)
    overrides = load_overrides(overrides_path)
    routes = load_routes(routes_path)
    _check_sid_families(sop, overrides, _where(sop_path), _where(overrides_path))
    _check_route_exit_fixes(sop, routes, _where(sop_path), _where(routes_path))
    return AirportInputs(icao=sop.airport.icao, sop=sop, overrides=overrides, routes=routes)
