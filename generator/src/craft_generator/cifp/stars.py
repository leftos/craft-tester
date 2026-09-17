"""The arrivals every airport publishes, from the ARINC 424 STAR (``PE``) rows of the CIFP.

Layout verified against ``FAACIFP18`` from cycle 2609 (effective 2026-09-03), the 4,927 arrival rows
the 42 destinations of the KSFO route library publish between them, every row exactly 132 characters.
The first leg of the BURGL transition of the IRNMN TWO arrival at Los Angeles reads::

    SUSAP KLAXK2EIRNMN24BURGL 010BURGLK2EA0E       IF ...

Section ``S`` sits at ``[0]``, subsection ``P`` at ``[4]``, the airport identifier at ``[6:10]``
(blank-padded, so ``O88`` arrives as ``"O88 "``), the record type ``E`` at ``[12]``, the procedure
identifier at ``[13:19]``, likewise blank-padded, so ``OLM2`` arrives as ``"OLM2  "``, the route type
at ``[19]`` and the transition identifier at ``[20:25]``. Every field is stripped. Everything past
the transition describes the legs, which nothing here reads.

Route types (field 5.7) split the legs of a STAR the way they split a SID, with the ends swapped:
``1``/``2``/``3`` are the conventional enroute, common and runway portions, ``4``/``5``/``6`` their
RNAV equivalents. An arrival is RNAV when it publishes any ``4``/``5``/``6`` leg; no arrival of the
2609 file mixes the two sets. The transition identifier of an enroute portion is the fix the
transition begins on - ``BURGL`` and ``REBRG`` for IRNMN2 - which is what the chart names it, so the
transitions come off that field in file order, which is the order the chart lists them in. An arrival
that publishes no enroute portion at all, like OLAAA2 at Los Angeles, has none.

An arrival is not unique to one airport. ``OLM2`` is published by Seattle-Tacoma and by Boeing Field,
so it appears under both keys; the arrivals are built by accumulation, not by assignment.

An airport absent from the returned mapping means one of two different things, and the caller has to
keep them apart:

* It is not in the FAA file at all, which is every foreign airport - ``CYVR``, ``ESSA``, ``MMMX`` and
  ``RKSI`` have no rows of any kind, not even an airport reference point.
* It is in the file, with an airport reference point, and publishes no arrival at all. ``KLVK`` and
  ``O88`` are two of these; a small field simply has no STAR.

ARINC 424 puts the continuation record number at 1-based column 39, i.e. ``[38]``, as documented in
:mod:`craft_generator.cifp.records`. All 683 arrival identifiers of 2609 are letters followed by a
version number, so :func:`craft_generator.cifp.sid.split_sid_id` splits a STAR id into its family the
same way it splits a SID id. A row shorter than ``RECORD_LENGTH`` is rejected outright rather than
measured against the last column read: a STAR row is a full fixed-width procedure row, exactly like
the SID rows :mod:`craft_generator.cifp.records` parses, so a short one is malformed.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from craft_generator.cifp.records import RECORD_LENGTH
from craft_generator.cifp.sid import split_sid_id

STAR_RECORD_TYPE = "E"
AIRPORT_COLUMNS = (6, 10)
PROCEDURE_ID_COLUMNS = (13, 19)
ROUTE_TYPE_COLUMN = 19
TRANSITION_COLUMNS = (20, 25)

ENROUTE_ROUTE_TYPES = frozenset({"1", "4"})
RNAV_ROUTE_TYPES = frozenset({"4", "5", "6"})

_CONTINUATION_COLUMN = 38
_PRIMARY_CONTINUATION_NUMBERS = frozenset({"0", "1"})


@dataclass(frozen=True, slots=True)
class StarRecord:
    """One leg of an arrival as published in the CIFP, with the airport that publishes it."""

    airport: str
    star_id: str
    route_type: str
    transition: str


@dataclass(frozen=True, slots=True)
class CifpStar:
    """One arrival as the CIFP publishes it: ``IRNMN2`` of the ``IRNMN`` family, RNAV, off BURGL or REBRG."""

    id: str
    family: str
    rnav: bool
    transitions: tuple[str, ...]


def parse_star_record(line: str) -> StarRecord | None:
    """Parse one CIFP line into the leg of an arrival it publishes.

    Args:
        line: A single CIFP line, without its newline.

    Returns:
        The airport, the arrival identifier, the route type and the transition identifier, each
        stripped of its blank padding, or ``None`` when the line is not a primary STAR row or carries
        an empty airport or arrival identifier. Any input is accepted; nothing about a malformed line
        raises.
    """
    if len(line) < RECORD_LENGTH or line[0] != "S" or line[4] != "P" or line[12] != STAR_RECORD_TYPE:
        return None
    if line[_CONTINUATION_COLUMN] not in _PRIMARY_CONTINUATION_NUMBERS:
        return None
    airport = line[AIRPORT_COLUMNS[0] : AIRPORT_COLUMNS[1]].strip()
    star_id = line[PROCEDURE_ID_COLUMNS[0] : PROCEDURE_ID_COLUMNS[1]].strip()
    if not airport or not star_id:
        return None
    return StarRecord(
        airport=airport,
        star_id=star_id,
        route_type=line[ROUTE_TYPE_COLUMN],
        transition=line[TRANSITION_COLUMNS[0] : TRANSITION_COLUMNS[1]].strip(),
    )


def _star(star_id: str, records: Sequence[StarRecord]) -> CifpStar:
    family, _version = split_sid_id(star_id)
    transitions = [record.transition for record in records if record.route_type in ENROUTE_ROUTE_TYPES and record.transition]
    return CifpStar(
        id=star_id,
        family=family,
        rnav=any(record.route_type in RNAV_ROUTE_TYPES for record in records),
        transitions=tuple(dict.fromkeys(transitions)),
    )


def parse_stars(lines: Iterable[str]) -> dict[str, tuple[CifpStar, ...]]:
    """Return the arrivals every airport in the CIFP publishes, keyed by ICAO identifier.

    Args:
        lines: CIFP lines in file order; trailing newlines are tolerated.

    Returns:
        The arrivals each airport publishes, in file order, e.g. ``{"KSEA": (CifpStar(id="OLM2",
        ...), ...), ...}``. An airport with no arrival row is absent rather than mapped to an empty
        tuple, which is also how an airport the file does not carry at all comes back.

    Raises:
        ValueError: An arrival identifier is not letters followed by a version number, which means
            the row is misaligned.
    """
    legs: dict[str, dict[str, list[StarRecord]]] = {}
    for raw in lines:
        record = parse_star_record(raw.rstrip("\r\n"))
        if record is not None:
            legs.setdefault(record.airport, {}).setdefault(record.star_id, []).append(record)
    return {airport: tuple(_star(star_id, records) for star_id, records in arrivals.items()) for airport, arrivals in legs.items()}
