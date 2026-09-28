import pytest

from craft_generator.cifp.airways import AirwayFix, CifpAirway, parse_airway_record, parse_airways

CONTINUATION_COLUMN = 38
FIX_SECTION_COLUMN = 36


def _row(airway_record_lines: list[str], airway_id: str, fix: str) -> str:
    return next(line for line in airway_record_lines if line[13:18].strip() == airway_id and line[29:34].strip() == fix)


def _fixes(stretch: tuple[AirwayFix, ...]) -> list[str]:
    return [fix.fix for fix in stretch]


def test_v6_ends_a_stretch_at_dpa_and_starts_the_next_at_psb(cifp_airways: dict[str, CifpAirway]) -> None:
    stretches = cifp_airways["V6"].stretches
    assert len(stretches) == 2
    assert (_fixes(stretches[0])[0], _fixes(stretches[0])[-1]) == ("OAK", "DPA")
    assert (_fixes(stretches[1])[0], _fixes(stretches[1])[-1]) == ("PSB", "LGA")
    assert sum(len(stretch) for stretch in stretches) == 98


def test_the_route_type_says_whether_an_airway_is_rnav(cifp_airways: dict[str, CifpAirway]) -> None:
    assert {airway_id: cifp_airways[airway_id].rnav for airway_id in ("V6", "J501", "Q1", "T257", "V137")} == {
        "V6": False,
        "J501": False,
        "Q1": True,
        "T257": True,
        "V137": False,
    }


def test_the_level_is_read_as_a_word(cifp_airways: dict[str, CifpAirway]) -> None:
    assert {airway_id: cifp_airways[airway_id].level for airway_id in ("V6", "J501", "Q1", "T257")} == {
        "V6": "low",
        "J501": "high",
        "Q1": "high",
        "T257": "low",
    }


def test_a_fix_carries_the_mea_maa_and_length_of_the_leg_it_starts(cifp_airways: dict[str, CifpAirway]) -> None:
    first, second = cifp_airways["J501"].stretches[0][:2]
    assert first == AirwayFix(fix="RZS", section="navaid", mea=18000, maa=45000, distance_nm=65.0)
    assert second == AirwayFix(fix="PEGRS", section="waypoint", mea=18000, maa=45000, distance_nm=12.7)


def test_the_last_fix_of_a_stretch_carries_no_leg(cifp_airways: dict[str, CifpAirway]) -> None:
    assert cifp_airways["J501"].stretches[-1][-1] == AirwayFix(fix="CYVIC", section="waypoint", mea=None, maa=None, distance_nm=None)


def test_an_unknown_mea_reads_as_none(airway_record_lines: list[str]) -> None:
    row = _row(airway_record_lines, "J108", "TCS")
    assert row[83:88] == "UNKNN"
    record = parse_airway_record(row)
    assert record is not None
    assert (record.fix.mea, record.fix.distance_nm) == (None, 89.0)


def test_a_continuation_row_is_skipped(airway_record_lines: list[str]) -> None:
    row = _row(airway_record_lines, "V137", "IPL")
    continuation = row[:CONTINUATION_COLUMN] + "2" + row[CONTINUATION_COLUMN + 1 :]
    assert parse_airway_record(row) is not None
    assert parse_airway_record(continuation) is None


def test_a_row_of_another_customer_area_is_ignored(airway_record_lines: list[str]) -> None:
    row = _row(airway_record_lines, "V137", "IPL")
    pacific = "SPAC" + row[4:]
    assert parse_airway_record(pacific) is None
    assert "V137" not in parse_airways([pacific])


def test_rows_out_of_sequence_order_are_sorted(airway_record_lines: list[str], cifp_airways: dict[str, CifpAirway]) -> None:
    v6 = [line for line in airway_record_lines if line[13:18].strip() == "V6"]
    assert parse_airways(reversed(v6))["V6"] == cifp_airways["V6"]


def test_a_fix_section_outside_the_layout_fails_naming_the_airway(airway_record_lines: list[str]) -> None:
    row = _row(airway_record_lines, "V137", "IPL")
    misaligned = row[:FIX_SECTION_COLUMN] + "X" + row[FIX_SECTION_COLUMN + 1 :]
    with pytest.raises(ValueError, match="airway V137 fix IPL"):
        parse_airway_record(misaligned)
