"""The FAA Aircraft Characteristics Database: approach category and airframe facts per ICAO type.

``https://www.faa.gov/airports/engineering/aircraft_char_database/aircraft_data`` serves the FAA's
own spreadsheet of the types that operate at US airports, one row per ICAO designator, carrying the
Aircraft Approach Category (AAC) the FAA publishes for it along with the approach speed, engine
class, manufacturer, model, maximum take-off weight and ICAO wake turbulence category it is derived
from. The table is national, so it lands in ``generator/shared/`` as one YAML file every airport
inherits rather than a column of estimates copied into each airport's ``routes.yaml``.

:func:`parse_aircraft_characteristics` reads the workbook, :func:`write_aircraft_characteristics`
writes the shared YAML, and :func:`load_aircraft_characteristics` reads it back with the same strict
checks the other shared files get. ``AAC`` is empty on a type the FAA states no category for, which
it writes as ``N/A`` or ``tbd``; the entry then carries no category and the build says so by name
rather than guessing one.
"""

import io
import json
import re
import warnings
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Literal

import yaml
from openpyxl import load_workbook

from craft_generator.sop.load import _load_yaml_mapping, _Row, _where

Aac = Literal["A", "B", "C", "D", "E"]

AAC_CATEGORIES: tuple[Aac, ...] = ("A", "B", "C", "D", "E")

AIRCRAFT_CHARACTERISTICS_URL = "https://www.faa.gov/airports/engineering/aircraft_char_database/aircraft_data"
AIRCRAFT_CHARACTERISTICS_TITLE = "FAA Aircraft Characteristics Database"
AIRCRAFT_CHARACTERISTICS_CACHE_FILE = "faa-aircraft-characteristics.xlsx"

SHEET_NAME = "ACD_Data"
CODE_COLUMN = "ICAO_Code"
COLUMNS = (
    CODE_COLUMN,
    "Manufacturer",
    "Model_FAA",
    "Physical_Class_Engine",
    "Num_Engines",
    "AAC",
    "AAC_minimum",
    "AAC_maximum",
    "Approach_Speed_knot",
    "MTOW_lb",
    "ICAO_WTC",
)

_NOT_STATED = frozenset({"", "N/A", "NA", "TBD"})
_PLAIN_SCALAR = re.compile(r"[A-Za-z0-9][A-Za-z0-9 ./+&'()\-]*")


@dataclass(frozen=True, slots=True)
class AircraftCharacteristic:
    """One aircraft type as the FAA database describes it.

    ``aac`` is the published Aircraft Approach Category, and is ``None`` for a type the FAA states
    none for. ``aac_minimum`` and ``aac_maximum`` are the span of the variants the row covers, and
    are ``None`` on a row whose variants share one category.
    """

    aac: Aac | None
    aac_minimum: Aac | None
    aac_maximum: Aac | None
    approach_speed_knot: int | None
    engine: str
    engines: int
    manufacturer: str
    model: str
    mtow_lb: int | None
    wtc: str


@dataclass(frozen=True, slots=True)
class AircraftCharacteristics:
    """The parsed table, keyed by ICAO designator, and what the parser had to pass over."""

    aircraft: dict[str, AircraftCharacteristic]
    warnings: tuple[str, ...]


def aircraft_characteristics_cache_path(cache: Path) -> Path:
    """Return the cache file the FAA aircraft characteristics workbook is downloaded to."""
    return cache / AIRCRAFT_CHARACTERISTICS_CACHE_FILE


def _cell_text(value: object) -> str:
    if value is None:
        return ""
    return value.strip() if isinstance(value, str) else str(value)


def _text(value: object, field: str, where: str) -> str:
    text = _cell_text(value)
    if not text:
        raise ValueError(f"{where}: column {field} is empty; the FAA table states it for every type, so the workbook is not the one this reads")
    return text


def _category(value: object, field: str, where: str) -> Aac | None:
    text = _cell_text(value).upper()
    if text in _NOT_STATED:
        return None
    for option in AAC_CATEGORIES:
        if option == text:
            return option
    raise ValueError(f"{where}: column {field} is {text!r}, which is no approach category; expected one of {list(AAC_CATEGORIES)} or N/A")


