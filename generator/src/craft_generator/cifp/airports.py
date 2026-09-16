"""Airport reference points from the ARINC 424 airport (``PA``) rows of the CIFP.

Layout verified against ``FAACIFP18`` from cycle 2609 (effective 2026-09-03). The KSFO row reads::

    SUSAP KSFOK2ASFO     0     118YHN37370770W122223150E014000013   ...

Section ``S`` sits at ``[0]``, subsection ``P`` at ``[4]``, the airport identifier at ``[6:10]``
(blank-padded, so ``O88`` arrives as ``"O88 "``), and the record type ``A`` at ``[12]``. The
coordinates follow at ``[32:41]`` and ``[41:51]``: a hemisphere letter, then degrees, minutes,
seconds and hundredths of a second. ``N37370770`` is 37°37'07.70" = 37.618806 and ``W122223150`` is
122°22'31.50" = -122.375417, which is where the FAA puts San Francisco International - the same place
the plan quotes as "about N37.619, W122.375", so the offsets read the fields they are meant to. The
magnetic variation follows the longitude at ``[51:56]``: a direction letter, then degrees and tenths
of a degree, so ``E0140`` is 14.0° east. ``T`` marks a station referenced to true north, used near
the poles, and reads as no variation at all.

Southern and western hemispheres come back negative, a westerly variation comes back negative, and
every coordinate is rounded to six decimal places (about 0.1 m) so the emitted JSON carries a short
number rather than the full binary expansion of a division by 3600.
"""

from collections.abc import Iterable
from dataclasses import dataclass

AIRPORT_RECORD_TYPE = "A"
LATITUDE_COLUMNS = (32, 41)
LONGITUDE_COLUMNS = (41, 51)
MAGNETIC_VARIATION_COLUMNS = (51, 56)

_MINIMUM_LENGTH = MAGNETIC_VARIATION_COLUMNS[1]
_CONTINUATION_COLUMN = 21
_PRIMARY_CONTINUATION_NUMBERS = frozenset({"0", "1"})
_DEGREE_DIGITS = {"latitude": 2, "longitude": 3}
_COORDINATE_DIGITS = 6
_HEMISPHERE_SIGNS = {"N": 1.0, "S": -1.0, "E": 1.0, "W": -1.0}
_MINUTES_PER_DEGREE = 60
_SECONDS_PER_DEGREE = 3600
_HUNDREDTHS_PER_SECOND = 100
_DECIMAL_PLACES = 6
_TRUE_NORTH_LETTER = "T"
_VARIATION_SIGNS = {"E": 1.0, "W": -1.0}
_VARIATION_DIGITS = 4
_TENTHS_PER_DEGREE = 10


@dataclass(frozen=True, slots=True)
class AirportRecord:
    """One airport reference point of the CIFP: where the airport is, and how far magnetic north is off true.

    ``magnetic_variation`` is in degrees, east positive, so a magnetic course is the true course less
    the variation.
    """

    ident: str
    latitude: float
    longitude: float
    magnetic_variation: float


def _decimal_degrees(field: str, kind: str, where: str) -> float:
    degree_digits = _DEGREE_DIGITS[kind]
    sign = _HEMISPHERE_SIGNS.get(field[:1])
    digits = field[1:]
    if sign is None or len(digits) != degree_digits + _COORDINATE_DIGITS or not digits.isdigit():
        raise ValueError(
            f"{where}: {kind} field {field!r} is not a hemisphere letter followed by "
            f"{degree_digits + _COORDINATE_DIGITS} digits of degrees, minutes, seconds and hundredths; the CIFP row may be misaligned"
        )
    degrees = int(digits[:degree_digits])
    minutes = int(digits[degree_digits : degree_digits + 2])
    seconds = int(digits[degree_digits + 2 : degree_digits + 4])
    hundredths = int(digits[degree_digits + 4 :])
    total = degrees + minutes / _MINUTES_PER_DEGREE + (seconds + hundredths / _HUNDREDTHS_PER_SECOND) / _SECONDS_PER_DEGREE
    return round(sign * total, _DECIMAL_PLACES)


def _magnetic_variation(field: str, where: str) -> float:
    letter, digits = field[:1], field[1:]
    sign = _VARIATION_SIGNS.get(letter)
    known = sign is not None or letter == _TRUE_NORTH_LETTER
    if not known or len(digits) != _VARIATION_DIGITS or not digits.isdigit():
        raise ValueError(
            f"{where}: magnetic variation field {field!r} is not an E, W or T followed by "
            f"{_VARIATION_DIGITS} digits of degrees and tenths of a degree; the CIFP row may be misaligned"
        )
    if sign is None:
        return 0.0
    return round(sign * int(digits) / _TENTHS_PER_DEGREE, _DECIMAL_PLACES)


def parse_airport_record(line: str) -> AirportRecord | None:
    """Parse one CIFP line into an airport identifier, its reference point and its magnetic variation.

    Args:
        line: A single CIFP line, without its newline.

    Returns:
        The record, or ``None`` when the line is not an airport reference-point row. Continuation
        records are skipped, because the columns this reads as the coordinates carry other fields
        there.

    Raises:
        ValueError: The line is an airport row whose coordinate fields are not hemisphere letters
            followed by digits, or whose variation field is not a direction letter followed by
            digits, which means the record is misaligned.
    """
    if len(line) < _MINIMUM_LENGTH or line[0] != "S" or line[4] != "P" or line[12] != AIRPORT_RECORD_TYPE:
        return None
    if line[_CONTINUATION_COLUMN] not in _PRIMARY_CONTINUATION_NUMBERS:
        return None
    ident = line[6:10].strip()
    if not ident:
        return None
    return AirportRecord(
        ident=ident,
        latitude=_decimal_degrees(line[LATITUDE_COLUMNS[0] : LATITUDE_COLUMNS[1]], "latitude", ident),
        longitude=_decimal_degrees(line[LONGITUDE_COLUMNS[0] : LONGITUDE_COLUMNS[1]], "longitude", ident),
        magnetic_variation=_magnetic_variation(line[MAGNETIC_VARIATION_COLUMNS[0] : MAGNETIC_VARIATION_COLUMNS[1]], ident),
    )


def parse_airport_records(lines: Iterable[str]) -> dict[str, AirportRecord]:
    """Read every airport reference point out of the CIFP.

    Args:
        lines: CIFP lines in file order; trailing newlines are tolerated.

    Returns:
        The record of every airport the file carries, keyed by identifier. South, west and a
        westerly magnetic variation are negative.

    Raises:
        ValueError: An airport row carries coordinate or variation fields the parser cannot read.
    """
    records: dict[str, AirportRecord] = {}
    for raw in lines:
        record = parse_airport_record(raw.rstrip("\r\n"))
        if record is not None:
            records[record.ident] = record
    return records
