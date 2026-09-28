"""The US airways, from the ARINC 424 enroute airway (``ER``) rows of the CIFP.

Layout verified against ``FAACIFP18`` from cycle 2609 (effective 2026-09-03), the 16,963 ``SUSAER``
rows of 1,243 route identifiers, every row exactly 132 characters. The first row of V6 reads::

    SUSAER       V6          0100OAK  K2D 0V    OL                        02200085     04000     17500

Section ``E`` sits at ``[4]`` and subsection ``R`` at ``[5]`` (the customer area ``USA`` before them,
so every row opens ``SUSAER``), the route identifier at ``[13:18]``, the sequence number at
``[25:29]``, the fix identifier at ``[29:34]`` and its ICAO region at ``[34:36]``. The fix's own
section is at ``[36]``: ``D`` a VHF navaid or NDB, ``E`` an enroute waypoint. ``[38]`` is the
continuation record number, as :mod:`craft_generator.cifp.records` documents it. The waypoint
description runs ``[39:43]``, and an ``E`` at ``[40]`` ends a stretch of the airway: V6 runs from
OAK to DPA (sequence 0910) and starts again at PSB (0920), 178 such breaks in the 2609 file besides
the last row of every airway. ``[44]`` is the route type, ``O`` conventional or ``R`` RNAV, and
``[45]`` the level, ``H`` high, ``L`` low, ``B`` both or blank; every row of one airway agrees on
both. The direction restriction at ``[46]`` is blank in every row and is not read.

The leg fields describe the leg that leaves the row's fix for the next one: the outbound course at
``[70:74]``, the leg distance in tenths of a nautical mile at ``[74:78]``, the inbound course at
``[78:82]``, the minimum enroute altitude at ``[83:88]`` and the maximum authorized altitude at
``[93:98]``, both in feet. The last row of a stretch has no leg to describe and carries only an
inbound course. An MEA the FAA does not publish reads ``UNKNN`` (1,205 rows). A second minimum
altitude at ``[88:93]``, filled in 637 rows, is not read: neither the FAA's CIFP readme nor the
data says which direction it applies to.

The same identifier can appear in other customer areas; only ``SUSAER`` rows are read. A row
shorter than ``RECORD_LENGTH`` is rejected outright, as :mod:`craft_generator.cifp.stars` does.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Literal

from craft_generator.cifp.records import RECORD_LENGTH

AIRWAY_ROW_PREFIX = "SUSAER"
ROUTE_ID_COLUMNS = (13, 18)
SEQUENCE_COLUMNS = (25, 29)
FIX_COLUMNS = (29, 34)
FIX_SECTION_COLUMN = 36
STRETCH_END_COLUMN = 40
ROUTE_TYPE_COLUMN = 44
LEVEL_COLUMN = 45
DISTANCE_COLUMNS = (74, 78)
MEA_COLUMNS = (83, 88)
MAA_COLUMNS = (93, 98)

RNAV_ROUTE_TYPE = "R"
STRETCH_END = "E"
UNKNOWN_ALTITUDE = "UNKNN"

type FixSection = Literal["navaid", "waypoint"]
type AirwayLevel = Literal["high", "low", "both"]

_FIX_SECTIONS: dict[str, FixSection] = {"D": "navaid", "E": "waypoint"}
_LEVELS: dict[str, AirwayLevel] = {"H": "high", "L": "low", "B": "both"}
_CONTINUATION_COLUMN = 38
_PRIMARY_CONTINUATION_NUMBERS = frozenset({"0", "1"})


@dataclass(frozen=True, slots=True)
class AirwayFix:
    """One fix of an airway, with the leg that leaves it for the next fix of its stretch.

    ``mea``, ``maa`` and ``distance_nm`` describe that leg, so the last fix of a stretch has none;
    ``mea`` is also ``None`` where the CIFP codes it ``UNKNN``.
    """

    fix: str
    section: FixSection
    mea: int | None
    maa: int | None
    distance_nm: float | None


@dataclass(frozen=True, slots=True)
class AirwayRecord:
    """One row of an airway as published in the CIFP."""

    route_id: str
    sequence: str
    fix: AirwayFix
    ends_stretch: bool
    rnav: bool
    level: AirwayLevel | None


@dataclass(frozen=True, slots=True)
class CifpAirway:
    """One airway as the CIFP publishes it: V6, conventional, low, in two stretches split at DPA and PSB."""

    id: str
    rnav: bool
    level: AirwayLevel | None
    stretches: tuple[tuple[AirwayFix, ...], ...]


def _altitude(field: str) -> int | None:
    value = field.strip()
    if not value or value == UNKNOWN_ALTITUDE:
        return None
    return int(value)


def _distance(field: str) -> float | None:
    value = field.strip()
    return int(value) / 10 if value else None


def parse_airway_record(line: str) -> AirwayRecord | None:
    """Parse one CIFP line into the airway row it publishes.

    Args:
        line: A single CIFP line, without its newline.

    Returns:
        The row, or ``None`` when the line is not a primary ``SUSAER`` row or carries an empty
        route or fix identifier.

    Raises:
        ValueError: The fix section, the level or a numeric field holds a value the layout does
            not allow, which means the row is misaligned.
    """
    if len(line) < RECORD_LENGTH or not line.startswith(AIRWAY_ROW_PREFIX):
        return None
    if line[_CONTINUATION_COLUMN] not in _PRIMARY_CONTINUATION_NUMBERS:
        return None
    route_id = line[ROUTE_ID_COLUMNS[0] : ROUTE_ID_COLUMNS[1]].strip()
    fix = line[FIX_COLUMNS[0] : FIX_COLUMNS[1]].strip()
    if not route_id or not fix:
        return None
    section = _FIX_SECTIONS.get(line[FIX_SECTION_COLUMN])
    level_letter = line[LEVEL_COLUMN]
    if section is None or (level_letter != " " and level_letter not in _LEVELS):
        raise ValueError(
            f"airway {route_id} fix {fix}: section {line[FIX_SECTION_COLUMN]!r} or level {level_letter!r} "
            f"is not in the layout; misaligned row {line!r}"
        )
    return AirwayRecord(
        route_id=route_id,
        sequence=line[SEQUENCE_COLUMNS[0] : SEQUENCE_COLUMNS[1]],
        fix=AirwayFix(
            fix=fix,
            section=section,
            mea=_altitude(line[MEA_COLUMNS[0] : MEA_COLUMNS[1]]),
            maa=_altitude(line[MAA_COLUMNS[0] : MAA_COLUMNS[1]]),
            distance_nm=_distance(line[DISTANCE_COLUMNS[0] : DISTANCE_COLUMNS[1]]),
        ),
        ends_stretch=line[STRETCH_END_COLUMN] == STRETCH_END,
        rnav=line[ROUTE_TYPE_COLUMN] == RNAV_ROUTE_TYPE,
        level=_LEVELS.get(level_letter),
    )


def _airway(route_id: str, records: Sequence[AirwayRecord]) -> CifpAirway:
    ordered = sorted(records, key=lambda record: record.sequence)
    stretches: list[tuple[AirwayFix, ...]] = []
    current: list[AirwayFix] = []
    for record in ordered:
        current.append(record.fix)
        if record.ends_stretch:
            stretches.append(tuple(current))
            current = []
    if current:
        stretches.append(tuple(current))
    return CifpAirway(id=route_id, rnav=ordered[0].rnav, level=ordered[0].level, stretches=tuple(stretches))


def parse_airways(lines: Iterable[str]) -> dict[str, CifpAirway]:
    """Return every US airway the CIFP publishes, keyed by route identifier.

    Args:
        lines: CIFP lines in file order; trailing newlines are tolerated.

    Returns:
        Each airway with its fixes in sequence order, split into stretches where the CIFP ends
        one, e.g. ``{"V6": CifpAirway(id="V6", rnav=False, level="low", stretches=((OAK, ...,
        DPA), (PSB, ...))), ...}``.

    Raises:
        ValueError: A row is misaligned, as :func:`parse_airway_record` describes.
    """
    rows: dict[str, list[AirwayRecord]] = {}
    for raw in lines:
        record = parse_airway_record(raw.rstrip("\r\n"))
        if record is not None:
            rows.setdefault(record.route_id, []).append(record)
    return {route_id: _airway(route_id, records) for route_id, records in rows.items()}
