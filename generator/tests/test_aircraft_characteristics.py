import io
from datetime import date
from pathlib import Path

import pytest
from openpyxl import Workbook

from craft_generator.aircraft_characteristics import (
    AIRCRAFT_CHARACTERISTICS_URL,
    AircraftCharacteristic,
    load_aircraft_characteristics,
    parse_aircraft_characteristics,
    write_aircraft_characteristics,
)

HEADER = [
    "ICAO_Code",
    "FAA_Designator",
    "Manufacturer",
    "Model_FAA",
    "Physical_Class_Engine",
    "Num_Engines",
    "AAC",
    "AAC_minimum",
    "AAC_maximum",
    "Approach_Speed_knot",
    "MTOW_lb",
    "CWT",
    "ICAO_WTC",
    "LastUpdate",
]

ROWS: list[list[object]] = [
    ["A320", "A320", "AIRBUS", "Airbus A320", "Jet", 2, "C", None, None, 136, 171961, "D", "Medium", "2024-01-01"],
    [
        "DH8D",
        "DH8D",
        "DEHAVILLAND CANADA",
        "DeHavilland Canada 8/DHC8-400",
        "Turboprop",
        2,
        "C",
        None,
        None,
        125,
        64500.4,
        "F",
        "Medium",
        "2024-01-01",
    ],
    ["ZZZZ", "ZZZZ", "BELL", "Bell V-22 Osprey", "Turboshaft", 2, "N/A", None, None, "N/A", 60500, "H", "Medium", "2024-01-01"],
    ["A320", "A320", "AIRBUS", "Airbus A320 duplicate", "Jet", 2, "D", "C", "D", 150, 171961, "D", "Medium", "2024-01-01"],
]


def workbook_bytes(rows: list[list[object]], *, sheet_name: str = "ACD_Data") -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    sheet.title = sheet_name
    sheet.append(["FAA Aircraft Characteristics Database", "generated for the test"])
    sheet.append(HEADER)
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def test_every_column_of_a_row_is_read() -> None:
    table = parse_aircraft_characteristics(workbook_bytes(ROWS))
    assert table.aircraft["A320"] == AircraftCharacteristic(
        aac="C",
        aac_minimum=None,
        aac_maximum=None,
        approach_speed_knot=136,
        cwt="D",
        engine="Jet",
        engines=2,
        manufacturer="AIRBUS",
        model="Airbus A320",
        mtow_lb=171961,
        wtc="Medium",
    )
    assert table.aircraft["DH8D"].aac == "C"
    assert table.aircraft["DH8D"].cwt == "F"
    assert table.aircraft["DH8D"].engine == "Turboprop"
    assert table.aircraft["DH8D"].mtow_lb == 64500


def test_a_wake_category_outside_a_to_i_is_rejected() -> None:
    rows: list[list[object]] = [["A320", "A320", "AIRBUS", "Airbus A320", "Jet", 2, "C", None, None, 136, 171961, "Z", "Medium", "2024-01-01"]]
    with pytest.raises(ValueError, match=r"column CWT is 'Z', which is no consolidated wake turbulence category"):
        parse_aircraft_characteristics(workbook_bytes(rows))


def test_a_row_stating_no_wake_category_is_rejected() -> None:
    rows: list[list[object]] = [["A320", "A320", "AIRBUS", "Airbus A320", "Jet", 2, "C", None, None, 136, 171961, None, "Medium", "2024-01-01"]]
    with pytest.raises(ValueError, match=r"column CWT is '', which is no consolidated wake turbulence category"):
        parse_aircraft_characteristics(workbook_bytes(rows))


def test_a_type_the_faa_states_no_category_for_carries_none() -> None:
    table = parse_aircraft_characteristics(workbook_bytes(ROWS))
    assert table.aircraft["ZZZZ"].aac is None
    assert table.aircraft["ZZZZ"].approach_speed_knot is None


def test_a_designator_stated_twice_keeps_the_first_row_and_warns() -> None:
    table = parse_aircraft_characteristics(workbook_bytes(ROWS))
    assert table.aircraft["A320"].model == "Airbus A320"
    assert [warning for warning in table.warnings if warning.startswith("A320")] == [
        "A320 is stated twice; kept the first row, dropped AIRBUS Airbus A320 duplicate"
    ]


def test_a_workbook_without_the_data_sheet_is_rejected() -> None:
    with pytest.raises(ValueError, match=r"expected one named ACD_Data"):
        parse_aircraft_characteristics(workbook_bytes(ROWS, sheet_name="Data_Dictionary"))


def test_the_yaml_round_trips_through_write_and_load(tmp_path: Path) -> None:
    table = parse_aircraft_characteristics(workbook_bytes(ROWS))
    path = tmp_path / "faa_aircraft_characteristics.yaml"
    write_aircraft_characteristics(path, table.aircraft, source_url=AIRCRAFT_CHARACTERISTICS_URL, fetched_at=date(2026, 9, 16))
    text = path.read_text(encoding="utf-8")
    assert f"  url: {AIRCRAFT_CHARACTERISTICS_URL}" in text
    assert "  fetched_at: 2026-09-16" in text
    assert (
        "  A320: { aac: C, approach_speed_knot: 136, cwt: D, engine: Jet, engines: 2, manufacturer: AIRBUS, model: Airbus A320, mtow_lb: 171961,"
        in text
    )
    assert [line.split(":")[0].strip() for line in text.splitlines() if line.startswith("  ") and "{" in line] == ["A320", "DH8D", "ZZZZ"]
    assert load_aircraft_characteristics(path) == table.aircraft


def test_a_category_outside_a_to_e_fails_the_load(tmp_path: Path) -> None:
    path = tmp_path / "faa_aircraft_characteristics.yaml"
    path.write_text(
        "source:\n"
        f"  title: FAA Aircraft Characteristics Database\n  url: {AIRCRAFT_CHARACTERISTICS_URL}\n  fetched_at: 2026-09-16\n"
        "aircraft:\n"
        "  A320: { aac: Z, cwt: D, engine: Jet, engines: 2, manufacturer: AIRBUS, model: Airbus A320, wtc: Medium }\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"aircraft\[A320\]\.aac: 'Z' is not one of \['A', 'B', 'C', 'D', 'E'\]"):
        load_aircraft_characteristics(path)


def test_an_unknown_key_fails_the_load(tmp_path: Path) -> None:
    path = tmp_path / "faa_aircraft_characteristics.yaml"
    path.write_text(
        "source:\n"
        f"  title: FAA Aircraft Characteristics Database\n  url: {AIRCRAFT_CHARACTERISTICS_URL}\n  fetched_at: 2026-09-16\n"
        "aircraft:\n"
        "  A320: { aac: C, cwt: D, engine: Jet, engines: 2, manufacturer: AIRBUS, model: Airbus A320, wtc: Medium, span_ft: 117 }\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"unknown key\(s\) \['span_ft'\]"):
        load_aircraft_characteristics(path)
