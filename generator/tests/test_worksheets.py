import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import pytest

from craft_generator.cli import published_sid_runways
from craft_generator.emit import dump, fixture_schema_path, validate, write_or_check
from craft_generator.sop.load import WORKSHEETS_FILE, airport_dir, load_worksheets
from craft_generator.sop.model import (
    AircraftClass,
    AircraftGroup,
    AirportInputs,
    RunwayConfig,
    SharedRouteFacts,
    SopData,
    Worksheet,
    WorksheetConfig,
)
from craft_generator.worksheets import (
    Fixture,
    PlanRow,
    RunwayChoice,
    SheetImport,
    SkippedPlan,
    departure_runway,
    designator_classes,
    designator_wtcs,
    fetch_worksheet_text,
    fixture_for,
    parse_amendment_sheet,
    parse_phraseology_sheet,
    parse_worksheet,
    settled_fixture_at,
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
    "mode": "clearance",
    "airport": "KSFO",
    "scenario": {
        "callsign": "UAL320",
        "aircraftType": "A320",
        "equipmentSuffix": "/L",
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


@dataclass(frozen=True, slots=True)
class Importer:
    """Everything one import run resolves about the airport before it reads a sheet."""

    inputs: AirportInputs
    classes: Mapping[str, AircraftClass]
    wake_categories: Mapping[str, str]
    sid_runways: Mapping[str, Sequence[str]]
    destinations: frozenset[str]


@pytest.fixture(scope="module")
def importer(
    ksfo_inputs: AirportInputs,
    aircraft_specs_subset: list[dict[str, Any]],
    worksheet_config: WorksheetConfig,
    aircraft_classes: dict[str, AircraftClass],
    shared_route_facts: SharedRouteFacts,
) -> Importer:
    return Importer(
        inputs=ksfo_inputs,
        classes=aircraft_classes,
        wake_categories=designator_wtcs(aircraft_specs_subset, worksheet_config.type_aliases),
        sid_runways=published_sid_runways(ksfo_inputs.icao, ksfo_inputs.overrides),
        destinations=frozenset(shared_route_facts.destinations),
    )


@pytest.fixture(scope="module")
def turboprop_fixture(by_title: dict[str, Worksheet], importer: Importer) -> Fixture:
    """Return the regenerated fixture of the B350 on Phraseology Practice 1A."""
    return fixture_of(sheet_of(by_title["Phraseology Practice 1A"], importer, {}), "N483KA")


def write_settled(tmp_path: Path, fixture: Fixture, **scenario: Any) -> Path:
    """Write a settled copy of a fixture, with its scenario amended, and return the path."""
    settled = {
        **fixture,
        "status": "settled",
        "expected": {"clearedTo": fixture["scenario"]["destination"]},
        "scenario": {**fixture["scenario"], **scenario},
    }
    path = tmp_path / f"{fixture['id']}.json"
    path.write_text(dump(settled), encoding="utf-8", newline="")
    return path


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


def import_of(worksheet: Worksheet, importer: Importer, aliases: Mapping[str, str]) -> SheetImport:
    """Return the fixtures and the skipped plans of one worksheet, built from its checked-in text."""
    return sheet_fixtures(
        worksheet,
        sheet_text(worksheet),
        icao=importer.inputs.icao,
        sop=importer.inputs.sop,
        destinations=importer.destinations,
        type_aliases=aliases,
        aircraft_classes=importer.classes,
        wake_categories=importer.wake_categories,
        cargo_airlines=importer.inputs.routes.cargo_airlines,
        sid_runways=importer.sid_runways,
    )


def sheet_of(worksheet: Worksheet, importer: Importer, aliases: Mapping[str, str]) -> dict[Path, Fixture]:
    """Return the fixtures of one worksheet, built from its checked-in text."""
    return import_of(worksheet, importer, aliases).fixtures


def plan_row(callsign: str, designator: str, route: str) -> PlanRow:
    """Return a filed plan the sheets do not print, for the runway rules to read."""
    return PlanRow(
        callsign=callsign,
        designator=designator,
        suffix="/L",
        departure="KSFO",
        destination="KFAT",
        altitude_feet=PLAIN_ALTITUDE_FEET,
        squawk="3332",
        route=route,
        truncated=False,
    )


def runway_of(importer: Importer, config_id: str, row: PlanRow) -> RunwayChoice:
    """Return the departure runway one plan gets in one runway configuration."""
    config = next(entry for entry in importer.inputs.sop.runway_configs if entry.id == config_id)
    return departure_runway(
        row,
        config,
        importer.inputs.sop,
        aircraft_classes=importer.classes,
        wake_categories=importer.wake_categories,
        cargo_airlines=importer.inputs.routes.cargo_airlines,
        sid_runways=importer.sid_runways,
    )


def fixture_of(fixtures: dict[Path, Fixture], callsign: str) -> Fixture:
    """Return the fixture of one plan of a sheet by callsign."""
    return next(fixture for fixture in fixtures.values() if fixture["scenario"]["callsign"] == callsign)


def all_fixtures(config: WorksheetConfig, importer: Importer) -> dict[Path, Fixture]:
    """Return the fixture of every plan on every worksheet, keyed by the file it is written to."""
    fixtures: dict[Path, Fixture] = {}
    for worksheet in config.worksheets:
        fixtures.update(sheet_of(worksheet, importer, config.type_aliases))
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


def test_a_plan_filed_without_a_suffix_carries_a_null_equipment_suffix(by_title: dict[str, Worksheet], importer: Importer) -> None:
    fixtures = sheet_of(by_title["Amendment Practice 2"], importer, {})
    scenario = fixture_of(fixtures, "JSX203")["scenario"]
    assert (scenario["aircraftType"], scenario["equipmentSuffix"]) == ("E135", None)
    assert row_of(by_title, "Amendment Practice 2", "JSX203").suffix is None


def test_the_sheet_kind_sets_the_fixture_mode(by_title: dict[str, Worksheet], importer: Importer) -> None:
    phraseology = sheet_of(by_title["Phraseology Practice 1A"], importer, {})
    amendment = sheet_of(by_title["Amendment Practice 2"], importer, {})
    assert {fixture["mode"] for fixture in phraseology.values()} == {"clearance"}
    assert {fixture["mode"] for fixture in amendment.values()} == {"amendment"}


def test_a_sheet_that_prints_no_squawk_numbers_them_in_octal(by_title: dict[str, Worksheet], importer: Importer) -> None:
    fixtures = sheet_of(by_title["Amendment Practice 1A"], importer, {})
    assert [fixture["scenario"]["squawk"] for fixture in fixtures.values()] == AMENDMENT_SQUAWKS


def test_northbound_plan_departs_the_right_turn_runway(by_title: dict[str, Worksheet], importer: Importer) -> None:
    fixtures = sheet_of(by_title["Phraseology Practice 1A"], importer, {})
    scenario = fixture_of(fixtures, "UAL320")["scenario"]
    assert scenario["filedRoute"].startswith("TRUKN2 DEDHD ")
    assert (scenario["runwayConfigId"], scenario["departureRunway"]) == ("28/01", "01R")


def test_southbound_plan_departs_the_left_turn_runway(by_title: dict[str, Worksheet], importer: Importer) -> None:
    fixtures = sheet_of(by_title["Phraseology Practice 1A"], importer, {})
    fixture = fixture_of(fixtures, "NKS188")
    assert fixture["scenario"]["filedRoute"].startswith("SSTIK5 NTELL ")
    assert (fixture["scenario"]["runwayConfigId"], fixture["scenario"]["departureRunway"]) == ("28/01", "01L")
    assert fixture["source"]["note"].endswith("the runway configuration 28/01 departs south per direction_runway_preference, pending validation")


def test_plan_with_exit_fix_in_no_gate_keeps_the_first_runway(importer: Importer) -> None:
    gates = importer.inputs.sop.gates
    assert "PYE" not in gates.north + gates.south + gates.oceanic
    choice = runway_of(importer, "28/01", plan_row("UAL1563", "A320", "SFO5 PYE"))
    assert (choice.runway, choice.direction, choice.default_for_class, choice.on_request) == ("01L", None, None, None)


def test_turboprop_in_28_01_defaults_to_28r_at_echo(
    by_title: dict[str, Worksheet], importer: Importer, aircraft_classes: dict[str, AircraftClass]
) -> None:
    fixtures = sheet_of(by_title["Phraseology Practice 1A"], importer, {})
    fixture = fixture_of(fixtures, "N483KA")
    assert (fixture["scenario"]["aircraftType"], aircraft_classes["B350"]) == ("B350", "T")
    assert (fixture["scenario"]["runwayConfigId"], fixture["scenario"]["departureRunway"]) == ("28/01", "28R")
    assert fixture["source"]["note"].endswith(
        "so this is 28R, the runway configuration 28/01 defaults class T to it (default_for_classes), pending validation"
    )


def _pcm_default_config(importer: Importer) -> RunwayConfig:
    """Return 28/01 with its 28L row turned into the prop default for the airline PCM."""
    config = next(entry for entry in importer.inputs.sop.runway_configs if entry.id == "28/01")
    runways = tuple(
        replace(runway, classes=("P", "T"), default_for_airlines=("PCM",), on_request_for=()) if runway.runway == "28L" else runway
        for runway in config.departure_runways
    )
    return replace(config, departure_runways=runways)


def _runway_in(importer: Importer, config: RunwayConfig, row: PlanRow) -> RunwayChoice:
    return departure_runway(
        row,
        config,
        importer.inputs.sop,
        aircraft_classes=importer.classes,
        wake_categories=importer.wake_categories,
        cargo_airlines=importer.inputs.routes.cargo_airlines,
        sid_runways=importer.sid_runways,
    )


def test_airline_default_beats_the_class_default(by_title: dict[str, Worksheet], importer: Importer) -> None:
    row = plan_row("PCM7679", "B350", "SFO5 PYE")
    choice = _runway_in(importer, _pcm_default_config(importer), row)
    assert (choice.runway, choice.default_for_airline, choice.default_for_class) == ("28L", "PCM", None)
    fixture = fixture_for(by_title["Phraseology Practice 1A"], row, 0, icao="ksfo", runway=choice, type_aliases={})
    assert fixture["source"]["note"].endswith(
        "so this is 28L, the runway configuration 28/01 defaults airline PCM to it (default_for_airlines), pending validation"
    )


def test_a_prop_of_another_airline_keeps_the_class_default(importer: Importer) -> None:
    choice = _runway_in(importer, _pcm_default_config(importer), plan_row("SKW1234", "B350", "SFO5 PYE"))
    assert (choice.runway, choice.default_for_airline, choice.default_for_class) == ("28R", None, "T")


def _group_default_sop(importer: Importer) -> SopData:
    """Return the SOP whose 28/01 28L row is the prop default for the group the BE20 is in by type."""
    sop = importer.inputs.sop
    configs = []
    for config in sop.runway_configs:
        if config.id == "28/01":
            runways = tuple(
                replace(runway, classes=("P", "T"), default_for_groups=("jets_and_be20",), on_request_for=()) if runway.runway == "28L" else runway
                for runway in config.departure_runways
            )
            config = replace(config, departure_runways=runways)
        configs.append(config)
    groups = {**sop.aircraft_groups, "jets_and_be20": AircraftGroup(classes=("J",), types=("BE20",))}
    return replace(sop, runway_configs=tuple(configs), aircraft_groups=groups)


def _runway_under(importer: Importer, sop: SopData, row: PlanRow) -> RunwayChoice:
    config = next(entry for entry in sop.runway_configs if entry.id == "28/01")
    return departure_runway(
        row,
        config,
        sop,
        aircraft_classes=importer.classes,
        wake_categories=importer.wake_categories,
        cargo_airlines=importer.inputs.routes.cargo_airlines,
        sid_runways=importer.sid_runways,
    )


def test_group_default_beats_the_class_default(by_title: dict[str, Worksheet], importer: Importer) -> None:
    row = plan_row("SKW1234", "BE20", "SFO5 PYE")
    choice = _runway_under(importer, _group_default_sop(importer), row)
    assert (choice.runway, choice.default_for_group, choice.default_for_class) == ("28L", "jets_and_be20", None)
    fixture = fixture_for(by_title["Phraseology Practice 1A"], row, 0, icao="ksfo", runway=choice, type_aliases={})
    assert fixture["source"]["note"].endswith(
        "so this is 28L, the runway configuration 28/01 defaults group jets_and_be20 to it (default_for_groups), pending validation"
    )


def test_a_prop_outside_the_group_keeps_the_class_default(importer: Importer) -> None:
    choice = _runway_under(importer, _group_default_sop(importer), plan_row("SKW1234", "B350", "SFO5 PYE"))
    assert (choice.runway, choice.default_for_group, choice.default_for_class) == ("28R", None, "T")


def test_jet_in_28_01_still_follows_the_turn_direction(
    by_title: dict[str, Worksheet], importer: Importer, aircraft_classes: dict[str, AircraftClass]
) -> None:
    fixtures = sheet_of(by_title["Phraseology Practice 1A"], importer, {})
    fixture = fixture_of(fixtures, "UAL320")
    assert (fixture["scenario"]["aircraftType"], aircraft_classes["A320"]) == ("A320", "J")
    assert (fixture["scenario"]["runwayConfigId"], fixture["scenario"]["departureRunway"]) == ("28/01", "01R")
    assert fixture["source"]["note"].endswith("the runway configuration 28/01 departs north per direction_runway_preference, pending validation")


def test_cargo_jet_filing_a_28_only_sid_in_28_01_is_given_the_28s(by_title: dict[str, Worksheet], importer: Importer) -> None:
    fixtures = sheet_of(by_title["Phraseology Practice 2"], importer, {})
    fixture = fixture_of(fixtures, "FDX1563")
    assert (fixture["scenario"]["aircraftType"], fixture["scenario"]["filedRoute"]) == ("B752", "WESLA5 NTELL")
    assert (fixture["scenario"]["runwayConfigId"], fixture["scenario"]["departureRunway"]) == ("28/01", "28L")
    assert fixture["source"]["note"].endswith(
        "so this is 28L: a cargo flight filing WESLA5, published for the 28s only, "
        "is treated as requesting them (SOP 2-1 e, on_request_for), pending validation"
    )


def test_heavy_cargo_jet_filing_a_28_only_sid_in_28_01_is_given_the_28s(by_title: dict[str, Worksheet], importer: Importer) -> None:
    fixtures = sheet_of(by_title["Phraseology Practice 2"], importer, {})
    fixture = fixture_of(fixtures, "UPS2896")
    assert (fixture["scenario"]["aircraftType"], importer.wake_categories["A306"]) == ("A306", "H")
    assert fixture["scenario"]["filedRoute"].startswith("SNTNA2 ORRCA")
    assert (fixture["scenario"]["runwayConfigId"], fixture["scenario"]["departureRunway"]) == ("28/01", "28L")
    assert "filing SNTNA2, published for the 28s only" in fixture["source"]["note"]


def test_heavy_of_no_cargo_airline_is_given_the_28s_as_a_heavy(importer: Importer) -> None:
    choice = runway_of(importer, "28/01", plan_row("KAL65", "A306", "SNTNA2 ORRCA Q120 GALLI"))
    assert choice.runway == "28L"
    assert choice.on_request is not None
    assert (choice.on_request.kind, choice.on_request.sid) == ("heavy", "SNTNA2")


def test_jet_that_is_neither_cargo_nor_heavy_filing_a_28_only_sid_keeps_the_01s(importer: Importer) -> None:
    choice = runway_of(importer, "28/01", plan_row("UAL1563", "A320", "WESLA5 NTELL"))
    assert (choice.runway, choice.on_request) == ("01L", None)


def test_cargo_jet_filing_a_sid_published_for_both_families_keeps_the_01s(importer: Importer) -> None:
    choice = runway_of(importer, "28/01", plan_row("FDX1563", "B752", "TRUKN2 DEDHD RBL LMT HAWKZ7"))
    assert (choice.runway, choice.on_request) == ("01R", None)
    assert importer.sid_runways["TRUKN2"] == ("01R", "28L", "28R")


def test_unknown_designator_skips_the_class_default(
    by_title: dict[str, Worksheet], importer: Importer, aircraft_classes: dict[str, AircraftClass]
) -> None:
    classes = {designator: value for designator, value in aircraft_classes.items() if designator != "B350"}
    fixtures = sheet_of(by_title["Phraseology Practice 1A"], replace(importer, classes=classes), {})
    fixture = fixture_of(fixtures, "N483KA")
    assert fixture["scenario"]["departureRunway"] == "01R"
    assert fixture["source"]["note"].endswith("; type B350 is not in the vNAS specs, so the class default was not applied")


def test_settled_fixture_with_same_scenario_is_kept(turboprop_fixture: Fixture, tmp_path: Path) -> None:
    path = write_settled(tmp_path, turboprop_fixture)
    settled = settled_fixture_at(path, turboprop_fixture, overwrite_settled=False)
    assert settled is not None
    assert (settled.id, settled.changed_fields) == (turboprop_fixture["id"], ())
    assert json.loads(path.read_text(encoding="utf-8"))["status"] == "settled"


def test_settled_fixture_with_changed_scenario_is_refused(turboprop_fixture: Fixture, tmp_path: Path) -> None:
    path = write_settled(tmp_path, turboprop_fixture, departureRunway="01R", squawk="4601")
    settled = settled_fixture_at(path, turboprop_fixture, overwrite_settled=False)
    assert settled is not None
    assert settled.changed_fields == ("departureRunway", "squawk")
    committed = json.loads(path.read_text(encoding="utf-8"))
    assert (committed["status"], committed["scenario"]["departureRunway"]) == ("settled", "01R")


def test_overwrite_flag_downgrades_a_settled_fixture(turboprop_fixture: Fixture, tmp_path: Path) -> None:
    path = write_settled(tmp_path, turboprop_fixture, departureRunway="01R")
    assert settled_fixture_at(path, turboprop_fixture, overwrite_settled=True) is None
    assert write_or_check(path, dump(turboprop_fixture), check=False).status == "written"
    written = json.loads(path.read_text(encoding="utf-8"))
    assert (written["status"], "expected" in written) == ("pending", False)
    assert written["scenario"]["departureRunway"] == turboprop_fixture["scenario"]["departureRunway"]


def test_a_worksheet_plan_becomes_a_pending_fixture(worksheet_config: WorksheetConfig, importer: Importer) -> None:
    fixtures = all_fixtures(worksheet_config, importer)
    path = next(path for path in fixtures if path.name == "phraseology-practice-1a-ual320.json")
    assert fixtures[path] == FIRST_FIXTURE


def test_every_emitted_fixture_matches_the_schema(worksheet_config: WorksheetConfig, importer: Importer) -> None:
    fixtures = all_fixtures(worksheet_config, importer)
    assert len(fixtures) == FIXTURE_COUNT
    for fixture in fixtures.values():
        validate(fixture, fixture_schema_path())
        assert "expected" not in fixture


def test_type_alias_is_applied_on_import(by_title: dict[str, Worksheet], worksheet_config: WorksheetConfig, importer: Importer) -> None:
    fixtures = sheet_of(by_title["Amendment Practice 2"], importer, worksheet_config.type_aliases)
    fixture = fixture_of(fixtures, "FFT2015")
    assert worksheet_config.type_aliases["A32N"] == "A20N"
    assert row_of(by_title, "Amendment Practice 2", "FFT2015").designator == "A32N"
    assert fixture["scenario"]["aircraftType"] == "A20N"
    assert fixture["source"]["note"].endswith("; type A32N filed on the sheet, read as A20N")


def test_plan_filed_to_a_destination_outside_the_shared_table_is_skipped(by_title: dict[str, Worksheet], importer: Importer) -> None:
    unshared = replace(importer, destinations=importer.destinations - {"KJAC"})
    sheet = import_of(by_title["Amendment Practice 1A"], unshared, {})
    assert sheet.skipped == (SkippedPlan(callsign="N238JP", destination="KJAC"),)
    assert len(sheet.fixtures) == PLAN_COUNTS["Amendment Practice 1A"] - 1
    assert not [path for path in sheet.fixtures if path.name.endswith("-n238jp.json")]


def test_a_skipped_plan_leaves_the_squawks_of_the_plans_after_it_alone(by_title: dict[str, Worksheet], importer: Importer) -> None:
    unshared = replace(importer, destinations=importer.destinations - {"KJAC"})
    sheet = import_of(by_title["Amendment Practice 1A"], unshared, {})
    assert fixture_of(sheet.fixtures, "SWA984")["scenario"]["squawk"] == AMENDMENT_SQUAWKS[1]


def test_no_plan_is_skipped_when_every_destination_is_shared(worksheet_config: WorksheetConfig, importer: Importer) -> None:
    aliases = worksheet_config.type_aliases
    assert [plan for worksheet in worksheet_config.worksheets for plan in import_of(worksheet, importer, aliases).skipped] == []


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
