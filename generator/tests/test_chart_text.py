import random
import re
from collections.abc import Callable
from dataclasses import dataclass

import pytest

from craft_generator.chart_text import (
    DEPARTURE_FREQUENCY_LABEL,
    TOP_ALTITUDE_LABEL,
    ChartFacts,
    DepFrequency,
    TopAltitude,
    extract_text,
    parse_chart_facts,
)
from craft_generator.charts_api import ChartRef, fetch_chart_pdf


@dataclass(frozen=True)
class Expected:
    procedure_id: str
    top_altitude: TopAltitude
    transitions: frozenset[str]
    dep_frequencies: tuple[DepFrequency, ...]
    rnav: bool


PUBLISHED_FL190 = TopAltitude("published", 19000)
PUBLISHED_3000 = TopAltitude("published", 3000)
ASSIGNED = TopAltitude("assigned_by_atc", None)
NO_TOP_ALTITUDE = TopAltitude("none", None)
RICHMOND = (DepFrequency("120.9", None),)
SUTRO = (DepFrequency("135.1", None),)

NORTH_GATES = frozenset({"DEDHD", "GRTFL", "MOGEE", "ORRCA", "SYRAH", "TIPRE"})
SOUTH_GATES = frozenset({"KAYEX", "KTINA", "NTELL", "SUSEY"})

EXPECTED: dict[str, Expected] = {
    "SAN FRANCISCO FIVE": Expected("SFO5", ASSIGNED, frozenset(), RICHMOND, False),
    "GAP SEVEN": Expected(
        "GAPP7",
        NO_TOP_ALTITUDE,
        frozenset(),
        (DepFrequency("120.9", "NW-E"), DepFrequency("135.1", "SE-W")),
        False,
    ),
    "MOLEN NINE": Expected("MOLEN9", ASSIGNED, frozenset({"ENI"}), SUTRO, False),
    "SEGUL ONE (RNAV)": Expected("SEGUL1", ASSIGNED, frozenset({"YYUNG"}), SUTRO, True),
    "WESLA FIVE (RNAV)": Expected("WESLA5", ASSIGNED, SOUTH_GATES | {"YYUNG"}, SUTRO, True),
    "GNNRR THREE (RNAV)": Expected("GNNRR3", PUBLISHED_3000, frozenset({"ALCOA", "AMAKR", "BEBOP", "CINNY"}), SUTRO, True),
    "SNTNA TWO (RNAV)": Expected("SNTNA2", PUBLISHED_3000, NORTH_GATES, RICHMOND, True),
    "TRUKN TWO (RNAV)": Expected("TRUKN2", PUBLISHED_FL190, NORTH_GATES, RICHMOND, True),
    "NIITE FOUR (RNAV)": Expected("NIITE4", PUBLISHED_FL190, NORTH_GATES | {"GOBBS"}, RICHMOND, True),
    "CIITY THREE (RNAV)": Expected("CIITY3", PUBLISHED_FL190, NORTH_GATES, RICHMOND, True),
    "SAHEY FOUR (RNAV)": Expected("SAHEY4", PUBLISHED_FL190, SOUTH_GATES, SUTRO, True),
    "SSTIK FIVE (RNAV)": Expected("SSTIK5", PUBLISHED_FL190, SOUTH_GATES | {"YYUNG"}, SUTRO, True),
}

CHART_NAMES = sorted(EXPECTED)


def facts_for(name: str, charts: dict[str, ChartRef], text: Callable[[str], list[str]]) -> ChartFacts:
    return parse_chart_facts(text(charts[name].pdf_name), name)


def test_every_departure_chart_has_a_snapshot(sfo_charts_by_name: dict[str, ChartRef]) -> None:
    assert sorted(sfo_charts_by_name) == CHART_NAMES


