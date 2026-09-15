import pytest

from craft_generator.cifp.airports import parse_airport_coordinates, parse_airport_record
from craft_generator.sop.model import AirportInputs

KSFO_RECORD = "SUSAP KSFOK2ASFO     0     118YHN37370770W122223150E014000013         1800018000C    MNAR    SAN FRANCISCO INTL            141961513"
KSFO_TOLERANCE = 0.01


def test_ksfo_reference_point_is_where_the_airport_is(ksfo_coordinates: dict[str, tuple[float, float]]) -> None:
    latitude, longitude = ksfo_coordinates["KSFO"]
    assert latitude == pytest.approx(37.619, abs=KSFO_TOLERANCE)
    assert longitude == pytest.approx(-122.375, abs=KSFO_TOLERANCE)


def test_the_column_offsets_read_the_coordinate_fields() -> None:
    record = parse_airport_record(KSFO_RECORD)
    assert record is not None
    ident, latitude, longitude = record
    assert ident == "KSFO"
    assert (latitude, longitude) == (37.618806, -122.375417)


def test_a_three_letter_identifier_loses_its_padding(ksfo_coordinates: dict[str, tuple[float, float]]) -> None:
    assert "O88" in ksfo_coordinates
    assert "O88 " not in ksfo_coordinates


def test_the_southern_and_eastern_hemispheres_are_signed() -> None:
    southeast = KSFO_RECORD[:32] + "S37370770" + "E122223150" + KSFO_RECORD[51:]
    record = parse_airport_record(southeast)
    assert record is not None
    assert (record[1], record[2]) == (-37.618806, 122.375417)


def test_rows_that_are_not_airport_records_are_skipped(ksfo_lines: list[str]) -> None:
    assert parse_airport_coordinates(ksfo_lines) == {}
    assert parse_airport_record("") is None


def test_a_misaligned_coordinate_field_is_named() -> None:
    misaligned = KSFO_RECORD[:32] + "X37370770" + KSFO_RECORD[41:]
    with pytest.raises(ValueError, match="KSFO: latitude field"):
        parse_airport_record(misaligned)


def test_every_destination_without_hand_coordinates_has_a_record(
    ksfo_coordinates: dict[str, tuple[float, float]], ksfo_inputs: AirportInputs
) -> None:
    destinations = ksfo_inputs.routes.destinations
    wanted = [destination.icao for destination in destinations if destination.lat is None or destination.lon is None]
    assert wanted
    assert [icao for icao in wanted if icao not in ksfo_coordinates] == []
