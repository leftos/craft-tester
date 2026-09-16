from craft_generator.cifp.airports import AirportRecord
from craft_generator.cifp.stars import parse_star_ids, parse_star_record

KSEA_ARRIVALS = frozenset({"CHINS5", "HAWKZ8", "MARNR8", "OLM2", "SKYKO1"})
SHARED_ARRIVAL = "OLM2"
SEATTLE_ONLY_ARRIVAL = "HAWKZ8"
CONTINUATION_NUMBER = "2"
CONTINUATION_COLUMN = 38


def _ksea_row(star_record_lines: list[str], star_id: str) -> str:
    return next(line for line in star_record_lines if line[6:10] == "KSEA" and line[13:19].strip() == star_id)


def test_seattle_publishes_exactly_its_five_arrivals(destination_stars: dict[str, frozenset[str]]) -> None:
    assert destination_stars["KSEA"] == KSEA_ARRIVALS


def test_an_identifier_loses_its_padding(star_record_lines: list[str]) -> None:
    row = _ksea_row(star_record_lines, SHARED_ARRIVAL)
    assert row[13:19] == "OLM2  "
    assert parse_star_record(row) == ("KSEA", SHARED_ARRIVAL)


def test_an_arrival_serving_two_airports_is_listed_under_both(destination_stars: dict[str, frozenset[str]]) -> None:
    assert SHARED_ARRIVAL in destination_stars["KSEA"]
    assert SHARED_ARRIVAL in destination_stars["KBFI"]


def test_boeing_field_does_not_publish_the_seattle_arrival(destination_stars: dict[str, frozenset[str]]) -> None:
    assert SEATTLE_ONLY_ARRIVAL in destination_stars["KSEA"]
    assert SEATTLE_ONLY_ARRIVAL not in destination_stars["KBFI"]


def test_a_foreign_destination_is_not_in_the_faa_file_at_all(
    destination_stars: dict[str, frozenset[str]], ksfo_airport_records: dict[str, AirportRecord]
) -> None:
    assert destination_stars.get("CYVR") is None
    assert "CYVR" not in ksfo_airport_records


def test_a_us_airport_publishing_no_arrival_is_absent_for_a_different_reason(
    destination_stars: dict[str, frozenset[str]], ksfo_airport_records: dict[str, AirportRecord]
) -> None:
    assert destination_stars.get("KLVK") is None
    assert "KLVK" in ksfo_airport_records


def test_a_three_letter_airport_publishing_no_arrival_is_absent_under_either_spelling(
    destination_stars: dict[str, frozenset[str]], ksfo_airport_records: dict[str, AirportRecord]
) -> None:
    assert destination_stars.get("O88") is None
    assert destination_stars.get("O88 ") is None
    assert "O88" in ksfo_airport_records


def test_rows_that_are_not_arrival_records_are_skipped(ksfo_lines: list[str]) -> None:
    sid_row = next(line for line in ksfo_lines if line[12] == "D")
    runway_row = next(line for line in ksfo_lines if line[12] == "G")
    assert parse_star_record(sid_row) is None
    assert parse_star_record(runway_row) is None
    assert parse_star_record("") is None
    assert parse_star_ids(ksfo_lines) == {}


def test_a_continuation_row_is_skipped(star_record_lines: list[str]) -> None:
    row = _ksea_row(star_record_lines, SHARED_ARRIVAL)
    continuation = row[:CONTINUATION_COLUMN] + CONTINUATION_NUMBER + row[CONTINUATION_COLUMN + 1 :]
    assert parse_star_record(row) is not None
    assert parse_star_record(continuation) is None
    assert parse_star_ids([continuation]) == {}
