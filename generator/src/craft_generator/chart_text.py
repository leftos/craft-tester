"""Facts read out of the text layer of an FAA departure chart.

``pypdf`` returns a d-TPP page as a bag of lines whose order follows the PDF content stream, not the
printed layout: the route description, the planview callouts and the communications box interleave.
Two boxes matter here, and both were surveyed across all 12 KSFO departure charts of cycle 2609:

* ``TOP ALTITUDE:`` — the value is on the line immediately *before* the label on every chart
  (``FL190``, ``3000``, ``ASSIGNED BY ATC``, ``AS ASSIGNED``). Charts that publish no top altitude,
  GAP SEVEN among them, carry no label at all.
* ``NORCAL DEP CON`` — the departure frequencies are the lines immediately before the label, and the
  tower frequency is the line immediately after it. GAP SEVEN publishes two, tagged ``(NW-E)`` and
  ``(SE-W)``; the rest publish one.
* ``expect filed altitude N minutes after departure`` — the route description note, whose halves
  arrive in either order and are therefore matched against the whole page rather than a line; see
  :func:`_parse_expect_filed_altitude_minutes`.

Because the label always follows its value, a value is never searched for *after* a label: the line
after ``NORCAL DEP CON`` is the tower, and reading it would silently produce the wrong frequency. The
sector-tagged frequencies are matched wherever they appear, so a chart that tags them is read without
reference to line order at all.
"""

import io
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from pypdf import PdfReader

TopAltitudeKind = Literal["published", "assigned_by_atc", "none"]

TOP_ALTITUDE_LABEL = "TOP ALTITUDE"
DEPARTURE_FREQUENCY_LABEL = "NORCAL DEP CON"
RNAV_MARKER = "(RNAV)"

