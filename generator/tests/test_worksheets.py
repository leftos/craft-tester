from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest

from craft_generator.emit import fixture_schema_path, validate
from craft_generator.sop.load import WORKSHEETS_FILE, airport_dir, load_worksheets
from craft_generator.sop.model import AircraftClass, AirportInputs, EquipmentSuffix, Worksheet, WorksheetConfig
from craft_generator.worksheets import (
    Fixture,
    PlanRow,
    designator_classes,
    fetch_worksheet_text,
    parse_amendment_sheet,
    parse_phraseology_sheet,
    parse_worksheet,
    rnav_suffixes,
    sheet_fixtures,
    slug,
)

WORKSHEET_TEXT = Path(__file__).parent / "fixtures" / "worksheets"

PLAN_COUNTS = {
    "Phraseology Practice 1A": 6,
    "Phraseology Practice 2": 6,
    "Phraseology Practice 3": 6,
    "Amendment Practice 1A": 13,
    "Amendment Practice 1C": 13,
    "Amendment Practice 2": 13,
    "Amendment Practice 3": 13,
}
FIXTURE_COUNT = 70
AMENDMENT_ALTITUDE_FEET = 32000
PLAIN_ALTITUDE_FEET = 19000
FIRST_PLAN = PlanRow(
    callsign="UAL320",
    designator="A320",
    suffix="/L",
    departure="KSFO",
    destination="KSEA",
    altitude_feet=32000,
    squawk="3342",
    route="TRUKN2 DEDHD RBL LMT HAWKZ7",
    truncated=False,
)
FIRST_FIXTURE = {
    "id": "ws-phraseology-practice-1a-ual320",
    "source": {
        "kind": "worksheet",
        "note": "Phraseology Practice 1A; the sheet states no departure runway, so this is 01R, "
        "the runway configuration 28/01 departs north per direction_runway_preference, pending validation",
    },
    "status": "pending",
    "airport": "KSFO",
    "scenario": {
        "callsign": "UAL320",
        "aircraftType": "A320",
        "rnavCapable": True,
        "destination": "KSEA",
        "filedRoute": "TRUKN2 DEDHD RBL LMT HAWKZ7",
        "filedAltitude": 32000,
        "runwayConfigId": "28/01",
        "departureRunway": "01R",
        "localTime": "1400",
        "dayOfWeek": "tuesday",
        "squawk": "3342",
    },
}
AMENDMENT_SQUAWKS = ["4601", "4602", "4603", "4604", "4605", "4606", "4607", "4610", "4611", "4612", "4613", "4614", "4615"]


@pytest.fixture(scope="module")
def worksheet_config() -> WorksheetConfig:
    return load_worksheets(airport_dir("KSFO") / WORKSHEETS_FILE)


@pytest.fixture(scope="module")
def worksheets(worksheet_config: WorksheetConfig) -> tuple[Worksheet, ...]:
    return worksheet_config.worksheets


@pytest.fixture(scope="module")
def by_title(worksheets: tuple[Worksheet, ...]) -> dict[str, Worksheet]:
    return {worksheet.title: worksheet for worksheet in worksheets}


@pytest.fixture(scope="module")
def aircraft_classes(aircraft_specs_subset: list[dict[str, Any]], worksheet_config: WorksheetConfig) -> dict[str, AircraftClass]:
    return designator_classes(aircraft_specs_subset, worksheet_config.type_aliases)


def sheet_text(worksheet: Worksheet) -> str:
    """Return the checked-in text export of one worksheet."""
    return (WORKSHEET_TEXT / f"{slug(worksheet.title)}.txt").read_text(encoding="utf-8")


def rows_of(by_title: dict[str, Worksheet], title: str) -> list[PlanRow]:
    """Return the plans of one worksheet, parsed from its checked-in text."""
    worksheet = by_title[title]
    return parse_worksheet(worksheet, sheet_text(worksheet))


def row_of(by_title: dict[str, Worksheet], title: str, callsign: str) -> PlanRow:
    """Return one plan of one worksheet by callsign."""
    return next(row for row in rows_of(by_title, title) if row.callsign == callsign)


