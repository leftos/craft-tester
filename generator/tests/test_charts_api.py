import json

import pytest

from craft_generator.charts_api import (
    ChartRef,
    charts_api_url,
    charts_cache_path,
    fetch_departure_charts,
    parse_departure_charts,
    pdf_cache_path,
)


def test_charts_api_url() -> None:
    assert charts_api_url("SFO") == "https://charts-api.oakartcc.org/v1/charts?apt=SFO"


def test_sfo_publishes_twelve_departure_procedures(sfo_charts: list[ChartRef]) -> None:
    assert len(sfo_charts) == 12
    names = [chart.chart_name for chart in sfo_charts]
    assert "TRUKN TWO (RNAV)" in names
    assert "SAN FRANCISCO FIVE" in names


def test_only_departure_procedures_are_kept(sfo_charts_payload: dict[str, list[dict[str, str]]]) -> None:
    entries = sfo_charts_payload["SFO"]
    assert len(entries) > 12
    assert {entry["chart_code"] for entry in entries} > {"DP"}


def test_chart_refs_carry_absolute_faa_urls(sfo_charts: list[ChartRef]) -> None:
    for chart in sfo_charts:
        assert chart.pdf_url == f"https://aeronav.faa.gov/d-tpp/2609/{chart.pdf_name}"
        assert chart.pdf_name.endswith(".PDF")


def test_cache_paths(tmp_path_factory: pytest.TempPathFactory) -> None:
    cache = tmp_path_factory.mktemp("cache")
    chart = ChartRef("TRUKN TWO (RNAV)", "00375TRUKN.PDF", "https://aeronav.faa.gov/d-tpp/2609/00375TRUKN.PDF")
    assert charts_cache_path(cache, "SFO") == cache / "charts" / "SFO.json"
    assert pdf_cache_path(cache, "2609", chart) == cache / "pdfs" / "2609" / "00375TRUKN.PDF"


def test_unknown_airport_key_is_reported() -> None:
    with pytest.raises(ValueError, match="has no 'OAK' key"):
        parse_departure_charts(b'{"SFO": []}', "OAK")


def test_malformed_json_is_reported() -> None:
    with pytest.raises(ValueError, match="is not JSON"):
        parse_departure_charts(b"<html>503</html>", "SFO")


def test_incomplete_entry_is_reported() -> None:
    payload = json.dumps({"SFO": [{"chart_code": "DP", "chart_name": "TRUKN TWO (RNAV)", "pdf_name": ""}]})
    with pytest.raises(ValueError, match=r"missing \['pdf_name', 'pdf_path'\]"):
        parse_departure_charts(payload, "SFO")


@pytest.mark.network
def test_live_charts_api_still_lists_twelve_departures(tmp_path_factory: pytest.TempPathFactory) -> None:
    charts = fetch_departure_charts("SFO", tmp_path_factory.mktemp("cache"))
    assert len(charts) == 12
