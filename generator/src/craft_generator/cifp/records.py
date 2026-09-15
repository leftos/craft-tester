"""Fixed-width slicing of the ARINC 424 rows the trainer needs.

Layout verified against ``FAACIFP18`` from cycle 2609 (effective 2026-09-03), 210 KSFO SID rows and
8 KSFO runway rows, every row exactly 132 characters:

* SID (``PD``) rows: section ``S`` at ``[0]``, subsection ``P`` at ``[4]``, airport ``[6:10]``,
  record type ``D`` at ``[12]``, SID id ``[13:19]``, route type ``[19]``, transition ``[20:25]``,
  sequence ``[26:29]``, fix ``[29:34]``, path terminator ``[47:49]``, altitude description ``[82]``,
  altitude 1 ``[84:89]``, altitude 2 ``[89:94]``.
* Runway (``PG``) rows share the leading fields and carry the runway ident at ``[13:18]``
  (``RW01L``).

ARINC 424 puts the continuation record number at 1-based column 39, i.e. ``[38]``: ``0`` marks a row
with no continuation, ``1`` the first record of a continued set, and ``2`` upwards the continuation
rows themselves, which repeat the key fields with a different payload. All 210 KSFO SID rows in 2609
carry ``0``, so none are continuations today; rows outside ``{"0", "1"}`` are skipped so a future
cycle that adds continuation text cannot produce phantom legs.
"""

from collections.abc import Iterable
from dataclasses import dataclass

RECORD_LENGTH = 132
_CONTINUATION_COLUMN = 38
_PRIMARY_CONTINUATION_NUMBERS = frozenset({"0", "1"})


@dataclass(frozen=True, slots=True)
class SidRecord:
    """One leg of a SID as published in the CIFP."""

    sid_id: str
    route_type: str
    transition: str
    sequence: int
    fix: str
    path_terminator: str
    altitude_desc: str
    altitude1: str
    altitude2: str
    raw: str


@dataclass(frozen=True, slots=True)
class RunwayRecord:
    """One runway end of an airport as published in the CIFP."""

    ident: str
    raw: str

    @property
    def designator(self) -> str:
        """Return the runway without its ``RW`` prefix, e.g. ``01L`` for ``RW01L``."""
        return self.ident.removeprefix("RW")


def _is_airport_row(line: str, airport: str, record_type: str) -> bool:
    return len(line) >= RECORD_LENGTH and line[0] == "S" and line[4] == "P" and line[6:10] == airport and line[12] == record_type


def parse_sid_record(line: str, airport: str) -> SidRecord | None:
    """Parse one CIFP line into a :class:`SidRecord`.

    Args:
        line: A single CIFP line, without its newline.
        airport: Four-letter ICAO identifier the row must belong to, e.g. ``KSFO``.

    Returns:
        The parsed leg, or ``None`` when the line is not a primary SID row for ``airport``. Any
        input is accepted; nothing about a malformed line raises.
    """
    if not _is_airport_row(line, airport, "D"):
        return None
    if line[_CONTINUATION_COLUMN] not in _PRIMARY_CONTINUATION_NUMBERS:
        return None
    sequence = line[26:29].strip()
    if not sequence.isdigit():
        return None
    return SidRecord(
        sid_id=line[13:19].strip(),
        route_type=line[19],
        transition=line[20:25].strip(),
        sequence=int(sequence),
        fix=line[29:34].strip(),
        path_terminator=line[47:49].strip(),
        altitude_desc=line[82],
        altitude1=line[84:89].strip(),
        altitude2=line[89:94].strip(),
        raw=line,
    )


def parse_runway_record(line: str, airport: str) -> RunwayRecord | None:
    """Parse one CIFP line into a :class:`RunwayRecord`.

    Args:
        line: A single CIFP line, without its newline.
        airport: Four-letter ICAO identifier the row must belong to.

    Returns:
        The parsed runway, or ``None`` when the line is not a runway row for ``airport``. Any input
        is accepted; nothing about a malformed line raises.
    """
    if not _is_airport_row(line, airport, "G"):
        return None
    ident = line[13:18].strip()
    if not ident:
        return None
    return RunwayRecord(ident=ident, raw=line)


def parse_records(lines: Iterable[str], airport: str) -> tuple[tuple[SidRecord, ...], tuple[RunwayRecord, ...]]:
    """Split CIFP lines into the SID legs and runways of one airport.

    Args:
        lines: CIFP lines in file order; trailing newlines are tolerated.
        airport: Four-letter ICAO identifier to keep.

    Returns:
        The SID legs in file order and the runway records in file order.
    """
    sids: list[SidRecord] = []
    runways: list[RunwayRecord] = []
    for raw in lines:
        line = raw.rstrip("\r\n")
        sid_record = parse_sid_record(line, airport)
        if sid_record is not None:
            sids.append(sid_record)
            continue
        runway_record = parse_runway_record(line, airport)
        if runway_record is not None:
            runways.append(runway_record)
    return tuple(sids), tuple(runways)
