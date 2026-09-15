import json
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from craft_generator.aircraft_classes import classes_for_fleet
from craft_generator.chart_text import parse_chart_facts
from craft_generator.charts_api import ChartRef, charts_api_url, parse_departure_charts
from craft_generator.cifp.airports import parse_airport_coordinates
from craft_generator.cifp.records import RunwayRecord, SidRecord, parse_records
from craft_generator.cifp.sid import CifpSid, group_sids
from craft_generator.merge import BuildInputs, ChartInput, Document, Provenance, build_airport
from craft_generator.sop.load import EQUIPMENT_SUFFIXES_FILE, airport_dir, load_airport, load_equipment_suffixes, shared_dir
from craft_generator.sop.model import AirportInputs, EquipmentSuffix

FIXTURES = Path(__file__).parent / "fixtures"
KSFO_RECORDS = FIXTURES / "cifp" / "ksfo_records.txt"
AIRPORT_RECORDS = FIXTURES / "cifp" / "airport_records.txt"
SFO_CHARTS_JSON = FIXTURES / "charts_api" / "SFO.json"
CHART_TEXT = FIXTURES / "chart_text"
SOP_TEXT = FIXTURES / "sop_text.txt"
AIRCRAFT_SPECS_SUBSET = FIXTURES / "aircraft_specs.subset.json"

# The cycle the checked-in CIFP, chart-text and charts-API fixtures were captured from. The golden
# test compares a document built from them against `data/ksfo.json`, so these three values are the
# ones the live build of that cycle computed; re-capture the fixtures and update them together.
FIXTURE_CYCLE = "2609"
FIXTURE_EFFECTIVE = date(2026, 9, 3)
FIXTURE_CIFP_SHA256 = "fbea2179a990e1d371d77439961d137e83252582b3c67b6ec85b8d9d11c76cad"


def chart_lines(pdf_name: str) -> list[str]:
    """Return the checked-in text snapshot of a chart PDF."""
    return (CHART_TEXT / f"{Path(pdf_name).stem}.txt").read_text(encoding="utf-8").splitlines()


@pytest.fixture(scope="session")
def ksfo_lines() -> list[str]:
    return KSFO_RECORDS.read_text(encoding="ascii").splitlines()


@pytest.fixture(scope="session")
def ksfo_records(ksfo_lines: list[str]) -> tuple[tuple[SidRecord, ...], tuple[RunwayRecord, ...]]:
    return parse_records(ksfo_lines, "KSFO")


@pytest.fixture(scope="session")
def ksfo_sids(ksfo_records: tuple[tuple[SidRecord, ...], tuple[RunwayRecord, ...]]) -> dict[str, CifpSid]:
    legs, runways = ksfo_records
    return group_sids(legs, [runway.designator for runway in runways])


@pytest.fixture(scope="session")
def sfo_charts() -> list[ChartRef]:
    return parse_departure_charts(SFO_CHARTS_JSON.read_bytes(), "SFO")


@pytest.fixture(scope="session")
def sfo_charts_payload() -> dict[str, list[dict[str, str]]]:
    return json.loads(SFO_CHARTS_JSON.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def chart_text() -> Callable[[str], list[str]]:
    return chart_lines


@pytest.fixture(scope="session")
def sfo_charts_by_name(sfo_charts: list[ChartRef]) -> dict[str, ChartRef]:
    return {chart.chart_name: chart for chart in sfo_charts}


@pytest.fixture(scope="session")
def ksfo_dir() -> Path:
    return airport_dir("KSFO")


@pytest.fixture(scope="session")
def ksfo_inputs(ksfo_dir: Path) -> AirportInputs:
    return load_airport(ksfo_dir)


@pytest.fixture(scope="session")
def sop_text_lines() -> list[str]:
    """Return the pypdf text of the transcribed pages of the KSFO SOP (cover plus pages 8-11)."""
    return SOP_TEXT.read_text(encoding="utf-8").splitlines()


@pytest.fixture(scope="session")
def aircraft_specs_subset() -> list[dict[str, Any]]:
    """Return the vNAS aircraft specs records of the curated KSFO fleet."""
    return json.loads(AIRCRAFT_SPECS_SUBSET.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def airport_record_lines() -> list[str]:
    """Return the checked-in CIFP airport rows of KSFO and every destination it needs."""
    return AIRPORT_RECORDS.read_text(encoding="ascii").splitlines()


@pytest.fixture(scope="session")
def ksfo_coordinates(airport_record_lines: list[str]) -> dict[str, tuple[float, float]]:
    return parse_airport_coordinates(airport_record_lines)


@pytest.fixture(scope="session")
def equipment_suffixes() -> tuple[EquipmentSuffix, ...]:
    return load_equipment_suffixes(shared_dir() / EQUIPMENT_SUFFIXES_FILE)


@pytest.fixture(scope="session")
def ksfo_chart_inputs(sfo_charts: list[ChartRef]) -> dict[str, ChartInput]:
    """Return the chart facts of every KSFO departure chart, keyed by chart name in API order."""
    return {
        chart.chart_name: ChartInput(facts=parse_chart_facts(chart_lines(chart.pdf_name), chart.chart_name), pdf_url=chart.pdf_url)
        for chart in sfo_charts
    }


@pytest.fixture(scope="session")
def ksfo_build_inputs(
    ksfo_inputs: AirportInputs,
    ksfo_records: tuple[tuple[SidRecord, ...], tuple[RunwayRecord, ...]],
    ksfo_chart_inputs: dict[str, ChartInput],
    aircraft_specs_subset: list[dict[str, Any]],
) -> BuildInputs:
    """Return every build input of KSFO, read from the checked-in fixtures only."""
    legs, runway_records = ksfo_records
    runways = tuple(record.designator for record in runway_records)
    return BuildInputs(
        airport=ksfo_inputs,
        sids=group_sids(legs, runways),
        runways=runways,
        charts=ksfo_chart_inputs,
        aircraft_classes=classes_for_fleet(aircraft_specs_subset, ksfo_inputs.routes.fleet),
        coordinates=parse_airport_coordinates(AIRPORT_RECORDS.read_text(encoding="ascii").splitlines()),
        equipment_suffixes=load_equipment_suffixes(shared_dir() / EQUIPMENT_SUFFIXES_FILE),
        provenance=Provenance(
            cycle=FIXTURE_CYCLE,
            effective=FIXTURE_EFFECTIVE,
            cifp_sha256=FIXTURE_CIFP_SHA256,
            charts_api_url=charts_api_url("SFO"),
        ),
    )


@pytest.fixture(scope="session")
def ksfo_document(ksfo_build_inputs: BuildInputs) -> Document:
    """Return the KSFO airport document built from the fixtures alone."""
    return build_airport(ksfo_build_inputs)
