"""Waypoint types from the ARINC 424 enroute and terminal waypoint rows of the CIFP.

Layout verified against ``FAACIFP18`` from cycle 2609 (effective 2026-09-03), 32,457 enroute and
37,628 terminal rows, every row exactly 132 characters. The NTELL enroute row reads::

    SUSAEAENRT   NTELL K20    W   B N36535899W119532221    ...    NARNTELL ...

and the Oakland terminal row of AAAME::

    SUSAP KOAKK2CAAAME K20    W     N37461527W122045812    ...    NARAAAME ...

Record type ``S`` sits at ``[0]`` and the customer area at ``[1:4]``. An enroute waypoint carries
section ``E`` at ``[4]`` and subsection ``A`` at ``[5]``; a terminal waypoint carries section ``P``
at ``[4]``, the airport it belongs to at ``[6:10]`` and subsection ``C`` at ``[12]``. From the
identifier on, the two records line up: the identifier at ``[13:18]``, the region code at
``[19:21]``, the continuation number at ``[21]`` and the waypoint type at ``[26:29]``.

The first character of the waypoint type is the one the trainer reads: ``W`` an RNAV waypoint, ``C``
a combined named intersection and RNAV waypoint, ``R`` a named intersection, ``I`` an unnamed
charted intersection, ``N`` an NDB used as a waypoint and ``V`` a VFR waypoint. Only a ``W`` fix is
RNAV-only, so only a ``W`` fix needs RNAV capability of the aircraft that files it.

The file is read whole, with no customer-area filter, as the navaid parser reads it: ALANN, ALLBE
and ALCOA are filed on Bay Area routes and published under the ``PAC`` area alone. The Pacific grid
waypoints (``SPACEAENRT   KL09G P 0     W``) are the one row shape that does not line up, carrying
their type a column further right, which leaves the first character of ``[26:29]`` blank; all 991 of
them are skipped, and every one of their identifiers carries a digit, so no route the trainer grades
names one. No two enroute rows of the 2609 cycle disagree on the type of an identifier, so the first
row of the file wins. An identifier published both ways resolves to its enroute row, because an
enroute record states the type of the fix itself while a terminal record states how the procedures
of one airport use it.
"""

from collections.abc import Iterable

RECORD_LENGTH = 132
ENROUTE_SECTION = "E"
ENROUTE_SUBSECTION = "A"
TERMINAL_SECTION = "P"
TERMINAL_SUBSECTION = "C"
IDENT_COLUMNS = (13, 18)
TYPE_COLUMNS = (26, 29)

RNAV_WAYPOINT = "W"

_CONTINUATION_COLUMN = 21
_PRIMARY_CONTINUATION_NUMBERS = frozenset({"0", "1"})
_ENROUTE_SUBSECTION_COLUMN = 5
_TERMINAL_SUBSECTION_COLUMN = 12


def _section_of(line: str) -> str | None:
    if line[4] == ENROUTE_SECTION and line[_ENROUTE_SUBSECTION_COLUMN] == ENROUTE_SUBSECTION:
        return ENROUTE_SECTION
    if line[4] == TERMINAL_SECTION and line[_TERMINAL_SUBSECTION_COLUMN] == TERMINAL_SUBSECTION:
        return TERMINAL_SECTION
    return None


def _waypoint_record(line: str) -> tuple[str, str, str] | None:
    """Parse one CIFP line into its identifier, waypoint type letter and section code.

    Args:
        line: A single CIFP line, without its newline.

    Returns:
        The identifier, the first character of the waypoint type and the section code the row was
        read under, or ``None`` when the line is not a waypoint row or publishes no identifier or no
        type. Continuation records are skipped, because the columns this reads as the type carry
        other fields there. Any input is accepted; nothing about a malformed line raises.
    """
    if len(line) < RECORD_LENGTH or line[0] != "S":
        return None
    section = _section_of(line)
    if section is None or line[_CONTINUATION_COLUMN] not in _PRIMARY_CONTINUATION_NUMBERS:
        return None
    ident = line[IDENT_COLUMNS[0] : IDENT_COLUMNS[1]].strip()
    kind = line[TYPE_COLUMNS[0] : TYPE_COLUMNS[1]][:1]
    if not ident or not kind.strip():
        return None
    return ident, kind, section


def parse_waypoints(lines: Iterable[str]) -> dict[str, str]:
    """Read the waypoint type of every fix the CIFP publishes, keyed by identifier.

    Args:
        lines: CIFP lines in file order; trailing newlines are tolerated.

    Returns:
        One type letter per identifier - ``W`` for an RNAV waypoint, ``C``, ``R``, ``I``, ``N`` or
        ``V`` for the other kinds. An identifier published as both an enroute and a terminal
        waypoint reads as its enroute row.
    """
    enroute: dict[str, str] = {}
    terminal: dict[str, str] = {}
    for raw in lines:
        record = _waypoint_record(raw.rstrip("\r\n"))
        if record is None:
            continue
        ident, kind, section = record
        table = enroute if section == ENROUTE_SECTION else terminal
        table.setdefault(ident, kind)
    return {**terminal, **enroute}
