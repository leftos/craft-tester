"""The ZOA charts API: which chart PDFs an airport publishes.

``https://charts-api.oakartcc.org/v1/charts?apt=SFO`` answers ``{"SFO": [{...}, ...]}`` with one
object per chart. ``chart_code == "DP"`` selects the departure procedures: 12 of the 53 SFO charts in
cycle 2609. ``pdf_path`` is already an absolute ``https://aeronav.faa.gov/d-tpp/<cycle>/<name>.PDF``
URL, so no URL building is needed here.

A procedure too long for one sheet is published as several: OAK lists ``OAKLAND SIX`` and
``OAKLAND SIX, CONT.1`` as separate charts with separate PDFs, and its narrative, top altitude and
departure frequencies are spread across both. :func:`group_continuations` puts each continuation
back with the sheet it continues so the procedure is read as one document.
"""

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from craft_generator.http import fetch_bytes

CHARTS_API_URL_TEMPLATE = "https://charts-api.oakartcc.org/v1/charts?apt={faa}"
DEPARTURE_CHART_CODE = "DP"
_CYCLE_IN_URL = re.compile(r"/d-tpp/(?P<cycle>\d{4})/")
_CONTINUATION_NAME = re.compile(r"^(?P<base>.+), CONT\.(?P<number>\d+)$")


@dataclass(frozen=True, slots=True)
class ChartRef:
    """One published chart PDF."""

    chart_name: str
    pdf_name: str
    pdf_url: str


def charts_api_url(airport_faa: str) -> str:
    """Return the charts API URL for an FAA airport identifier such as ``SFO``."""
    return CHARTS_API_URL_TEMPLATE.format(faa=airport_faa)


def charts_cache_path(cache: Path, airport_faa: str) -> Path:
    """Return the cache file the charts API response for ``airport_faa`` is stored in."""
    return cache / "charts" / f"{airport_faa}.json"


def pdf_cache_path(cache: Path, cycle_id: str, chart: ChartRef) -> Path:
    """Return the cache file a chart PDF of one AIRAC cycle is stored in."""
    return cache / "pdfs" / cycle_id / chart.pdf_name


def cycle_id_from_url(pdf_url: str) -> str:
    """Return the AIRAC cycle id a d-TPP chart URL points at.

    Args:
        pdf_url: An ``https://aeronav.faa.gov/d-tpp/<cycle>/<name>.PDF`` URL.

    Returns:
        The four-digit cycle id, e.g. ``"2609"``.

    Raises:
        ValueError: The URL carries no ``/d-tpp/<cycle>/`` segment.
    """
    match = _CYCLE_IN_URL.search(pdf_url)
    if match is None:
        raise ValueError(f"chart URL {pdf_url!r} has no /d-tpp/<cycle>/ segment; the charts API may have changed its pdf_path format")
    return match.group("cycle")


def parse_departure_charts(payload: bytes | str, airport_faa: str) -> list[ChartRef]:
    """Select the departure procedures from a charts API response.

    Args:
        payload: The raw JSON body.
        airport_faa: The FAA identifier the response was requested for, e.g. ``SFO``.

    Returns:
        One :class:`ChartRef` per ``chart_code == "DP"`` entry, in response order.

    Raises:
        ValueError: The body is not JSON, does not carry the airport, or a chart entry is missing a
            field the generator needs.
    """
    try:
        body = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError(f"charts API response for {airport_faa} is not JSON: {exc}") from exc
    if not isinstance(body, dict) or airport_faa not in body:
        keys = sorted(body) if isinstance(body, dict) else type(body).__name__
        raise ValueError(f"charts API response has no {airport_faa!r} key; it carries {keys!r}")
    return [_chart_ref(entry, airport_faa) for entry in body[airport_faa] if entry.get("chart_code") == DEPARTURE_CHART_CODE]


def _chart_ref(entry: dict[str, str], airport_faa: str) -> ChartRef:
    missing = [field for field in ("chart_name", "pdf_name", "pdf_path") if not entry.get(field)]
    if missing:
        raise ValueError(f"charts API entry for {airport_faa} is missing {missing!r}: {entry!r}")
    return ChartRef(chart_name=entry["chart_name"].strip(), pdf_name=entry["pdf_name"].strip(), pdf_url=entry["pdf_path"].strip())


def group_continuations(charts: Sequence[ChartRef]) -> list[tuple[ChartRef, list[ChartRef]]]:
    """Group each chart with the continuation sheets that carry the rest of the same procedure.

    A chart named ``<NAME>, CONT.<n>`` is sheet ``n`` of the procedure published as ``<NAME>``, e.g.
    ``OAKLAND SIX, CONT.1`` continues ``OAKLAND SIX``.

    Args:
        charts: The departure charts of one airport, in charts API order.

    Returns:
        One entry per procedure, in the order the API lists the base sheets: the base sheet and its
        continuations ordered by sheet number. A procedure published on one sheet has no
        continuation.

    Raises:
        ValueError: A continuation names a base sheet the list does not carry.
    """
    groups: dict[str, list[tuple[int, ChartRef]]] = {
        chart.chart_name: [] for chart in charts if _CONTINUATION_NAME.fullmatch(chart.chart_name) is None
    }
    for chart in charts:
        match = _CONTINUATION_NAME.fullmatch(chart.chart_name)
        if match is None:
            continue
        base = match.group("base")
        if base not in groups:
            raise ValueError(f"chart {chart.chart_name!r} continues {base!r}, which the charts API does not list; it lists {sorted(groups)}")
        groups[base].append((int(match.group("number")), chart))
    ordered = {name: [chart for _, chart in sorted(sheets, key=lambda sheet: sheet[0])] for name, sheets in groups.items()}
    return [(chart, ordered[chart.chart_name]) for chart in charts if chart.chart_name in ordered]


def fetch_departure_charts(airport_faa: str, cache: Path, *, force: bool = False) -> list[ChartRef]:
    """Fetch the departure procedures an airport publishes, through the download cache.

    Args:
        airport_faa: FAA airport identifier, e.g. ``SFO``.
        cache: Download cache directory, normally :func:`craft_generator.http.cache_dir`.
        force: Re-download even when the cached response exists.

    Returns:
        One :class:`ChartRef` per departure procedure, in response order.
    """
    payload = fetch_bytes(charts_api_url(airport_faa), charts_cache_path(cache, airport_faa), force=force)
    return parse_departure_charts(payload, airport_faa)


def fetch_chart_pdf(chart: ChartRef, cache: Path, cycle_id: str, *, force: bool = False) -> bytes:
    """Fetch one chart PDF through the download cache.

    Args:
        chart: The chart to download.
        cache: Download cache directory.
        cycle_id: AIRAC cycle id the PDF belongs to, e.g. ``2609``; PDFs are cached per cycle.
        force: Re-download even when the cached PDF exists.

    Returns:
        The PDF bytes.
    """
    return fetch_bytes(chart.pdf_url, pdf_cache_path(cache, cycle_id, chart), force=force)
