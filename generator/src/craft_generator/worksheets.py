"""Trainer worksheet text from Google Docs into pending fixtures.

The S1-SFO-1 module publishes its clearance worksheets as public Google Docs, and
``https://docs.google.com/document/d/<id>/export?format=txt`` returns each one as plain text with no
authentication. Two shapes come back. A *phraseology* sheet is a flight-plan form flattened to one
cell per line, so a plan is the block after ``Flight Plan - <CALLSIGN>`` and every value sits on the
first non-empty line after its label; the form's buttons (``Amend Plan``, ``Plot`` and friends) land
in the text as well and are skipped by name. An *amendment* sheet is a five-column table, again one
cell per line, so the rows are the cells after the ``Callsign | Type | Dest. | Altitude | Route``
header taken five at a time.

The sheets carry flight plans only - no answer keys - so every fixture is written ``pending`` and
without ``expected``: the clearance half comes from the rules engine and is confirmed by the user in
the validation loop (see ``docs/ARCHITECTURE.md``, fixture lifecycle). A fixture the user has
settled is never overwritten by a later import; :func:`settled_fixture_at` is the guard. Two scenario fields the
worksheets do not state are filled here and recorded in ``source.note``: the departure runway, which
is the one the configuration defaults the plan's aircraft class to (``default_for_classes`` in
``sop.yaml``), else the one the plan is taken to have requested (``on_request_for``), else the one
the direction the filed route leaves on prefers (``direction_runway_preference``), and falls back to
the first runway the configuration publishes; and - on the amendment sheets, which print no squawk -
a code counted up from 4601 in octal.

The request step is SOP 2-1 e: oceanic, Far East and cargo flights need the 28s for performance and
may be given them while runway 01 is the advertised departure runway. A sheet prints no request, so
the importer reads one off the flight plan - a cargo, heavy or oceanic flight that filed a procedure
published for that runway family alone is asking for it.
"""

import json
import re
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from craft_generator.aircraft_classes import DESIGNATOR_FIELD, ENGINE_TYPE_FIELD, classify_engine_type
from craft_generator.emit import repo_root
from craft_generator.http import fetch_bytes
from craft_generator.sop.load import RUNWAY_FAMILY_LENGTH
from craft_generator.sop.model import (
    AircraftClass,
    DepartureRunway,
    EquipmentSuffix,
    GateDirection,
    Gates,
    OnRequestKind,
    RunwayConfig,
    SopData,
    Worksheet,
)

Fixture = dict[str, Any]

EXPORT_URL = "https://docs.google.com/document/d/{document_id}/export?format=txt"

LOCAL_TIME = "1400"
DAY_OF_WEEK = "tuesday"
SETTLED_STATUS = "settled"
FIRST_SQUAWK = 0o4601
TRUNCATION_MARKER = "(continued)"

PLAN_HEADING = "Flight Plan -"
AMENDMENT_HEADER = ("Callsign", "Type", "Dest.", "Altitude", "Route")
AMENDMENT_COLUMNS = len(AMENDMENT_HEADER)

CALLSIGN_LABEL = "Callsign:"
TYPE_LABEL = "A/C Type:"
DEPART_LABEL = "Depart:"
ARRIVE_LABEL = "Arrive:"
CRUISE_LABEL = "Cruise Alt:"
SQUAWK_LABEL = "Squawk:"
ROUTE_LABEL = "Route:"

PLAN_LABELS = (
    CALLSIGN_LABEL,
    TYPE_LABEL,
    "Flight Rules:",
    DEPART_LABEL,
    ARRIVE_LABEL,
    "Alternate:",
    CRUISE_LABEL,
    "Scratchpad:",
    SQUAWK_LABEL,
    ROUTE_LABEL,
    "Remarks:",
)
REQUIRED_LABELS = (CALLSIGN_LABEL, TYPE_LABEL, DEPART_LABEL, ARRIVE_LABEL, CRUISE_LABEL, SQUAWK_LABEL, ROUTE_LABEL)
FORM_BUTTONS = frozenset({"Amend Plan", "Refresh Plan", "Assign Squawk", "Plot"})

WTC_FIELD = "WTC"
HEAVY_WAKE_CATEGORY = "H"

