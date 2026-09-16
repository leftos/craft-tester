"""The arrivals every airport publishes, from the ARINC 424 STAR (``PE``) rows of the CIFP.

Layout verified against ``FAACIFP18`` from cycle 2609 (effective 2026-09-03), the 4,927 arrival rows
the 42 destinations of the KSFO route library publish between them, every row exactly 132 characters.
The first leg of the OLYMPIA TWO arrival at Seattle reads::

    SUSAP KSEAK1EOLM2  1BTG   010BTG  K1D 0V       IF ...

Section ``S`` sits at ``[0]``, subsection ``P`` at ``[4]``, the airport identifier at ``[6:10]``
(blank-padded, so ``O88`` arrives as ``"O88 "``), the record type ``E`` at ``[12]`` and the procedure
identifier at ``[13:19]``, likewise blank-padded, so ``OLM2`` arrives as ``"OLM2  "``. Both fields are
stripped. Everything past the identifier describes the legs of the arrival, which nothing here reads:
one row is enough to know the procedure is published, and the remaining rows of the same procedure add
nothing.

An arrival is not unique to one airport. ``OLM2`` is published by Seattle-Tacoma and by Boeing Field,
so it appears under both keys; the sets are built by accumulation, not by assignment.

An airport absent from the returned mapping means one of two different things, and the caller has to
keep them apart:

* It is not in the FAA file at all, which is every foreign airport - ``CYVR``, ``ESSA``, ``MMMX`` and
  ``RKSI`` have no rows of any kind, not even an airport reference point.
* It is in the file, with an airport reference point, and publishes no arrival at all. ``KLVK`` and
  ``O88`` are two of these; a small field simply has no STAR.

Procedure families are not derived here. ``cifp`` is the lower layer and does not import from ``sop``,
so the caller passes these identifiers through ``craft_generator.sop.load.sid_family_of`` to turn
``HAWKZ8`` into ``HAWKZ``.

ARINC 424 puts the continuation record number at 1-based column 39, i.e. ``[38]``, as documented in
:mod:`craft_generator.cifp.records`. All 179 checked-in rows carry ``0`` in 2609, so none are
continuations today; rows outside ``{"0", "1"}`` are skipped so a future cycle that adds continuation
text cannot produce phantom identifiers. A row shorter than ``RECORD_LENGTH`` is rejected outright
rather than measured against the last column read: a STAR row is a full fixed-width procedure row,
exactly like the SID rows :mod:`craft_generator.cifp.records` parses, so a short one is malformed.
"""

from collections.abc import Iterable

from craft_generator.cifp.records import RECORD_LENGTH

STAR_RECORD_TYPE = "E"
AIRPORT_COLUMNS = (6, 10)
PROCEDURE_ID_COLUMNS = (13, 19)

_CONTINUATION_COLUMN = 38
_PRIMARY_CONTINUATION_NUMBERS = frozenset({"0", "1"})


def parse_star_record(line: str) -> tuple[str, str] | None:
    """Parse one CIFP line into the airport it belongs to and the arrival it is a leg of.

    Args:
        line: A single CIFP line, without its newline.

    Returns:
        The airport identifier and the STAR identifier, both stripped of their blank padding, or
        ``None`` when the line is not a primary STAR row or carries an empty identifier. Any input is
        accepted; nothing about a malformed line raises.
    """
    if len(line) < RECORD_LENGTH or line[0] != "S" or line[4] != "P" or line[12] != STAR_RECORD_TYPE:
        return None
    if line[_CONTINUATION_COLUMN] not in _PRIMARY_CONTINUATION_NUMBERS:
        return None
    airport = line[AIRPORT_COLUMNS[0] : AIRPORT_COLUMNS[1]].strip()
    star_id = line[PROCEDURE_ID_COLUMNS[0] : PROCEDURE_ID_COLUMNS[1]].strip()
    if not airport or not star_id:
        return None
    return airport, star_id


def parse_star_ids(lines: Iterable[str]) -> dict[str, frozenset[str]]:
    """Return the STAR identifiers every airport in the CIFP publishes, keyed by ICAO identifier.

    Args:
        lines: CIFP lines in file order; trailing newlines are tolerated.

    Returns:
        The identifiers of the arrivals each airport publishes, e.g. ``{"KSEA": frozenset({"OLM2",
        ...}), ...}``. An airport with no arrival row is absent rather than mapped to an empty set,
        which is also how an airport the file does not carry at all comes back.
    """
    ids: dict[str, set[str]] = {}
    for raw in lines:
        record = parse_star_record(raw.rstrip("\r\n"))
        if record is not None:
            airport, star_id = record
            ids.setdefault(airport, set()).add(star_id)
    return {airport: frozenset(star_ids) for airport, star_ids in ids.items()}