def sheet_of(
    worksheet: Worksheet,
    inputs: AirportInputs,
    suffixes: tuple[EquipmentSuffix, ...],
    aliases: Mapping[str, str],
    classes: Mapping[str, AircraftClass],
) -> dict[Path, Fixture]:
    """Return the fixtures of one worksheet, built from its checked-in text."""
    return sheet_fixtures(
        worksheet,
        sheet_text(worksheet),
        icao=inputs.icao,
        sop=inputs.sop,
        rnav=rnav_suffixes(suffixes),
        type_aliases=aliases,
        aircraft_classes=classes,
    )


def fixture_of(fixtures: dict[Path, Fixture], callsign: str) -> Fixture:
    """Return the fixture of one plan of a sheet by callsign."""
    return next(fixture for fixture in fixtures.values() if fixture["scenario"]["callsign"] == callsign)


def all_fixtures(
    config: WorksheetConfig, inputs: AirportInputs, suffixes: tuple[EquipmentSuffix, ...], classes: Mapping[str, AircraftClass]
) -> dict[Path, Fixture]:
    """Return the fixture of every plan on every worksheet, keyed by the file it is written to."""
    fixtures: dict[Path, Fixture] = {}
    for worksheet in config.worksheets:
        fixtures.update(sheet_of(worksheet, inputs, suffixes, config.type_aliases, classes))
    return fixtures


def test_every_sheet_parses_to_the_plans_it_prints(worksheets: tuple[Worksheet, ...]) -> None:
    assert {worksheet.title: len(parse_worksheet(worksheet, sheet_text(worksheet))) for worksheet in worksheets} == PLAN_COUNTS


def test_a_phraseology_plan_carries_every_filed_field(by_title: dict[str, Worksheet]) -> None:
    rows = parse_phraseology_sheet(sheet_text(by_title["Phraseology Practice 1A"]), "Phraseology Practice 1A")
    assert len(rows) == PLAN_COUNTS["Phraseology Practice 1A"]
    assert rows[0] == FIRST_PLAN


def test_an_amendment_table_becomes_one_row_per_plan(by_title: dict[str, Worksheet]) -> None:
    rows = parse_amendment_sheet(sheet_text(by_title["Amendment Practice 1A"]), "Amendment Practice 1A")
    assert len(rows) == PLAN_COUNTS["Amendment Practice 1A"]
    assert rows[0] == PlanRow(
        callsign="N238JP",
        designator="C55B",
        suffix="/L",
        departure=None,
        destination="KJAC",
        altitude_feet=AMENDMENT_ALTITUDE_FEET,
        squawk=None,
        route="TRUKN2 ORRCA Q120 GALLI PARZZ TUVOC LEIDY DNW",
        truncated=False,
    )


def test_a_weight_prefix_is_dropped_and_a_cut_off_route_is_flagged(by_title: dict[str, Worksheet]) -> None:
    row = row_of(by_title, "Amendment Practice 1A", "KAL65")
    assert (row.designator, row.suffix, row.truncated) == ("B77L", "/L", True)
    assert row.route.endswith("(continued)")


def test_a_plan_keeps_its_suffix_and_its_altitude_in_feet(by_title: dict[str, Worksheet]) -> None:
    assert row_of(by_title, "Amendment Practice 1A", "N172SP").suffix == "/G"
    assert row_of(by_title, "Amendment Practice 1A", "SKW2345").altitude_feet == PLAIN_ALTITUDE_FEET


def test_a_plan_filed_without_a_suffix_is_not_rnav_capable(
    by_title: dict[str, Worksheet],
    ksfo_inputs: AirportInputs,
    equipment_suffixes: tuple[EquipmentSuffix, ...],
    aircraft_classes: dict[str, AircraftClass],
) -> None:
    fixtures = sheet_of(by_title["Amendment Practice 2"], ksfo_inputs, equipment_suffixes, {}, aircraft_classes)
    scenario = fixture_of(fixtures, "JSX203")["scenario"]
    assert (scenario["aircraftType"], scenario["rnavCapable"]) == ("E135", False)
    assert row_of(by_title, "Amendment Practice 2", "JSX203").suffix is None