_TYPE_PATTERN = re.compile(r"^(?:(?P<weight>[HJ])/)?(?P<designator>[A-Z0-9]{2,4})(?:/(?P<suffix>[A-Z]))?$")
_AIRLINE_CALLSIGN = re.compile(r"^(?P<code>[A-Z]{3})\d")
_SID_TOKEN = re.compile(r"^[A-Z]{3,5}\d$")
_AIRWAY_TOKEN = re.compile(r"^[JVQT]\d+$")
_SQUAWK_PATTERN = re.compile(r"^[0-7]{4}$")
_FLIGHT_LEVEL_PATTERN = re.compile(r"^FL(?P<hundreds>\d{2,3})$")
_SLUG_PATTERN = re.compile(r"[^a-z0-9]+")

_FEET_PER_FLIGHT_LEVEL = 100


@dataclass(frozen=True, slots=True)
class PlanRow:
    """One filed flight plan as a worksheet prints it."""

    callsign: str
    designator: str
    suffix: str | None
    departure: str | None
    destination: str
    altitude_feet: int
    squawk: str | None
    route: str
    truncated: bool


def export_url(document_id: str) -> str:
    """Return the plain-text export URL of a Google Doc.

    Args:
        document_id: The document id out of ``worksheets.yaml``.

    Returns:
        The URL the text is fetched from.
    """
    return EXPORT_URL.format(document_id=document_id)


def worksheet_cache_path(cache: Path, worksheet: Worksheet) -> Path:
    """Return the cache file one worksheet's exported text is downloaded to.

    Args:
        cache: Download cache directory.
        worksheet: The worksheet row.

    Returns:
        The path under ``cache/worksheets/``.
    """
    return cache / "worksheets" / f"{worksheet.id}.txt"


def fetch_worksheet_text(worksheet: Worksheet, cache: Path, *, force: bool = False) -> str:
    """Fetch one worksheet's exported text through the download cache.

    Args:
        worksheet: The worksheet row.
        cache: Download cache directory, normally :func:`craft_generator.http.cache_dir`.
        force: Re-download even when the cache already holds the text.

    Returns:
        The exported text, without the byte-order mark Google Docs prefixes it with.

    Raises:
        RuntimeError: The download failed.
    """
    return fetch_bytes(export_url(worksheet.id), worksheet_cache_path(cache, worksheet), force=force).decode("utf-8-sig")


def slug(title: str) -> str:
    """Return the file-name form of a worksheet title, e.g. ``amendment-practice-1a``.

    Args:
        title: The title as ``worksheets.yaml`` states it.

    Returns:
        The lower-case title with every run of non-alphanumeric characters replaced by one dash.

    Raises:
        ValueError: The title holds no letter or digit, so it names no file.
    """
    name = _SLUG_PATTERN.sub("-", title.lower()).strip("-")
    if not name:
        raise ValueError(f"worksheet title {title!r} has no letter or digit, so it names no fixture file; give the sheet a title")
    return name


def parse_aircraft_type(value: str, where: str) -> tuple[str, str | None]:
    """Split a filed aircraft type into its ICAO designator and equipment suffix.

    A heavy or super weight prefix (``H/``, ``J/``) is dropped, because the fixture records the
    designator the aircraft classes are keyed by; the suffix is returned with its slash, or ``None``
    when the plan files none.

    Args:
        value: The type as the worksheet prints it, e.g. ``A320/L``, ``H/A306/L`` or ``E135``.
        where: The sheet and row the value came from, used in the error message.

    Returns:
        The bare designator and the suffix.

    Raises:
        ValueError: The value is not an optional weight prefix, a designator and an optional suffix.
    """
    match = _TYPE_PATTERN.fullmatch(value.strip())
    if match is None:
        raise ValueError(f"{where}: aircraft type {value!r} is not a designator with an optional H//J/ weight prefix and /X equipment suffix")
    suffix = match.group("suffix")
    return match.group("designator"), None if suffix is None else f"/{suffix}"


def parse_altitude(value: str, where: str) -> int:
    """Return a filed cruise altitude in feet.

    Args:
        value: The altitude as the worksheet prints it, e.g. ``FL320`` or ``5000``.
        where: The sheet and row the value came from, used in the error message.

    Returns:
        The altitude in feet.

    Raises:
        ValueError: The value is neither a flight level nor a positive number of feet.
    """
    text = value.strip()
    level = _FLIGHT_LEVEL_PATTERN.fullmatch(text)
    if level is not None:
        return int(level.group("hundreds")) * _FEET_PER_FLIGHT_LEVEL
    if text.isdigit() and int(text) > 0:
        return int(text)
    raise ValueError(f"{where}: cruise altitude {value!r} is neither a flight level such as FL320 nor a number of feet such as 5000")