@pytest.mark.parametrize("name", CHART_NAMES)
def test_chart_facts(name: str, sfo_charts_by_name: dict[str, ChartRef], chart_text: Callable[[str], list[str]]) -> None:
    expected = EXPECTED[name]
    facts = facts_for(name, sfo_charts_by_name, chart_text)
    assert facts.chart_name == name
    assert facts.procedure_ids == frozenset({expected.procedure_id})
    assert facts.top_altitude == expected.top_altitude
    assert frozenset(facts.transitions.values()) == expected.transitions
    assert tuple(facts.dep_frequencies) == expected.dep_frequencies
    assert facts.rnav is expected.rnav


@pytest.mark.parametrize("name", CHART_NAMES)
def test_every_chart_publishes_the_expect_filed_altitude_note(
    name: str, sfo_charts_by_name: dict[str, ChartRef], chart_text: Callable[[str], list[str]]
) -> None:
    assert facts_for(name, sfo_charts_by_name, chart_text).expect_filed_altitude_minutes == 10


def test_the_expect_note_survives_shuffled_lines(sfo_charts_by_name: dict[str, ChartRef], chart_text: Callable[[str], list[str]]) -> None:
    boxes = (TOP_ALTITUDE_LABEL, DEPARTURE_FREQUENCY_LABEL)
    lines = [line for line in chart_text(sfo_charts_by_name["TRUKN TWO (RNAV)"].pdf_name) if not any(box in line for box in boxes)]
    shuffled = list(lines)
    random.Random(0).shuffle(shuffled)
    assert shuffled != lines
    assert parse_chart_facts(shuffled, "TRUKN TWO (RNAV)").expect_filed_altitude_minutes == 10


def test_a_chart_that_prints_the_expect_note_twice_reads_the_value_both_printings_agree_on(
    sfo_charts_by_name: dict[str, ChartRef], chart_text: Callable[[str], list[str]]
) -> None:
    page = " ".join(chart_text(sfo_charts_by_name["SAN FRANCISCO FIVE"].pdf_name))
    assert len(re.findall(r"minutes after departure", page, re.IGNORECASE)) == 2
    assert facts_for("SAN FRANCISCO FIVE", sfo_charts_by_name, chart_text).expect_filed_altitude_minutes == 10


def test_minutes_after_departure_without_the_expect_note_is_not_read() -> None:
    lines = ["10 minutes after departure.", "TAKEOFF RUNWAYS 1L/R:  Climbing right turn heading 033°"]
    assert parse_chart_facts(lines, "TEST ONE").expect_filed_altitude_minutes is None


def test_an_unrelated_expect_sentence_does_not_publish_the_note() -> None:
    lines = ["SFO VOR/DME 13 DME; expect vector to assigned route/fix after NORMM INT.", "10 minutes after departure."]
    assert parse_chart_facts(lines, "TEST ONE").expect_filed_altitude_minutes is None


def test_disagreeing_expect_note_minutes_fail_loudly() -> None:
    lines = ["expect filed altitude 10 minutes after departure.", "expect filed altitude 5 minutes after departure."]
    with pytest.raises(ValueError, match=r"disagreeing minutes \[5, 10\]"):
        parse_chart_facts(lines, "TEST ONE")


def test_a_printed_transition_name_may_differ_from_its_fix(sfo_charts_by_name: dict[str, ChartRef], chart_text: Callable[[str], list[str]]) -> None:
    facts = facts_for("MOLEN NINE", sfo_charts_by_name, chart_text)
    assert facts.transitions == {"MENDOCINO": "ENI"}


def test_shuffled_lines_yield_identical_facts(sfo_charts_by_name: dict[str, ChartRef], chart_text: Callable[[str], list[str]]) -> None:
    lines = chart_text(sfo_charts_by_name["GAP SEVEN"].pdf_name)
    shuffled = list(lines)
    random.Random(0).shuffle(shuffled)
    assert shuffled != lines
    assert parse_chart_facts(shuffled, "GAP SEVEN") == parse_chart_facts(lines, "GAP SEVEN")


