import pytest

from craft_generator.cifp.airports import AirportRecord, parse_airport_record, parse_airport_records
from craft_generator.sop.model import AirportInputs

KSFO_RECORD = "SUSAP KSFOK2ASFO     0     118YHN37370770W122223150E014000013         1800018000C    MNAR    SAN FRANCISCO INTL            141961513"
KSFO_TOLERANCE = 0.01
KSFO_MAGNETIC_VARIATION = 14.0
WESTERLY_VARIATION = -10.0

CONTINUATION_COLUMN = 21
PRIMARY_CONTINUATION_NUMBERS = frozenset({"0", "1"})
LIMITATION_APPLICATION = "L"
COORDINATE_COLUMNS = (32, 56)


def _continuation_of(primary: str) -> str:
    """Return the primary row rewritten as a limitation continuation record whose coordinate columns hold letters."""
    letters = "X" * (COORDINATE_COLUMNS[1] - COORDINATE_COLUMNS[0])
    head = primary[:CONTINUATION_COLUMN] + "2" + LIMITATION_APPLICATION
    return head + primary[CONTINUATION_COLUMN + 2 : COORDINATE_COLUMNS[0]] + letters + primary[COORDINATE_COLUMNS[1] :]


def test_ksfo_reference_point_is_where_the_airport_is(ksfo_airport_records: dict[str, AirportRecord]) -> None:
    record = ksfo_airport_records["KSFO"]
    assert record.latitude == pytest.approx(37.619, abs=KSFO_TOLERANCE)
    assert record.longitude == pytest.approx(-122.375, abs=KSFO_TOLERANCE)


def test_the_column_offsets_read_the_coordinate_fields() -> None:
    record = parse_airport_record(KSFO_RECORD)
    assert record is not None
    assert record.ident == "KSFO"
    assert (record.latitude, record.longitude) == (37.618806, -122.375417)
    assert record.magnetic_variation == KSFO_MAGNETIC_VARIATION


def test_a_three_letter_identifier_loses_its_padding(ksfo_airport_records: dict[str, AirportRecord]) -> None:
    assert "O88" in ksfo_airport_records
    assert "O88 " not in ksfo_airport_records


def test_the_southern_and_eastern_hemispheres_are_signed() -> None:
    southeast = KSFO_RECORD[:32] + "S37370770" + "E122223150" + KSFO_RECORD[51:]
    record = parse_airport_record(southeast)
    assert record is not None
    assert (record.latitude, record.longitude) == (-37.618806, 122.375417)


def test_a_westerly_variation_is_negative_and_true_north_is_none_at_all() -> None:
    westerly = parse_airport_record(KSFO_RECORD[:51] + "W0100" + KSFO_RECORD[56:])
    true_north = parse_airport_record(KSFO_RECORD[:51] + "T0000" + KSFO_RECORD[56:])
    assert westerly is not None
    assert true_north is not None
    assert westerly.magnetic_variation == WESTERLY_VARIATION
    assert true_north.magnetic_variation == 0.0


def test_rows_that_are_not_airport_records_are_skipped(ksfo_lines: list[str]) -> None:
    assert parse_airport_records(ksfo_lines) == {}
    assert parse_airport_record("") is None


def test_a_misaligned_coordinate_field_is_named() -> None:
    misaligned = KSFO_RECORD[:32] + "X37370770" + KSFO_RECORD[41:]
    with pytest.raises(ValueError, match="KSFO: latitude field"):
        parse_airport_record(misaligned)


def test_a_misaligned_variation_field_is_named() -> None:
    misaligned = KSFO_RECORD[:51] + "X0140" + KSFO_RECORD[56:]
    with pytest.raises(ValueError, match="KSFO: magnetic variation field"):
        parse_airport_record(misaligned)


def test_a_continuation_record_is_not_a_reference_point() -> None:
    assert parse_airport_record(_continuation_of(KSFO_RECORD)) is None


def test_a_continuation_record_does_not_overwrite_the_reference_point_it_continues() -> None:
    record = parse_airport_records([KSFO_RECORD, _continuation_of(KSFO_RECORD)])["KSFO"]
    assert (record.latitude, record.longitude) == (37.618806, -122.375417)
    assert record.magnetic_variation == KSFO_MAGNETIC_VARIATION


def test_every_checked_in_airport_row_is_a_primary_record(airport_record_lines: list[str]) -> None:
    continuations = [line[:CONTINUATION_COLUMN] for line in airport_record_lines if line[CONTINUATION_COLUMN] not in PRIMARY_CONTINUATION_NUMBERS]
    assert continuations == []


def test_every_destination_without_hand_coordinates_has_a_record(ksfo_airport_records: dict[str, AirportRecord], ksfo_inputs: AirportInputs) -> None:
    destinations = ksfo_inputs.routes.destinations
    wanted = [destination.icao for destination in destinations if destination.lat is None or destination.lon is None]
    assert wanted
    assert [icao for icao in wanted if icao not in ksfo_airport_records] == []