def _squawk(value: str, where: str) -> str:
    text = value.strip()
    if _SQUAWK_PATTERN.fullmatch(text) is None:
        raise ValueError(f"{where}: squawk {value!r} is not four octal digits")
    return text


def _plan_row(fields: dict[str, str], where: str) -> PlanRow:
    missing = [label for label in REQUIRED_LABELS if not fields.get(label)]
    if missing:
        raise ValueError(f"{where}: the flight plan states no {missing}; the text export of the sheet may have changed shape")
    designator, suffix = parse_aircraft_type(fields[TYPE_LABEL], where)
    route = fields[ROUTE_LABEL]
    return PlanRow(
        callsign=fields[CALLSIGN_LABEL],
        designator=designator,
        suffix=suffix,
        departure=fields[DEPART_LABEL],
        destination=fields[ARRIVE_LABEL],
        altitude_feet=parse_altitude(fields[CRUISE_LABEL], where),
        squawk=_squawk(fields[SQUAWK_LABEL], where),
        route=route,
        truncated=route.endswith(TRUNCATION_MARKER),
    )


def _cells(text: str) -> list[str]:
    return [stripped for line in text.lstrip("﻿").splitlines() if (stripped := line.strip())]


def _plan_blocks(cells: Sequence[str]) -> Iterator[tuple[str, list[str]]]:
    heading: str | None = None
    block: list[str] = []
    for cell in cells:
        if cell.startswith(PLAN_HEADING):
            if heading is not None:
                yield heading, block
            heading, block = cell.removeprefix(PLAN_HEADING).strip(), []
            continue
        if heading is not None:
            block.append(cell)
    if heading is not None:
        yield heading, block


def _plan_fields(block: Sequence[str]) -> dict[str, str]:
    fields: dict[str, str] = {}
    label: str | None = None
    for cell in block:
        if cell.endswith(":"):
            label = cell if cell in PLAN_LABELS else None
            continue
        if label is not None and cell not in FORM_BUTTONS:
            fields.setdefault(label, cell)
    return fields


def parse_phraseology_sheet(text: str, where: str) -> list[PlanRow]:
    """Read the flight plans off a phraseology worksheet.

    Args:
        text: The document's exported text.
        where: The sheet's title, used in the error messages.

    Returns:
        One row per ``Flight Plan - <CALLSIGN>`` block, in sheet order.

    Raises:
        ValueError: The sheet holds no flight plan, a block is missing a field the fixture needs, or
            a value is not the type, altitude or squawk it should be.
    """
    rows: list[PlanRow] = []
    for callsign, block in _plan_blocks(_cells(text)):
        at = f"{where} [{callsign}]"
        row = _plan_row(_plan_fields(block), at)
        if row.callsign != callsign:
            raise ValueError(f"{at}: the block is headed {callsign!r} but its Callsign field reads {row.callsign!r}")
        rows.append(row)
    if not rows:
        raise ValueError(f"{where}: the text holds no {PLAN_HEADING!r} block; the sheet may no longer be a flight-plan form")
    return rows


def _header_end(cells: Sequence[str], where: str) -> int:
    for index in range(len(cells) - AMENDMENT_COLUMNS + 1):
        if tuple(cells[index : index + AMENDMENT_COLUMNS]) == AMENDMENT_HEADER:
            return index + AMENDMENT_COLUMNS
    raise ValueError(f"{where}: the text holds no {' | '.join(AMENDMENT_HEADER)} header row; the sheet may no longer be an amendment table")


def _amendment_row(cells: Sequence[str], where: str) -> PlanRow:
    callsign, aircraft_type, destination, altitude, route = cells
    at = f"{where} [{callsign}]"
    designator, suffix = parse_aircraft_type(aircraft_type, at)
    return PlanRow(
        callsign=callsign,
        designator=designator,
        suffix=suffix,
        departure=None,
        destination=destination,
        altitude_feet=parse_altitude(altitude, at),
        squawk=None,
        route=route,
        truncated=route.endswith(TRUNCATION_MARKER),
    )