@pytest.mark.parametrize("name", CHART_NAMES)
def test_shuffling_preserves_the_facts_that_live_on_one_line(
    name: str, sfo_charts_by_name: dict[str, ChartRef], chart_text: Callable[[str], list[str]]
) -> None:
    boxes = (TOP_ALTITUDE_LABEL, DEPARTURE_FREQUENCY_LABEL)
    lines = [line for line in chart_text(sfo_charts_by_name[name].pdf_name) if not any(box in line for box in boxes)]
    shuffled = list(lines)
    random.Random(0).shuffle(shuffled)
    facts = parse_chart_facts(shuffled, name)
    assert facts.procedure_ids == frozenset({EXPECTED[name].procedure_id})
    assert frozenset(facts.transitions.values()) == EXPECTED[name].transitions
    assert facts.rnav is EXPECTED[name].rnav
    assert facts == parse_chart_facts(lines, name)


def test_a_chart_without_a_top_altitude_line_has_kind_none(sfo_charts_by_name: dict[str, ChartRef], chart_text: Callable[[str], list[str]]) -> None:
    lines = [line for line in chart_text(sfo_charts_by_name["TRUKN TWO (RNAV)"].pdf_name) if TOP_ALTITUDE_LABEL not in line]
    assert parse_chart_facts(lines, "TRUKN TWO (RNAV)").top_altitude == NO_TOP_ALTITUDE


def test_top_altitude_on_the_label_line_is_read() -> None:
    assert parse_chart_facts(["TOP ALTITUDE:  FL230"], "TEST ONE").top_altitude == TopAltitude("published", 23000)
    assert parse_chart_facts(["TOP ALTITUDE: 4000"], "TEST ONE").top_altitude == TopAltitude("published", 4000)
    assert parse_chart_facts(["TOP ALTITUDE: ASSIGNED BY ATC"], "TEST ONE").top_altitude == ASSIGNED


def test_as_assigned_and_assigned_by_atc_are_the_same_kind() -> None:
    assert parse_chart_facts(["AS ASSIGNED", "TOP ALTITUDE:"], "TEST ONE").top_altitude == ASSIGNED
    assert parse_chart_facts(["ASSIGNED BY ATC", "TOP ALTITUDE:"], "TEST ONE").top_altitude == ASSIGNED


def test_a_top_altitude_label_with_no_value_fails_loudly() -> None:
    with pytest.raises(ValueError, match="no value on or before it"):
        parse_chart_facts(["25JUN15", "TOP ALTITUDE:"], "TEST ONE")


def test_the_frequency_after_the_label_belongs_to_the_tower() -> None:
    lines = ["120.9  323.2", DEPARTURE_FREQUENCY_LABEL, "120.5  269.1", "SAN FRANCISCO TOWER"]
    assert parse_chart_facts(lines, "TEST ONE").dep_frequencies == [DepFrequency("120.9", None)]


def test_a_departure_frequency_label_with_no_frequency_fails_loudly() -> None:
    with pytest.raises(ValueError, match="no frequency on the line before it"):
        parse_chart_facts(["25JUN15", DEPARTURE_FREQUENCY_LABEL], "TEST ONE")


def test_a_chart_without_a_departure_frequency_label_has_none() -> None:
    assert parse_chart_facts(["120.9  323.2"], "TEST ONE").dep_frequencies == []


@pytest.mark.network
@pytest.mark.parametrize("name", CHART_NAMES)
def test_published_pdf_still_matches_the_snapshot(
    name: str,
    sfo_charts_by_name: dict[str, ChartRef],
    chart_text: Callable[[str], list[str]],
    tmp_path_factory: pytest.TempPathFactory,
) -> None:
    chart = sfo_charts_by_name[name]
    pdf = fetch_chart_pdf(chart, tmp_path_factory.mktemp("cache"), "2609")
    assert extract_text(pdf) == chart_text(chart.pdf_name)