def _whole(value: object, field: str, where: str) -> int | None:
    if isinstance(value, bool):
        raise ValueError(f"{where}: column {field} is {value!r}, expected a number")
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return round(value)
    if _cell_text(value).upper() in _NOT_STATED:
        return None
    raise ValueError(f"{where}: column {field} is {value!r}, expected a number or N/A")


def _required_whole(value: object, field: str, where: str) -> int:
    number = _whole(value, field, where)
    if number is None:
        raise ValueError(f"{where}: column {field} states no number; the FAA table states it for every type")
    return number


def _header_row(rows: Sequence[Sequence[Any]]) -> tuple[int, dict[str, int]]:
    for index, row in enumerate(rows):
        if any(_cell_text(cell) == CODE_COLUMN for cell in row):
            columns = {_cell_text(cell): position for position, cell in enumerate(row) if _cell_text(cell)}
            missing = [name for name in COLUMNS if name not in columns]
            if missing:
                raise ValueError(f"{AIRCRAFT_CHARACTERISTICS_TITLE}: sheet {SHEET_NAME} has no column(s) {missing}; the workbook layout changed")
            return index, columns
    raise ValueError(f"{AIRCRAFT_CHARACTERISTICS_TITLE}: sheet {SHEET_NAME} has no row holding a {CODE_COLUMN!r} cell, so its header cannot be found")


def _entry_of(row: Sequence[Any], columns: Mapping[str, int], where: str) -> AircraftCharacteristic:
    def cell(name: str) -> Any:
        position = columns[name]
        return row[position] if position < len(row) else None

    return AircraftCharacteristic(
        aac=_category(cell("AAC"), "AAC", where),
        aac_minimum=_category(cell("AAC_minimum"), "AAC_minimum", where),
        aac_maximum=_category(cell("AAC_maximum"), "AAC_maximum", where),
        approach_speed_knot=_whole(cell("Approach_Speed_knot"), "Approach_Speed_knot", where),
        engine=_text(cell("Physical_Class_Engine"), "Physical_Class_Engine", where),
        engines=_required_whole(cell("Num_Engines"), "Num_Engines", where),
        manufacturer=_text(cell("Manufacturer"), "Manufacturer", where),
        model=_text(cell("Model_FAA"), "Model_FAA", where),
        mtow_lb=_whole(cell("MTOW_lb"), "MTOW_lb", where),
        wtc=_text(cell("ICAO_WTC"), "ICAO_WTC", where),
    )


def _sheet_rows(data: bytes) -> list[tuple[Any, ...]]:
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=UserWarning, module="openpyxl")
        workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        try:
            if SHEET_NAME not in workbook.sheetnames:
                raise ValueError(
                    f"{AIRCRAFT_CHARACTERISTICS_TITLE}: the workbook has sheet(s) {workbook.sheetnames}, expected one named {SHEET_NAME}"
                )
            return list(workbook[SHEET_NAME].iter_rows(values_only=True))
        finally:
            workbook.close()


def parse_aircraft_characteristics(data: bytes) -> AircraftCharacteristics:
    """Read the FAA Aircraft Characteristics Database workbook.

    Args:
        data: The ``.xlsx`` body, as downloaded or read from disk.

    Returns:
        One entry per ICAO designator, in the sheet's own order, and a warning for every designator
        the sheet states twice. A repeated designator keeps the first row.

    Raises:
        ValueError: The workbook has no ``ACD_Data`` sheet, no header row carrying an ``ICAO_Code``
            cell, no column this reads, or a row whose approach category, number or required text
            the parser cannot read.
    """
    rows = _sheet_rows(data)
    header_index, columns = _header_row(rows)
    aircraft: dict[str, AircraftCharacteristic] = {}
    duplicates: list[str] = []
    for offset, row in enumerate(rows[header_index + 1 :]):
        code = _cell_text(row[columns[CODE_COLUMN]] if columns[CODE_COLUMN] < len(row) else None)
        if not code:
            continue
        where = f"{AIRCRAFT_CHARACTERISTICS_TITLE} row {header_index + offset + 2} ({code})"
        entry = _entry_of(row, columns, where)
        if code in aircraft:
            duplicates.append(f"{code} is stated twice; kept the first row, dropped {entry.manufacturer} {entry.model}")
            continue
        aircraft[code] = entry
    return AircraftCharacteristics(aircraft=aircraft, warnings=tuple(duplicates))