def parse_amendment_sheet(text: str, where: str) -> list[PlanRow]:
    """Read the flight plans off an amendment worksheet.

    Args:
        text: The document's exported text.
        where: The sheet's title, used in the error messages.

    Returns:
        One row per table row after the header, in sheet order. A row whose route is cut off in the
        document keeps the printed text and is flagged ``truncated``.

    Raises:
        ValueError: The header row is missing, the cells after it do not divide into whole rows, or
            a value is not the type or altitude it should be.
    """
    cells = _cells(text)
    body = cells[_header_end(cells, where) :]
    if not body or len(body) % AMENDMENT_COLUMNS:
        leftover = body[len(body) - len(body) % AMENDMENT_COLUMNS :] if body else []
        raise ValueError(
            f"{where}: the table holds {len(body)} cell(s) after the header, which is not a whole number of "
            f"{AMENDMENT_COLUMNS}-cell rows; the cells the last row is short of are {leftover}"
        )
    return [_amendment_row(body[start : start + AMENDMENT_COLUMNS], where) for start in range(0, len(body), AMENDMENT_COLUMNS)]


def parse_worksheet(worksheet: Worksheet, text: str) -> list[PlanRow]:
    """Read the flight plans off a worksheet, with the parser its ``kind`` names.

    Args:
        worksheet: The worksheet row out of ``worksheets.yaml``.
        text: The document's exported text.

    Returns:
        One row per flight plan, in sheet order.

    Raises:
        ValueError: The text does not have the shape the sheet's kind promises.
    """
    if worksheet.kind == "phraseology":
        return parse_phraseology_sheet(text, worksheet.title)
    return parse_amendment_sheet(text, worksheet.title)


def rnav_suffixes(suffixes: Sequence[EquipmentSuffix]) -> frozenset[str]:
    """Return the equipment suffixes that make an aircraft RNAV capable.

    Args:
        suffixes: The rows of ``shared/equipment_suffixes.yaml``.

    Returns:
        The suffixes whose row sets ``rnav``.
    """
    return frozenset(entry.suffix for entry in suffixes if entry.rnav)


def designator_classes(specs: Sequence[Mapping[str, Any]], type_aliases: Mapping[str, str]) -> dict[str, AircraftClass]:
    """Map every designator a sheet may file to the SOP aircraft class of its vNAS record.

    The map is keyed by the designator as a sheet files it, so a type the sheets spell their own way
    carries the class of the designator ``type_aliases`` reads it as. A record whose ``EngineType``
    the SOP has no class for - the electric and rocket types of the file - is left out, because the
    importer has nothing to do with one and treats it as a type the specs do not cover.

    Args:
        specs: The records from :func:`craft_generator.aircraft_classes.fetch_aircraft_specs`.
        type_aliases: The aircraft type aliases out of ``worksheets.yaml``.

    Returns:
        The aircraft class of each designator, keyed by ICAO designator.
    """
    classes: dict[str, AircraftClass] = {}
    for record in specs:
        designator = record.get(DESIGNATOR_FIELD)
        engine_type = record.get(ENGINE_TYPE_FIELD)
        if not isinstance(designator, str) or not isinstance(engine_type, str) or designator in classes:
            continue
        try:
            classes[designator] = classify_engine_type(engine_type)
        except ValueError:
            continue
    for filed, read_as in type_aliases.items():
        aircraft_class = classes.get(read_as)
        if aircraft_class is not None:
            classes[filed] = aircraft_class
    return classes


def designator_wtcs(specs: Sequence[Mapping[str, Any]], type_aliases: Mapping[str, str]) -> dict[str, str]:
    """Map every designator a sheet may file to the wake turbulence category of its vNAS record.

    The map is keyed the way :func:`designator_classes` keys its own, so a type the sheets spell
    their own way carries the category of the designator ``type_aliases`` reads it as. The category
    is what makes a plan a heavy: the sheets print the ``H/`` prefix, but the fixture records the
    bare designator, so the weight of a plan is read from the specs rather than from the sheet.

    Args:
        specs: The records from :func:`craft_generator.aircraft_classes.fetch_aircraft_specs`.
        type_aliases: The aircraft type aliases out of ``worksheets.yaml``.

    Returns:
        The wake turbulence category of each designator, e.g. ``H`` for ``A306``, keyed by ICAO
        designator.
    """
    categories: dict[str, str] = {}
    for record in specs:
        designator = record.get(DESIGNATOR_FIELD)
        category = record.get(WTC_FIELD)
        if isinstance(designator, str) and isinstance(category, str) and designator not in categories:
            categories[designator] = category
    for filed, read_as in type_aliases.items():
        category = categories.get(read_as)
        if category is not None:
            categories[filed] = category
    return categories


@dataclass(frozen=True, slots=True)
class OnRequestRequest:
    """The request a plan is read as making: the kind of flight it is and the procedure it filed."""

    kind: OnRequestKind
    sid: str
    family: str