def test_a_sheet_that_prints_no_squawk_numbers_them_in_octal(
    by_title: dict[str, Worksheet],
    ksfo_inputs: AirportInputs,
    equipment_suffixes: tuple[EquipmentSuffix, ...],
    aircraft_classes: dict[str, AircraftClass],
) -> None:
    fixtures = sheet_of(by_title["Amendment Practice 1A"], ksfo_inputs, equipment_suffixes, {}, aircraft_classes)
    assert [fixture["scenario"]["squawk"] for fixture in fixtures.values()] == AMENDMENT_SQUAWKS


def test_northbound_plan_departs_the_right_turn_runway(
    by_title: dict[str, Worksheet],
    ksfo_inputs: AirportInputs,
    equipment_suffixes: tuple[EquipmentSuffix, ...],
    aircraft_classes: dict[str, AircraftClass],
) -> None:
    fixtures = sheet_of(by_title["Phraseology Practice 1A"], ksfo_inputs, equipment_suffixes, {}, aircraft_classes)
    scenario = fixture_of(fixtures, "UAL320")["scenario"]
    assert scenario["filedRoute"].startswith("TRUKN2 DEDHD ")
    assert (scenario["runwayConfigId"], scenario["departureRunway"]) == ("28/01", "01R")


def test_southbound_plan_departs_the_left_turn_runway(
    by_title: dict[str, Worksheet],
    ksfo_inputs: AirportInputs,
    equipment_suffixes: tuple[EquipmentSuffix, ...],
    aircraft_classes: dict[str, AircraftClass],
) -> None:
    fixtures = sheet_of(by_title["Phraseology Practice 1A"], ksfo_inputs, equipment_suffixes, {}, aircraft_classes)
    fixture = fixture_of(fixtures, "NKS188")
    assert fixture["scenario"]["filedRoute"].startswith("SSTIK5 NTELL ")
    assert (fixture["scenario"]["runwayConfigId"], fixture["scenario"]["departureRunway"]) == ("28/01", "01L")
    assert fixture["source"]["note"].endswith("the runway configuration 28/01 departs south per direction_runway_preference, pending validation")


def test_plan_with_unknown_exit_fix_keeps_the_first_runway(
    by_title: dict[str, Worksheet],
    ksfo_inputs: AirportInputs,
    equipment_suffixes: tuple[EquipmentSuffix, ...],
    aircraft_classes: dict[str, AircraftClass],
) -> None:
    fixtures = sheet_of(by_title["Amendment Practice 1A"], ksfo_inputs, equipment_suffixes, {}, aircraft_classes)
    fixture = fixture_of(fixtures, "LXJ351")
    assert fixture["scenario"]["filedRoute"].startswith("GAPP7 EHF ")
    assert fixture["scenario"]["departureRunway"] == "01L"
    assert fixture["source"]["note"].endswith("so this is 01L, the first runway configuration 28/01 departs, pending validation")


def test_turboprop_in_28_01_defaults_to_28r_at_echo(
    by_title: dict[str, Worksheet],
    ksfo_inputs: AirportInputs,
    equipment_suffixes: tuple[EquipmentSuffix, ...],
    aircraft_classes: dict[str, AircraftClass],
) -> None:
    fixtures = sheet_of(by_title["Phraseology Practice 1A"], ksfo_inputs, equipment_suffixes, {}, aircraft_classes)
    fixture = fixture_of(fixtures, "N483KA")
    assert (fixture["scenario"]["aircraftType"], aircraft_classes["B350"]) == ("B350", "T")
    assert (fixture["scenario"]["runwayConfigId"], fixture["scenario"]["departureRunway"]) == ("28/01", "28R")
    assert fixture["source"]["note"].endswith(
        "so this is 28R, the runway configuration 28/01 defaults class T to it (default_for_classes), pending validation"
    )


def test_jet_in_28_01_still_follows_the_turn_direction(
    by_title: dict[str, Worksheet],
    ksfo_inputs: AirportInputs,
    equipment_suffixes: tuple[EquipmentSuffix, ...],
    aircraft_classes: dict[str, AircraftClass],
) -> None:
    fixtures = sheet_of(by_title["Phraseology Practice 1A"], ksfo_inputs, equipment_suffixes, {}, aircraft_classes)
    fixture = fixture_of(fixtures, "UAL320")
    assert (fixture["scenario"]["aircraftType"], aircraft_classes["A320"]) == ("A320", "J")
    assert (fixture["scenario"]["runwayConfigId"], fixture["scenario"]["departureRunway"]) == ("28/01", "01R")
    assert fixture["source"]["note"].endswith("the runway configuration 28/01 departs north per direction_runway_preference, pending validation")


