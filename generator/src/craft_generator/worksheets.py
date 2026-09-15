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
the validation loop (see ``docs/ARCHITECTURE.md``, fixture lifecycle). Two scenario fields the
worksheets do not state are filled here and recorded in ``source.note``: the departure runway, which
is the first the sheet's runway configuration publishes, and - on the amendment sheets, which print
no squawk - a code counted up from 4601 in octal.
"""

import re
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from craft_generator.emit import repo_root
from craft_generator.http import fetch_bytes
from craft_generator.sop.model import EquipmentSuffix, RunwayConfig, Worksheet

Fixture = dict[str, Any]

EXPORT_URL = "https://docs.google.com/document/d/{document_id}/export?format=txt"

LOCAL_TIME = "1400"
DAY_OF_WEEK = "tuesday"
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

_TYPE_PATTERN = re.compile(r"^(?:(?P<weight>[HJ])/)?(?P<designator>[A-Z0-9]{2,4})(?:/(?P<suffix>[A-Z]))?$")
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


def departure_runway(config_id: str | None, configs: Sequence[RunwayConfig], where: str) -> tuple[str, str]:
    """Return the runway configuration and departure runway the fixtures of one sheet carry.

    The worksheets state the configuration but not the runway, so the first departure runway the
    configuration publishes is used and recorded in the fixture's ``source.note``; the validation
    loop corrects it plan by plan.

    Args:
        config_id: The ``runway_configs`` id the sheet declares, or ``None``.
        configs: The runway configurations out of ``sop.yaml``.
        where: The sheet's title, used in the error messages.

    Returns:
        The configuration id and the runway designator.

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
    return config.id, config.departure_runways[0].runway


def _squawk_for(row: PlanRow, index: int) -> str:
    return row.squawk if row.squawk is not None else format(FIRST_SQUAWK + index, "04o")


def _note(worksheet: Worksheet, config_id: str, runway: str) -> str:
    return (
        f"{worksheet.title}; the sheet states no departure runway, so this is {runway}, "
        f"the first runway configuration {config_id} departs, pending validation"
    )


def fixture_for(worksheet: Worksheet, row: PlanRow, index: int, *, icao: str, runway: tuple[str, str], rnav: frozenset[str]) -> Fixture:
    """Build the pending fixture of one worksheet flight plan.

    Args:
        worksheet: The worksheet the plan came from.
        row: The plan.
        index: The plan's position in the sheet, which numbers the squawk when the sheet prints none.
        icao: The departure airport the fixtures belong to.
        runway: The runway configuration id and departure runway from :func:`departure_runway`.
        rnav: The equipment suffixes that make an aircraft RNAV capable.

    Returns:
        The fixture document, shaped as ``data/schema/fixture.schema.json`` describes and carrying no
        ``expected``, because the worksheets publish no answer key.
    """
    config_id, designator = runway
    return {
        "id": f"ws-{slug(worksheet.title)}-{row.callsign.lower()}",
        "source": {"kind": "worksheet", "note": _note(worksheet, config_id, designator)},
        "status": "pending",
        "airport": icao,
        "scenario": {
            "callsign": row.callsign,
            "aircraftType": row.designator,
            "rnavCapable": row.suffix in rnav,
            "destination": row.destination,
            "filedRoute": row.route,
            "filedAltitude": row.altitude_feet,
            "runwayConfigId": config_id,
            "departureRunway": designator,
            "localTime": LOCAL_TIME,
            "dayOfWeek": DAY_OF_WEEK,
            "squawk": _squawk_for(row, index),
        },
    }


def fixture_dir(icao: str) -> Path:
    """Return the directory the worksheet fixtures of one airport are written to.

    Args:
        icao: Four-letter ICAO identifier; case is ignored.

    Returns:
        The path under ``fixtures/``.
    """
    return repo_root() / "fixtures" / icao.lower() / "worksheets"


def sheet_fixtures(worksheet: Worksheet, text: str, *, icao: str, configs: Sequence[RunwayConfig], rnav: frozenset[str]) -> dict[Path, Fixture]:
    """Parse one worksheet and build the fixture of every flight plan on it.

    Args:
        worksheet: The worksheet row out of ``worksheets.yaml``.
        text: The document's exported text.
        icao: The departure airport the fixtures belong to.
        configs: The runway configurations out of ``sop.yaml``.
        rnav: The equipment suffixes that make an aircraft RNAV capable.

    Returns:
        One fixture per flight plan, keyed by the file it is written to, in sheet order.

    Raises:
        ValueError: The text does not have the shape the sheet's kind promises, the sheet's runway
            configuration does not resolve, or two plans on the sheet share a callsign.
    """
    runway = departure_runway(worksheet.config, configs, worksheet.title)
    name = slug(worksheet.title)
    directory = fixture_dir(icao)
    fixtures: dict[Path, Fixture] = {}
    for index, row in enumerate(parse_worksheet(worksheet, text)):
        path = directory / f"{name}-{row.callsign.lower()}.json"
        if path in fixtures:
            raise ValueError(
                f"{worksheet.title}: two flight plans are filed as {row.callsign!r}, so they name one fixture file; the sheet is ambiguous"
            )
        fixtures[path] = fixture_for(worksheet, row, index, icao=icao, runway=runway, rnav=rnav)
    return fixtures