@dataclass(frozen=True, slots=True)
class RunwayChoice:
    """The departure runway one plan's fixture carries and what chose it.

    ``default_for_class`` is set when the class default chose the runway, ``on_request`` when the
    plan asked for it, and ``direction`` when the direction preference chose it - which the request
    leaves in place, because the preference is what splits the requested family into one runway. All
    three are ``None`` on the fallback to the configuration's first departure runway.
    ``unclassified_designator`` names the filed type when the vNAS specs do not cover it, so the
    class and request steps were skipped.
    """

    config_id: str
    runway: str
    direction: GateDirection | None
    default_for_class: AircraftClass | None = None
    unclassified_designator: str | None = None
    on_request: OnRequestRequest | None = None


def sheet_runway_config(config_id: str | None, configs: Sequence[RunwayConfig], where: str) -> RunwayConfig:
    """Return the runway configuration the fixtures of one sheet carry.

    Args:
        config_id: The ``runway_configs`` id the sheet declares, or ``None``.
        configs: The runway configurations out of ``sop.yaml``.
        where: The sheet's title, used in the error messages.

    Returns:
        The configuration.

    Raises:
        ValueError: The sheet declares no configuration, names one ``sop.yaml`` does not have, or
            names one with no departure runway.
    """
    if config_id is None:
        known = [config.id for config in configs]
        raise ValueError(f"{where}: the sheet declares no `config`, so its fixtures have no runway configuration; state one of {known}")
    config = next((entry for entry in configs if entry.id == config_id), None)
    if config is None:
        raise ValueError(f"{where}: config {config_id!r} is not a `runway_configs` id in sop.yaml; use one of {[entry.id for entry in configs]}")
    if not config.departure_runways:
        raise ValueError(f"{where}: runway configuration {config_id!r} publishes no departure runway, so its fixtures have none")
    return config


def filed_sid_token(route: str) -> str | None:
    """Return the procedure a filed route names first, whether or not it is the assigned one.

    Args:
        route: The route as the sheet files it, e.g. ``WESLA5 NTELL``.

    Returns:
        The leading procedure token, or ``None`` when the route opens with a fix or an airway.
    """
    tokens = route.split()
    if not tokens or _SID_TOKEN.fullmatch(tokens[0]) is None or _AIRWAY_TOKEN.fullmatch(tokens[0]) is not None:
        return None
    return tokens[0]


def exit_fix(route: str, faa: str) -> str | None:
    """Return the fix a filed route leaves the terminal on, as ``web/src/rules/route.ts`` reads it.

    A leading procedure token is dropped whether or not it is the procedure the flight will get, and
    the airport's own navaid is skipped where it is filed next, e.g. ``SFO`` in ``WESLA5 SFO SUSEY``.

    Args:
        route: The route as the sheet files it.
        faa: The airport's FAA identifier, e.g. ``SFO``.

    Returns:
        The first token that is neither the procedure nor the airport navaid, or ``None`` when the
        route holds no such token.
    """
    tokens = route.split()
    if filed_sid_token(route) is not None:
        tokens = tokens[1:]
    if tokens and tokens[0] == faa:
        tokens = tokens[1:]
    return tokens[0] if tokens else None


def _gate_direction(fix: str | None, gates: Gates) -> GateDirection | None:
    if fix is None:
        return None
    for direction, fixes in (("north", gates.north), ("south", gates.south), ("oceanic", gates.oceanic)):
        if fix in fixes:
            return direction
    return None


def _class_default(aircraft_class: AircraftClass, config: RunwayConfig) -> str | None:
    for runway in config.departure_runways:
        if aircraft_class in runway.default_for_classes:
            return runway.runway
    return None


def _preferred_runway(sop: SopData, config: RunwayConfig, family: str, direction: GateDirection | None) -> str | None:
    if direction is None:
        return None
    return sop.direction_runway_preference.get(config.plan, {}).get(direction, {}).get(family)


