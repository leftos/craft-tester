"""Airport reference points from the ARINC 424 airport (``PA``) rows of the CIFP.

Layout verified against ``FAACIFP18`` from cycle 2609 (effective 2026-09-03). The KSFO row reads::

    SUSAP KSFOK2ASFO     0     118YHN37370770W122223150E014000013   ...

Section ``S`` sits at ``[0]``, subsection ``P`` at ``[4]``, the airport identifier at ``[6:10]``
(blank-padded, so ``O88`` arrives as ``"O88 "``), and the record type ``A`` at ``[12]``. The
coordinates follow at ``[32:41]`` and ``[41:51]``: a hemisphere letter, then degrees, minutes,
seconds and hundredths of a second. ``N37370770`` is 37°37'07.70" = 37.618806 and ``W122223150`` is
122°22'31.50" = -122.375417, which is where the FAA puts San Francisco International - the same place
the plan quotes as "about N37.619, W122.375", so the offsets read the fields they are meant to.

Southern and western hemispheres come back negative, and every value is rounded to six decimal
places (about 0.1 m) so the emitted JSON carries a short number rather than the full binary expansion
of a division by 3600.
"""

from collections.abc import Iterable

AIRPORT_RECORD_TYPE = "A"
LATITUDE_COLUMNS = (32, 41)
LONGITUDE_COLUMNS = (41, 51)

_MINIMUM_LENGTH = LONGITUDE_COLUMNS[1]
_DEGREE_DIGITS = {"latitude": 2, "longitude": 3}
_COORDINATE_DIGITS = 6
_HEMISPHERE_SIGNS = {"N": 1.0, "S": -1.0, "E": 1.0, "W": -1.0}
_MINUTES_PER_DEGREE = 60
_SECONDS_PER_DEGREE = 3600
_HUNDREDTHS_PER_SECOND = 100
_DECIMAL_PLACES = 6


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


def parse_airport_record(line: str) -> tuple[str, float, float] | None:
    """Parse one CIFP line into an airport identifier and its reference point.

    Args:
        line: A single CIFP line, without its newline.

    Returns:
        The identifier, latitude and longitude in decimal degrees, or ``None`` when the line is not
        an airport reference-point row.

    Raises:
        ValueError: The line is an airport row whose coordinate fields are not hemisphere letters
            followed by digits, which means the record is misaligned.
    """
    if len(line) < _MINIMUM_LENGTH or line[0] != "S" or line[4] != "P" or line[12] != AIRPORT_RECORD_TYPE:
        return None
    ident = line[6:10].strip()
    if not ident:
        return None
    latitude = _decimal_degrees(line[LATITUDE_COLUMNS[0] : LATITUDE_COLUMNS[1]], "latitude", ident)
    longitude = _decimal_degrees(line[LONGITUDE_COLUMNS[0] : LONGITUDE_COLUMNS[1]], "longitude", ident)
    return ident, latitude, longitude


def parse_airport_coordinates(lines: Iterable[str]) -> dict[str, tuple[float, float]]:
    """Read every airport reference point out of the CIFP.

    Args:
        lines: CIFP lines in file order; trailing newlines are tolerated.

    Returns:
        The latitude and longitude in decimal degrees of every airport the file carries, keyed by
        identifier. South and west are negative.

    Raises:
        ValueError: An airport row carries coordinate fields the parser cannot read.
    """
    coordinates: dict[str, tuple[float, float]] = {}
    for raw in lines:
        record = parse_airport_record(raw.rstrip("\r\n"))
        if record is not None:
            ident, latitude, longitude = record
            coordinates[ident] = (latitude, longitude)
    return coordinates
