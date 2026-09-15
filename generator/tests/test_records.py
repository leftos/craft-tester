import string

from hypothesis import given
from hypothesis import strategies as st

from craft_generator.cifp.records import RECORD_LENGTH, RunwayRecord, SidRecord, parse_records, parse_runway_record, parse_sid_record

SAMPLE = "SUSAP KSFOK2DCIITY34RW10L 040CIITYK2PC0EE      TF                                 + 05000                                  143071509"
RUNWAY_SAMPLE = "SUSAP KSFOK2GRW01L   0076500140 N37363403W122225483         -0029400010064050200D                                          149261707"


def test_sample_row_slices() -> None:
    record = parse_sid_record(SAMPLE, "KSFO")
    assert record == SidRecord(
        sid_id="CIITY3",
        route_type="4",
        transition="RW10L",
        sequence=40,
        fix="CIITY",
        path_terminator="TF",
        altitude_desc="+",
        altitude1="05000",
        altitude2="",
        raw=SAMPLE,
    )


def test_initial_climb_leg_keeps_its_blank_fix() -> None:
    line = SAMPLE[:29] + "     " + SAMPLE[34:47] + "VA" + SAMPLE[49:]
    record = parse_sid_record(line, "KSFO")
    assert record is not None
    assert (record.fix, record.path_terminator) == ("", "VA")


def test_other_airports_and_record_types_are_skipped() -> None:
    assert parse_sid_record(SAMPLE, "KOAK") is None
    assert parse_runway_record(SAMPLE, "KSFO") is None
    assert parse_sid_record(RUNWAY_SAMPLE, "KSFO") is None


def test_runway_row_slices() -> None:
    record = parse_runway_record(RUNWAY_SAMPLE, "KSFO")
    assert record == RunwayRecord(ident="RW01L", raw=RUNWAY_SAMPLE)
    assert record.designator == "01L"


def test_continuation_rows_are_skipped() -> None:
    continuation = SAMPLE[:38] + "2" + SAMPLE[39:]
    assert parse_sid_record(continuation, "KSFO") is None
    assert parse_sid_record(SAMPLE[:38] + "1" + SAMPLE[39:], "KSFO") is not None


def test_short_lines_return_none() -> None:
    assert parse_sid_record("", "KSFO") is None
    assert parse_sid_record(SAMPLE[:100], "KSFO") is None
    assert parse_runway_record(RUNWAY_SAMPLE[:100], "KSFO") is None


def test_non_numeric_sequence_returns_none() -> None:
    assert parse_sid_record(SAMPLE[:26] + "XXX" + SAMPLE[29:], "KSFO") is None


def test_fixture_splits_into_sid_legs_and_runways(ksfo_records: tuple[tuple[SidRecord, ...], tuple[RunwayRecord, ...]]) -> None:
    legs, runways = ksfo_records
    assert len(legs) == 210
    assert [runway.designator for runway in runways] == ["01L", "01R", "10L", "10R", "19L", "19R", "28L", "28R"]
    assert {leg.route_type for leg in legs} == {"1", "3", "4", "6", "T", "V"}
    assert all(len(leg.raw) == RECORD_LENGTH for leg in legs)


def test_fixture_sid_rows_all_carry_continuation_zero(ksfo_lines: list[str]) -> None:
    assert {line[38] for line in ksfo_lines if line[12] == "D"} == {"0"}


@given(st.text(alphabet=string.printable, min_size=RECORD_LENGTH, max_size=RECORD_LENGTH))
def test_any_fixed_width_line_parses_or_returns_none(line: str) -> None:
    assert parse_sid_record(line, "KSFO") is None or isinstance(parse_sid_record(line, "KSFO"), SidRecord)
    assert parse_runway_record(line, "KSFO") is None or isinstance(parse_runway_record(line, "KSFO"), RunwayRecord)


@given(st.integers(min_value=0, max_value=RECORD_LENGTH - 1), st.text(alphabet=string.printable, min_size=1, max_size=4))
def test_mutating_a_real_row_never_raises(index: int, replacement: str) -> None:
    line = SAMPLE[:index] + replacement + SAMPLE[index + len(replacement) :]
    parse_sid_record(line, "KSFO")
    parse_runway_record(line, "KSFO")


@given(st.lists(st.text(alphabet=string.printable, max_size=200), max_size=20))
def test_parse_records_never_raises(lines: list[str]) -> None:
    legs, runways = parse_records(lines, "KSFO")
    assert isinstance(legs, tuple)
    assert isinstance(runways, tuple)