def flight_kinds(
    row: PlanRow, direction: GateDirection | None, *, cargo_airlines: Sequence[str], wake_categories: Mapping[str, str]
) -> tuple[OnRequestKind, ...]:
    """Return the kinds of flight one filed plan is, as ``on_request_for`` in ``sop.yaml`` names them.

    Args:
        row: The filed plan.
        direction: The gate direction the filed route leaves on, or ``None`` when its exit fix
            belongs to no gate.
        cargo_airlines: The ICAO codes of the all-cargo airlines, out of ``routes.yaml``.
        wake_categories: The wake turbulence category of each designator, from
            :func:`designator_wtcs`.

    Returns:
        ``cargo`` when the callsign is an airline code of ``cargo_airlines``, ``heavy`` when the
        vNAS specs put the type in wake category H, and ``oceanic`` when the route leaves on the
        oceanic gate; empty when the plan is none of the three.
    """
    callsign = _AIRLINE_CALLSIGN.match(row.callsign)
    kinds: list[OnRequestKind] = []
    if callsign is not None and callsign.group("code") in cargo_airlines:
        kinds.append("cargo")
    if wake_categories.get(row.designator) == HEAVY_WAKE_CATEGORY:
        kinds.append("heavy")
    if direction == "oceanic":
        kinds.append("oceanic")
    return tuple(kinds)


def _on_request_kind(runway: DepartureRunway, family: str, kinds: Sequence[OnRequestKind], aircraft_class: AircraftClass) -> OnRequestKind | None:
    if runway.runway[:RUNWAY_FAMILY_LENGTH] != family or aircraft_class not in runway.classes:
        return None
    return next((kind for kind in runway.on_request_for if kind in kinds), None)


def _requested_runway(
    row: PlanRow,
    config: RunwayConfig,
    sop: SopData,
    *,
    kinds: Sequence[OnRequestKind],
    aircraft_class: AircraftClass,
    sid_runways: Mapping[str, Sequence[str]],
    direction: GateDirection | None,
) -> RunwayChoice | None:
    sid = filed_sid_token(row.route)
    families = {runway[:RUNWAY_FAMILY_LENGTH] for runway in sid_runways.get(sid, ())} if sid is not None else set()
    if not kinds or sid is None or len(families) != 1:
        return None
    family = families.pop()
    for runway in config.departure_runways:
        kind = _on_request_kind(runway, family, kinds, aircraft_class)
        if kind is None:
            continue
        requested = _preferred_runway(sop, config, family, direction) or runway.runway
        return RunwayChoice(config.id, requested, direction, on_request=OnRequestRequest(kind, sid, family))
    return None


def departure_runway(
    row: PlanRow,
    config: RunwayConfig,
    sop: SopData,
    *,
    aircraft_classes: Mapping[str, AircraftClass],
    wake_categories: Mapping[str, str],
    cargo_airlines: Sequence[str],
    sid_runways: Mapping[str, Sequence[str]],
) -> RunwayChoice:
    """Return the departure runway one filed plan gets in the sheet's runway configuration.

    The worksheets state the configuration but not the runway, so the runway comes from the plan.
    A configuration that defaults the plan's aircraft class to a runway (``default_for_classes`` in
    ``sop.yaml``) settles it first, e.g. the GA departures off 28R in 28/01. Next comes the request
    SOP 2-1 e allows: a cargo, heavy or oceanic plan that filed a procedure published for one runway
    family alone is read as asking for the configuration's ``on_request_for`` runway of that family,
    e.g. a freighter filing WESLA# in 28/01, where WESLA# is a 28-only procedure. Otherwise the
    runway follows the direction the filed route leaves on: ``direction_runway_preference`` splits
    the parallel runways of the configuration's plan by gate direction, which is what puts a
    northbound plan on the right-turn runway, and it splits the requested family the same way. A
    route whose exit fix belongs to no gate, and a direction the preference table says nothing
    about, fall back to the first departure runway the configuration publishes; so does a plan whose
    designator the vNAS specs do not cover, which has neither class nor wake category.

    Args:
        row: The filed plan.
        config: The sheet's runway configuration from :func:`sheet_runway_config`.
        sop: The transcribed SOP, for the gates, the preference table and the airport's navaid.
        aircraft_classes: The aircraft class of each designator, from :func:`designator_classes`.
        wake_categories: The wake turbulence category of each designator, from
            :func:`designator_wtcs`.
        cargo_airlines: The ICAO codes of the all-cargo airlines, out of ``routes.yaml``.
        sid_runways: The runways each procedure is published for, keyed by CIFP id.

    Returns:
        The runway and what chose it: the defaulted class, the request, the gate direction, or none
        of the three on the fallback.
    """
    first = config.departure_runways[0].runway
    aircraft_class = aircraft_classes.get(row.designator)
    direction = _gate_direction(exit_fix(row.route, sop.airport.faa), sop.gates)
    if aircraft_class is not None:
        default = _class_default(aircraft_class, config)
        if default is not None:
            return RunwayChoice(config.id, default, None, default_for_class=aircraft_class)
        kinds = flight_kinds(row, direction, cargo_airlines=cargo_airlines, wake_categories=wake_categories)
        requested = _requested_runway(row, config, sop, kinds=kinds, aircraft_class=aircraft_class, sid_runways=sid_runways, direction=direction)
        if requested is not None:
            return requested
    unclassified = row.designator if aircraft_class is None else None
    preferred = _preferred_runway(sop, config, first[:RUNWAY_FAMILY_LENGTH], direction)
    if preferred is None:
        return RunwayChoice(config.id, first, None, unclassified_designator=unclassified)
    return RunwayChoice(config.id, preferred, direction, unclassified_designator=unclassified)