def test_unknown_designator_skips_the_class_default(
    by_title: dict[str, Worksheet],
    ksfo_inputs: AirportInputs,
    equipment_suffixes: tuple[EquipmentSuffix, ...],
    aircraft_classes: dict[str, AircraftClass],
) -> None:
    classes = {designator: value for designator, value in aircraft_classes.items() if designator != "B350"}
    fixtures = sheet_of(by_title["Phraseology Practice 1A"], ksfo_inputs, equipment_suffixes, {}, classes)
    fixture = fixture_of(fixtures, "N483KA")
    assert fixture["scenario"]["departureRunway"] == "01R"
    assert fixture["source"]["note"].endswith("; type B350 is not in the vNAS specs, so the class default was not applied")


def test_a_worksheet_plan_becomes_a_pending_fixture(
    worksheet_config: WorksheetConfig,
    ksfo_inputs: AirportInputs,
    equipment_suffixes: tuple[EquipmentSuffix, ...],
    aircraft_classes: dict[str, AircraftClass],
) -> None:
    fixtures = all_fixtures(worksheet_config, ksfo_inputs, equipment_suffixes, aircraft_classes)
    path = next(path for path in fixtures if path.name == "phraseology-practice-1a-ual320.json")
    assert fixtures[path] == FIRST_FIXTURE


def test_every_emitted_fixture_matches_the_schema(
    worksheet_config: WorksheetConfig,
    ksfo_inputs: AirportInputs,
    equipment_suffixes: tuple[EquipmentSuffix, ...],
    aircraft_classes: dict[str, AircraftClass],
) -> None:
    fixtures = all_fixtures(worksheet_config, ksfo_inputs, equipment_suffixes, aircraft_classes)
    assert len(fixtures) == FIXTURE_COUNT
    for fixture in fixtures.values():
        validate(fixture, fixture_schema_path())
        assert "expected" not in fixture


def test_type_alias_is_applied_on_import(
    by_title: dict[str, Worksheet],
    worksheet_config: WorksheetConfig,
    ksfo_inputs: AirportInputs,
    equipment_suffixes: tuple[EquipmentSuffix, ...],
    aircraft_classes: dict[str, AircraftClass],
) -> None:
    fixtures = sheet_of(by_title["Amendment Practice 2"], ksfo_inputs, equipment_suffixes, worksheet_config.type_aliases, aircraft_classes)
    fixture = fixture_of(fixtures, "FFT2015")
    assert worksheet_config.type_aliases["A32N"] == "A20N"
    assert row_of(by_title, "Amendment Practice 2", "FFT2015").designator == "A32N"
    assert fixture["scenario"]["aircraftType"] == "A20N"
    assert fixture["source"]["note"].endswith("; type A32N filed on the sheet, read as A20N")


def test_type_alias_to_itself_is_rejected(tmp_path: Path, ksfo_dir: Path) -> None:
    directory = tmp_path / "ksfo"
    directory.mkdir()
    path = directory / WORKSHEETS_FILE
    path.write_text((ksfo_dir / WORKSHEETS_FILE).read_text(encoding="utf-8").replace("A32N: A20N", "A32N: A32N"), encoding="utf-8")
    with pytest.raises(ValueError, match=r"ksfo/worksheets\.yaml type_aliases\[A32N\]: the alias reads 'A32N' as itself"):
        load_worksheets(path)


@pytest.mark.network
def test_the_live_export_still_parses_to_the_checked_in_plans(by_title: dict[str, Worksheet], tmp_path_factory: pytest.TempPathFactory) -> None:
    worksheet = by_title["Phraseology Practice 1A"]
    text = fetch_worksheet_text(worksheet, tmp_path_factory.mktemp("cache"))
    assert parse_worksheet(worksheet, text) == parse_worksheet(worksheet, sheet_text(worksheet))