_ASSIGNED_BY_ATC = ("ASSIGNED BY ATC", "AS ASSIGNED")
_FLIGHT_LEVEL = re.compile(r"^FL(?P<hundreds>\d{3})$")
_FEET = re.compile(r"^(?P<feet>\d{3,5})$")
_PROCEDURE = re.compile(r"\((?P<procedure>[A-Z]{3,6}\d)\.\s?(?P<fix>[A-Z0-9]{2,5})\)")
# The SKYLINE ONE (OAK) continuation sheet prints "PANOCHE TRANSITON", so the label spelling is optional in the middle.
_TRANSITION = re.compile(r"(?P<name>[A-Z][A-Z0-9]{1,14})\s+TRANSITI?ON\s*\((?P<procedure>[A-Z]{3,6}\d)\.\s?(?P<fix>[A-Z0-9]{2,5})\)")
_FREQUENCY = re.compile(r"(?P<frequency>1[123]\d\.\d{1,3})\s+\d{3}\.\d{1,3}(?:\s*\((?P<note>[A-Z]{1,2}-[A-Z]{1,2})\))?")
_MINUTES_AFTER_DEPARTURE = re.compile(r"(?P<minutes>\d+)\s*minutes\s*after\s*departure", re.IGNORECASE)
_EXPECT = re.compile(r"expect", re.IGNORECASE)
_FILED_ALTITUDE = re.compile(r"filed\s+altitude|expect\s+filed", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class TopAltitude:
    """The top altitude a departure chart publishes."""

    kind: TopAltitudeKind
    feet: int | None


@dataclass(frozen=True, slots=True)
class DepFrequency:
    """One departure-control frequency from the communications box."""

    frequency: str
    note: str | None


@dataclass(frozen=True, slots=True)
class ChartFacts:
    """Everything the generator reads off one departure chart."""

    chart_name: str
    procedure_ids: frozenset[str]
    transitions: dict[str, str]
    top_altitude: TopAltitude
    expect_filed_altitude_minutes: int | None
    dep_frequencies: list[DepFrequency]
    rnav: bool


def extract_text(pdf_bytes: bytes) -> list[str]:
    """Return the text layer of a PDF as stripped, non-empty lines.

    Args:
        pdf_bytes: The PDF file contents.

    Returns:
        Every non-empty line of every page, stripped, in content-stream order.
    """
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return [stripped for page in reader.pages for line in page.extract_text().splitlines() if (stripped := line.strip())]


def _label_index(lines: Sequence[str], label: str) -> int | None:
    for index, line in enumerate(lines):
        if label in line:
            return index
    return None


def _top_altitude_from(value: str) -> TopAltitude | None:
    text = value.strip()
    if any(marker in text for marker in _ASSIGNED_BY_ATC):
        return TopAltitude("assigned_by_atc", None)
    flight_level = _FLIGHT_LEVEL.match(text)
    if flight_level is not None:
        return TopAltitude("published", int(flight_level.group("hundreds")) * 100)
    feet = _FEET.match(text)
    if feet is not None:
        return TopAltitude("published", int(feet.group("feet")))
    return None


def _parse_top_altitude(lines: Sequence[str], chart_name: str) -> TopAltitude:
    index = _label_index(lines, TOP_ALTITUDE_LABEL)
    if index is None:
        return TopAltitude("none", None)
    same_line = lines[index].split(TOP_ALTITUDE_LABEL, 1)[1].lstrip(": ")
    candidates = [same_line, lines[index - 1] if index else ""]
    for candidate in candidates:
        top_altitude = _top_altitude_from(candidate)
        if top_altitude is not None:
            return top_altitude
    raise ValueError(f"{chart_name}: found a {TOP_ALTITUDE_LABEL} label but no value on or before it; candidates were {candidates!r}")


def _tagged_frequencies(lines: Sequence[str]) -> list[DepFrequency]:
    found: dict[str, DepFrequency] = {}
    for line in lines:
        for match in _FREQUENCY.finditer(line):
            if match.group("note"):
                found.setdefault(match.group("frequency"), DepFrequency(match.group("frequency"), match.group("note")))
    return sorted(found.values(), key=lambda entry: entry.frequency)


def _parse_dep_frequencies(lines: Sequence[str], chart_name: str) -> list[DepFrequency]:
    tagged = _tagged_frequencies(lines)
    if tagged:
        return tagged
    index = _label_index(lines, DEPARTURE_FREQUENCY_LABEL)
    if index is None:
        return []
    preceding = lines[index - 1] if index else ""
    matches = [DepFrequency(match.group("frequency"), match.group("note")) for match in _FREQUENCY.finditer(preceding)]
    if not matches:
        raise ValueError(f"{chart_name}: found a {DEPARTURE_FREQUENCY_LABEL} label but no frequency on the line before it, which held {preceding!r}")
    return matches


def _parse_expect_filed_altitude_minutes(lines: Sequence[str], chart_name: str) -> int | None:
    """Read the minutes out of the chart's "expect filed altitude N minutes after departure" note.

    The note is matched against the whole page joined with single spaces, never line by line: pypdf
    splits it in two and emits the halves in either order. On TRUKN TWO the digits arrive on a line
    *before* the one carrying "Expect filed altitude"; on SSTIK FIVE they arrive first and the word
    "expect" follows, glued to the chart name as "expectSSTIK". A page-level test is the only one
    both layouts pass, so every "N minutes after departure" on the page is an anchor, and the note
    counts as published when the page also holds "expect" and "filed altitude" anywhere on it, in
    any order and at any distance. GNNRR THREE, NIITE FOUR, SAHEY FOUR and WESLA FIVE are split
    between "filed" and "altitude" instead, leaving neither word next to the other, so either half
    of the phrase — "filed altitude" or "expect filed" — counts.

    Args:
        lines: The chart text as returned by :func:`extract_text`.
        chart_name: The chart name from the charts API, e.g. ``TRUKN TWO (RNAV)``.

    Returns:
        The minutes the note publishes, None when the page carries no anchor or neither context
        phrase. A chart that prints the note twice, as SAN FRANCISCO FIVE does, yields the value
        both printings agree on.

    Raises:
        ValueError: The page's anchors disagree on the minutes.
    """
    page = " ".join(lines)
    minutes = {int(match.group("minutes")) for match in _MINUTES_AFTER_DEPARTURE.finditer(page)}
    if not minutes or _EXPECT.search(page) is None or _FILED_ALTITUDE.search(page) is None:
        return None
    if len(minutes) > 1:
        raise ValueError(f"{chart_name}: the page publishes an expect filed altitude note with disagreeing minutes {sorted(minutes)}")
    return minutes.pop()


def parse_chart_facts(lines: Sequence[str], chart_name: str) -> ChartFacts:
    """Read the generator's facts off the text of one departure chart.

    Args:
        lines: The chart text as returned by :func:`extract_text`.
        chart_name: The chart name from the charts API, e.g. ``TRUKN TWO (RNAV)``.

    Returns:
        The procedure ids, enroute transitions (printed name to fix), top altitude, expect filed
        altitude minutes, departure frequencies and RNAV flag the chart publishes.

    Raises:
        ValueError: A box carries its label but no value the parser recognises, or the page's
            expect filed altitude notes disagree on the minutes.
    """
    procedure_ids = {match.group("procedure") for line in lines for match in _PROCEDURE.finditer(line)}
    transitions = {match.group("name"): match.group("fix") for line in lines for match in _TRANSITION.finditer(line)}
    return ChartFacts(
        chart_name=chart_name,
        procedure_ids=frozenset(procedure_ids),
        transitions=dict(sorted(transitions.items())),
        top_altitude=_parse_top_altitude(lines, chart_name),
        expect_filed_altitude_minutes=_parse_expect_filed_altitude_minutes(lines, chart_name),
        dep_frequencies=_parse_dep_frequencies(lines, chart_name),
        rnav=RNAV_MARKER in chart_name,
    )