def _squawk_for(row: PlanRow, index: int) -> str:
    return row.squawk if row.squawk is not None else format(FIRST_SQUAWK + index, "04o")


def _chose_the_runway(choice: RunwayChoice) -> str:
    """Return the reason clause of the note, opened by the punctuation that introduces it."""
    if choice.on_request is not None:
        request = choice.on_request
        return (
            f": a {request.kind} flight filing {request.sid}, published for the {request.family}s only, "
            "is treated as requesting them (SOP 2-1 e, on_request_for)"
        )
    if choice.default_for_class is not None:
        return f", the runway configuration {choice.config_id} defaults class {choice.default_for_class} to it (default_for_classes)"
    if choice.direction is None:
        return f", the first runway configuration {choice.config_id} departs"
    return f", the runway configuration {choice.config_id} departs {choice.direction} per direction_runway_preference"


def _note(worksheet: Worksheet, choice: RunwayChoice) -> str:
    note = f"{worksheet.title}; the sheet states no departure runway, so this is {choice.runway}{_chose_the_runway(choice)}, pending validation"
    if choice.unclassified_designator is not None:
        note += f"; type {choice.unclassified_designator} is not in the vNAS specs, so the class default was not applied"
    return note


def fixture_for(
    worksheet: Worksheet, row: PlanRow, index: int, *, icao: str, runway: RunwayChoice, rnav: frozenset[str], type_aliases: Mapping[str, str]
) -> Fixture:
    """Build the pending fixture of one worksheet flight plan.

    Args:
        worksheet: The worksheet the plan came from.
        row: The plan.
        index: The plan's position in the sheet, which numbers the squawk when the sheet prints none.
        icao: The departure airport the fixtures belong to.
        runway: The runway configuration and departure runway from :func:`departure_runway`.
        rnav: The equipment suffixes that make an aircraft RNAV capable.
        type_aliases: The aircraft types the sheets file under a non-ICAO designator, out of
            ``worksheets.yaml``, mapped to the designator the fixture carries.

    Returns:
        The fixture document, shaped as ``data/schema/fixture.schema.json`` describes and carrying no
        ``expected``, because the worksheets publish no answer key.
    """
    read_as = type_aliases.get(row.designator)
    note = _note(worksheet, runway)
    if read_as is not None:
        note += f"; type {row.designator} filed on the sheet, read as {read_as}"
    return {
        "id": f"ws-{slug(worksheet.title)}-{row.callsign.lower()}",
        "source": {"kind": "worksheet", "note": note},
        "status": "pending",
        "airport": icao,
        "scenario": {
            "callsign": row.callsign,
            "aircraftType": row.designator if read_as is None else read_as,
            "rnavCapable": row.suffix in rnav,
            "destination": row.destination,
            "filedRoute": row.route,
            "filedAltitude": row.altitude_feet,
            "runwayConfigId": runway.config_id,
            "departureRunway": runway.runway,
            "localTime": LOCAL_TIME,
            "dayOfWeek": DAY_OF_WEEK,
            "squawk": _squawk_for(row, index),
        },
    }


@dataclass(frozen=True, slots=True)
class SettledFixture:
    """A committed fixture the user has validated, and the scenario fields a re-import would change.

    ``changed_fields`` is empty when the regenerated scenario matches the committed one, so the file
    is kept as it stands; otherwise it names the ``scenario`` keys that differ.
    """

    id: str
    path: Path
    changed_fields: tuple[str, ...]


def _fixture_on_disk(path: Path) -> Mapping[str, Any]:
    try:
        body = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path}: the committed fixture is not valid JSON: {exc}") from exc
    if not isinstance(body, Mapping):
        raise ValueError(f"{path}: the committed fixture is a {type(body).__name__}, expected a fixture object")
    return body


