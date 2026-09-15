from craft_generator.cifp.navaids import Navaid, parse_navaid_record, parse_navaids


def test_the_class_field_names_the_facility(ksfo_navaids: dict[str, Navaid]) -> None:
    kinds = {ident: ksfo_navaids[ident].kind for ident in ("RBL", "SAC", "OAK", "CCR", "PWE", "ST")}
    assert kinds == {"RBL": "VORTAC", "SAC": "VORTAC", "OAK": "VOR/DME", "CCR": "VOR/DME", "PWE": "DME", "ST": "NDB"}


def test_every_vor_based_facility_is_spoken_as_a_vor(ksfo_navaids: dict[str, Navaid]) -> None:
    spoken = {ident: ksfo_navaids[ident].spoken for ident in ("RBL", "SAC", "OAK", "PWE", "ST")}
    assert spoken == {
        "RBL": "Red Bluff VOR",
        "SAC": "Sacramento VOR",
        "OAK": "Oakland VOR",
        "PWE": "Pawnee City DME",
        "ST": "Hussk NDB",
    }


def test_names_are_title_cased_word_by_word(ksfo_navaids: dict[str, Navaid]) -> None:
    assert ksfo_navaids["LMT"].name == "Klamath Falls"
    assert ksfo_navaids["MCK"].name == "Mc Cook"


def test_the_cycle_renamed_squaw_valley(ksfo_navaids: dict[str, Navaid]) -> None:
    assert ksfo_navaids["SWR"].spoken == "Palisades VOR"


def test_alaska_and_canada_are_read_although_the_faa_files_them_outside_the_usa_area(ksfo_navaids: dict[str, Navaid]) -> None:
    assert ksfo_navaids["ANN"].spoken == "Annette Island VOR"
    assert ksfo_navaids["YZT"].spoken == "Port Hardy VOR"


def test_a_us_region_wins_a_shared_identifier(ksfo_navaids: dict[str, Navaid]) -> None:
    assert ksfo_navaids["ST"].name == "Hussk"


def test_the_vhf_record_wins_when_the_two_records_share_a_name(ksfo_navaids: dict[str, Navaid]) -> None:
    assert (ksfo_navaids["HLE"].name, ksfo_navaids["HLE"].kind) == ("Hailey", "DME")
    assert (ksfo_navaids["NEL"].name, ksfo_navaids["NEL"].kind) == ("Lakehurst", "TACAN")


def test_an_identifier_two_navaids_name_differently_is_dropped(ksfo_navaids: dict[str, Navaid]) -> None:
    assert "AA" not in ksfo_navaids


def test_a_line_that_is_not_a_navaid_row_is_ignored(ksfo_lines: list[str]) -> None:
    assert parse_navaid_record("") is None
    assert parse_navaid_record("S" + "X" * 131) is None
    assert parse_navaids(ksfo_lines) == {}
