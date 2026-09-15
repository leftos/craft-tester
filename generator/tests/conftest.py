import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from craft_generator.charts_api import ChartRef, parse_departure_charts
from craft_generator.cifp.records import RunwayRecord, SidRecord, parse_records
from craft_generator.cifp.sid import CifpSid, group_sids
from craft_generator.sop.load import airport_dir, load_airport
from craft_generator.sop.model import AirportInputs

FIXTURES = Path(__file__).parent / "fixtures"
KSFO_RECORDS = FIXTURES / "cifp" / "ksfo_records.txt"
SFO_CHARTS_JSON = FIXTURES / "charts_api" / "SFO.json"
CHART_TEXT = FIXTURES / "chart_text"
SOP_TEXT = FIXTURES / "sop_text.txt"
AIRCRAFT_SPECS_SUBSET = FIXTURES / "aircraft_specs.subset.json"


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