def _scenario_changes(committed: object, regenerated: Mapping[str, Any], path: Path) -> tuple[str, ...]:
    if not isinstance(committed, Mapping):
        raise ValueError(f"{path}: the committed fixture has no `scenario` object, so the import cannot tell whether it would change")
    keys = set(committed) | set(regenerated)
    return tuple(sorted(key for key in keys if committed.get(key) != regenerated.get(key)))


def settled_fixture_at(path: Path, fixture: Fixture, *, overwrite_settled: bool) -> SettledFixture | None:
    """Return the validated fixture at ``path`` that the import must leave alone.

    The importer regenerates every fixture ``pending`` and without ``expected``, so writing over one
    the user has settled throws that validation away. A settled file is therefore never written:
    when the regenerated scenario matches the committed one the file is kept untouched, and when it
    differs the caller reports the fixture instead of writing it.

    Args:
        path: The fixture file the import is about to write.
        fixture: The regenerated fixture document.
        overwrite_settled: Stand the guard down, so the caller writes the pending document over the
            settled one.

    Returns:
        ``None`` when the guard stands down, the path holds no file, or the committed fixture is not
        settled - the caller writes as usual. Otherwise the settled fixture and the scenario fields
        a write would change.

    Raises:
        ValueError: The committed fixture is not a JSON object, or carries no ``scenario``.
    """
    if overwrite_settled or not path.exists():
        return None
    body = _fixture_on_disk(path)
    if body.get("status") != SETTLED_STATUS:
        return None
    changed = _scenario_changes(body.get("scenario"), fixture["scenario"], path)
    return SettledFixture(id=str(body.get("id", path.stem)), path=path, changed_fields=changed)


def fixture_dir(icao: str) -> Path:
    """Return the directory the worksheet fixtures of one airport are written to.

    Args:
        icao: Four-letter ICAO identifier; case is ignored.

    Returns:
        The path under ``fixtures/``.
    """
    return repo_root() / "fixtures" / icao.lower() / "worksheets"


def sheet_fixtures(
    worksheet: Worksheet,
    text: str,
    *,
    icao: str,
    sop: SopData,
    rnav: frozenset[str],
    type_aliases: Mapping[str, str],
    aircraft_classes: Mapping[str, AircraftClass],
    wake_categories: Mapping[str, str],
    cargo_airlines: Sequence[str],
    sid_runways: Mapping[str, Sequence[str]],
) -> dict[Path, Fixture]:
    """Parse one worksheet and build the fixture of every flight plan on it.

    Args:
        worksheet: The worksheet row out of ``worksheets.yaml``.
        text: The document's exported text.
        icao: The departure airport the fixtures belong to.
        sop: The transcribed SOP, for the runway configurations, the gates and the preference table.
        rnav: The equipment suffixes that make an aircraft RNAV capable.
        type_aliases: The aircraft type aliases out of ``worksheets.yaml``.
        aircraft_classes: The aircraft class of each designator, from :func:`designator_classes`.
        wake_categories: The wake turbulence category of each designator, from
            :func:`designator_wtcs`.
        cargo_airlines: The ICAO codes of the all-cargo airlines, out of ``routes.yaml``.
        sid_runways: The runways each procedure is published for, keyed by CIFP id.

    Returns:
        One fixture per flight plan, keyed by the file it is written to, in sheet order.

    Raises:
        ValueError: The text does not have the shape the sheet's kind promises, the sheet's runway
            configuration does not resolve, or two plans on the sheet share a callsign.
    """
    config = sheet_runway_config(worksheet.config, sop.runway_configs, worksheet.title)
    name = slug(worksheet.title)
    directory = fixture_dir(icao)
    fixtures: dict[Path, Fixture] = {}
    for index, row in enumerate(parse_worksheet(worksheet, text)):
        path = directory / f"{name}-{row.callsign.lower()}.json"
        if path in fixtures:
            raise ValueError(
                f"{worksheet.title}: two flight plans are filed as {row.callsign!r}, so they name one fixture file; the sheet is ambiguous"
            )
        runway = departure_runway(
            row,
            config,
            sop,
            aircraft_classes=aircraft_classes,
            wake_categories=wake_categories,
            cargo_airlines=cargo_airlines,
            sid_runways=sid_runways,
        )
        fixtures[path] = fixture_for(worksheet, row, index, icao=icao, runway=runway, rnav=rnav, type_aliases=type_aliases)
    return fixtures
