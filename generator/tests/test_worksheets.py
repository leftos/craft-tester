from pathlib import Path

import pytest

from craft_generator.emit import fixture_schema_path, validate
from craft_generator.sop.load import WORKSHEETS_FILE, airport_dir, load_worksheets
from craft_generator.sop.model import AirportInputs, EquipmentSuffix, Worksheet
from craft_generator.worksheets import (
    Fixture,
    PlanRow,
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
        "note": "Phraseology Practice 1A; the sheet states no departure runway, so this is 01L, "
        "the first runway configuration 28/01 departs, pending validation",
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
        "departureRunway": "01L",
        "localTime": "1400",
        "dayOfWeek": "tuesday",
        "squawk": "3342",
    },
}
AMENDMENT_SQUAWKS = ["4601", "4602", "4603", "4604", "4605", "4606", "4607", "4610", "4611", "4612", "4613", "4614", "4615"]


@pytest.fixture(scope="module")
def worksheets() -> tuple[Worksheet, ...]:
    return load_worksheets(airport_dir("KSFO") / WORKSHEETS_FILE)


@pytest.fixture(scope="module")
def by_title(worksheets: tuple[Worksheet, ...]) -> dict[str, Worksheet]:
    return {worksheet.title: worksheet for worksheet in worksheets}


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


def all_fixtures(worksheets: tuple[Worksheet, ...], inputs: AirportInputs, suffixes: tuple[EquipmentSuffix, ...]) -> dict[Path, Fixture]:
    """Return the fixture of every plan on every worksheet, keyed by the file it is written to."""
    fixtures: dict[Path, Fixture] = {}
    for worksheet in worksheets:
        fixtures.update(
            sheet_fixtures(
                worksheet,
                sheet_text(worksheet),
                icao=inputs.icao,
                configs=inputs.sop.runway_configs,
                rnav=rnav_suffixes(suffixes),
            )
        )
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
    by_title: dict[str, Worksheet], ksfo_inputs: AirportInputs, equipment_suffixes: tuple[EquipmentSuffix, ...]
) -> None:
    worksheet = by_title["Amendment Practice 2"]
    fixtures = sheet_fixtures(
        worksheet, sheet_text(worksheet), icao=ksfo_inputs.icao, configs=ksfo_inputs.sop.runway_configs, rnav=rnav_suffixes(equipment_suffixes)
    )
    scenario = next(fixture["scenario"] for fixture in fixtures.values() if fixture["scenario"]["callsign"] == "JSX203")
    assert (scenario["aircraftType"], scenario["rnavCapable"]) == ("E135", False)
    assert row_of(by_title, "Amendment Practice 2", "JSX203").suffix is None


def test_a_sheet_that_prints_no_squawk_numbers_them_in_octal(
    by_title: dict[str, Worksheet], ksfo_inputs: AirportInputs, equipment_suffixes: tuple[EquipmentSuffix, ...]
) -> None:
    worksheet = by_title["Amendment Practice 1A"]
    fixtures = sheet_fixtures(
        worksheet, sheet_text(worksheet), icao=ksfo_inputs.icao, configs=ksfo_inputs.sop.runway_configs, rnav=rnav_suffixes(equipment_suffixes)
    )
    assert [fixture["scenario"]["squawk"] for fixture in fixtures.values()] == AMENDMENT_SQUAWKS


def test_a_worksheet_plan_becomes_a_pending_fixture(
    worksheets: tuple[Worksheet, ...], ksfo_inputs: AirportInputs, equipment_suffixes: tuple[EquipmentSuffix, ...]
) -> None:
    fixtures = all_fixtures(worksheets, ksfo_inputs, equipment_suffixes)
    path = next(path for path in fixtures if path.name == "phraseology-practice-1a-ual320.json")
    assert fixtures[path] == FIRST_FIXTURE


def test_every_emitted_fixture_matches_the_schema(
    worksheets: tuple[Worksheet, ...], ksfo_inputs: AirportInputs, equipment_suffixes: tuple[EquipmentSuffix, ...]
) -> None:
    fixtures = all_fixtures(worksheets, ksfo_inputs, equipment_suffixes)
    assert len(fixtures) == FIXTURE_COUNT
    for fixture in fixtures.values():
        validate(fixture, fixture_schema_path())
        assert "expected" not in fixture


@pytest.mark.network
def test_the_live_export_still_parses_to_the_checked_in_plans(by_title: dict[str, Worksheet], tmp_path_factory: pytest.TempPathFactory) -> None:
    worksheet = by_title["Phraseology Practice 1A"]
    text = fetch_worksheet_text(worksheet, tmp_path_factory.mktemp("cache"))
    assert parse_worksheet(worksheet, text) == parse_worksheet(worksheet, sheet_text(worksheet))