def _scalar(value: str) -> str:
    if _PLAIN_SCALAR.fullmatch(value) and yaml.safe_load(value) == value:
        return value
    return json.dumps(value)


def _fields(entry: AircraftCharacteristic) -> Iterator[tuple[str, str]]:
    for key, value in (
        ("aac", entry.aac),
        ("aac_maximum", entry.aac_maximum),
        ("aac_minimum", entry.aac_minimum),
        ("approach_speed_knot", entry.approach_speed_knot),
        ("engine", entry.engine),
        ("engines", entry.engines),
        ("manufacturer", entry.manufacturer),
        ("model", entry.model),
        ("mtow_lb", entry.mtow_lb),
        ("wtc", entry.wtc),
    ):
        if value is not None:
            yield key, str(value) if isinstance(value, int) else _scalar(value)


def write_aircraft_characteristics(path: Path, table: Mapping[str, AircraftCharacteristic], *, source_url: str, fetched_at: date) -> None:
    """Write the shared ``faa_aircraft_characteristics.yaml``, one aircraft per line, sorted by designator.

    Args:
        path: File to write, normally ``generator/shared/faa_aircraft_characteristics.yaml``.
        table: The entries to write, keyed by ICAO designator.
        source_url: The URL the workbook was downloaded from.
        fetched_at: The day it was downloaded.
    """
    lines = [
        f"# {AIRCRAFT_CHARACTERISTICS_TITLE}, written by `craft-gen fetch-aircraft-characteristics`. Never hand-edit it.",
        "# Shared by every airport: the FAA publishes one Aircraft Approach Category per ICAO type, so the table lives",
        "# here rather than in `airports/<icao>/routes.yaml`, whose fleet rows only state a category the FAA has none for.",
        "source:",
        f"  title: {AIRCRAFT_CHARACTERISTICS_TITLE}",
        f"  url: {source_url}",
        f"  fetched_at: {fetched_at.isoformat()}",
        "aircraft:",
    ]
    for code in sorted(table):
        fields = ", ".join(f"{key}: {value}" for key, value in _fields(table[code]))
        lines.append(f"  {_scalar(code)}: {{ {fields} }}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def _entry(row: _Row) -> AircraftCharacteristic:
    entry = AircraftCharacteristic(
        aac=row.optional_choice("aac", AAC_CATEGORIES),
        aac_minimum=row.optional_choice("aac_minimum", AAC_CATEGORIES),
        aac_maximum=row.optional_choice("aac_maximum", AAC_CATEGORIES),
        approach_speed_knot=row.optional_number("approach_speed_knot"),
        engine=row.text("engine"),
        engines=row.number("engines"),
        manufacturer=row.text("manufacturer"),
        model=row.text("model"),
        mtow_lb=row.optional_number("mtow_lb"),
        wtc=row.text("wtc"),
    )
    row.finish()
    return entry


def load_aircraft_characteristics(path: Path) -> dict[str, AircraftCharacteristic]:
    """Load the shared FAA aircraft characteristics table.

    The ``source`` block is checked for shape - it records where and when the file came from - and
    the aircraft table is what the build reads.

    Args:
        path: Path to ``generator/shared/faa_aircraft_characteristics.yaml``.

    Returns:
        One entry per ICAO designator, keyed by designator.

    Raises:
        ValueError: The file is not a YAML mapping, carries an unknown key, states an approach
            category outside A-E, or holds a malformed number or date.
        OSError: The file is missing.
    """
    where = _where(path)
    root = _Row(where, _load_yaml_mapping(path, where))
    source = root.child("source")
    source.text("title")
    source.text("url")
    source.day("fetched_at")
    source.finish()
    table = root.table("aircraft")
    root.finish()
    return {code: _entry(_Row(f"{where}.aircraft[{code}]", value)) for code, value in table.items()}
