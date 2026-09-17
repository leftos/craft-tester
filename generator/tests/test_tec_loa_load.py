from collections.abc import Callable
from dataclasses import replace
from datetime import date
from pathlib import Path
from typing import Any

import pytest
import yaml

from craft_generator.sop.load import LOA_FILE, OVERRIDES_FILE, ROUTES_FILE, SOP_FILE, TEC_FILE, airport_dir, load_airport, load_tec
from craft_generator.sop.model import (
    AirportInputs,
    EvenAltitudeRule,
    LoaRule,
    ParityRotatedRule,
    RouteTokenRule,
    SharedRouteFacts,
    TecData,
    TecRoute,
)

Mutation = Callable[[Any], None]

FILES = (("sop", SOP_FILE), ("overrides", OVERRIDES_FILE), ("routes", ROUTES_FILE), ("tec", TEC_FILE))

TEC_ROUTE_COUNT = 47
LOA_RULE_COUNT = 24
SHARED_LOA_RULE_IDS = [
    "LOA-ZSE-PARITY",
    "LOA-ZSE-SEA-ROUTE",
    "LOA-ZSE-PDX-ROUTE",
    "LOA-ZLA-LAX-ROUTE",
    "LOA-ZLA-LAX-PROPS-ROUTE",
    "LOA-ZLA-SMO-ROUTE",
    "LOA-ZLA-SMO-PROPS-ROUTE",
    "LOA-ZLA-LGB-SNA-ROUTE",
    "LOA-ZLA-LGB-SNA-PROPS-ROUTE",
    "LOA-ZLA-BUR-VNY-ROUTE",
    "LOA-ZLA-BUR-VNY-PROPS-ROUTE",
    "LOA-ZLA-SAN-ROUTE",
    "LOA-ZLA-CRQ-ROUTE",
    "LOA-ZLA-UDD-ROUTE",
    "LOA-ZLA-ONT-ROUTE",
    "LOA-ZLA-LAS-ROUTE",
    "LOA-ZLA-LAS-NONJET-ROUTE",
    "LOA-ZLA-HND-ROUTE",
    "LOA-ZLA-SBA-ROUTE",
    "LOA-ZLA-SBP-ROUTE",
    "LOA-ZLC-SLC-ROUTE",
    "LOA-ZLC-BOI-ROUTE",
    "LOA-ZLC-BIL-ROUTE",
    "LOA-ZLC-TWF-ROUTE",
]
ADR_ROUTE_IDS = ["ADR-KSAN-SFOW", "ADR-KSAN-SFOE"]
KSMF_PROP_ALTITUDE_FEET = 6000
KSMF_JET_ALTITUDE_FEET = 10000
BELOW_THE_KSMF_JET_INITIAL_FEET = 5000
PARITY_ODD_COURSE_FROM = 20
PARITY_ODD_COURSE_TO = 199
OUT_OF_RANGE_COURSE = 360

KOAK_ONLY_RULE = LoaRule(
    id="LOA-TEST-KOAK-ONLY",
    source="a test row",
    text="Oakland departures to Salt Lake are assigned even altitudes",
    artcc="ZLC",
    destinations=None,
    departures=("KOAK",),
    rule=EvenAltitudeRule(),
)


def airport_copy(tmp_path: Path, ksfo_dir: Path, **mutations: Mutation) -> Path:
    """Copy every KSFO YAML into ``tmp_path``, applying one mutation per file before writing it."""
    target = tmp_path / "ksfo"
    target.mkdir(exist_ok=True)
    for key, name in FILES:
        data = yaml.safe_load((ksfo_dir / name).read_text(encoding="utf-8"))
        mutate = mutations.get(key)
        if mutate is not None:
            mutate(data)
        (target / name).write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    return target


def write_loa(directory: Path, rules: list[Any]) -> Path:
    """Write the airport ``loa.yaml`` a copied airport directory overrides the shared rows with."""
    data = {"rules": rules}
    (directory / LOA_FILE).write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    return directory


def shared_with(shared: SharedRouteFacts, rule: LoaRule) -> SharedRouteFacts:
    """Return the shared facts with one more inherited LOA rule."""
    return replace(shared, loa=replace(shared.loa, rules=(*shared.loa.rules, rule)))


def tec_of(inputs: AirportInputs) -> TecData:
    tec = inputs.tec
    assert tec is not None
    return tec


def route_by_id(inputs: AirportInputs, route_id: str) -> TecRoute:
    return next(route for route in tec_of(inputs).routes if route.id == route_id)


def rule_by_id(inputs: AirportInputs, rule_id: str) -> LoaRule:
    return next(rule for rule in inputs.loa.rules if rule.id == rule_id)


def test_the_transcribed_tec_and_loa_files_load(ksfo_inputs: AirportInputs) -> None:
    tec = tec_of(ksfo_inputs)
    loa = ksfo_inputs.loa
    assert len(tec.routes) == TEC_ROUTE_COUNT
    assert tec.source.title == "ZOA Reference Tool, TEC/AAR/ADR Routes"
    assert tec.source.transcribed_at == date(2026, 9, 15)
    assert len(loa.rules) == LOA_RULE_COUNT


def test_a_tec_row_carries_its_runway_family_and_altitudes(ksfo_inputs: AirportInputs) -> None:
    prop = route_by_id(ksfo_inputs, "TEC-KSMF-SFOW-P-01")
    assert prop.runway_families == ("01",)
    assert (prop.initial_altitude_feet, prop.final_altitude_feet) == (None, KSMF_PROP_ALTITUDE_FEET)
    assert (prop.plan, prop.classes, prop.route) == ("SFOW", ("P",), "SFO# OAK V6 SAC")
    no_altitude = route_by_id(ksfo_inputs, "TEC-KSMF-SFOE-J")
    assert (no_altitude.initial_altitude_feet, no_altitude.final_altitude_feet) == (None, None)
    assert route_by_id(ksfo_inputs, "TEC-KSMF-SFOW-J").runway_families == ()


def test_the_assigned_departure_routes_are_the_only_adr_rows(ksfo_inputs: AirportInputs) -> None:
    routes = tec_of(ksfo_inputs).routes
    assert [route.id for route in routes if route.kind == "adr"] == ADR_ROUTE_IDS
    assert {route.kind for route in routes if route.id not in ADR_ROUTE_IDS} == {"tec"}
    assert route_by_id(ksfo_inputs, "ADR-KSAN-SFOE").runway_families == ("10",)


def test_the_parity_rule_carries_its_rotated_course_window(ksfo_inputs: AirportInputs) -> None:
    parity = rule_by_id(ksfo_inputs, "LOA-ZSE-PARITY")
    assert isinstance(parity.rule, ParityRotatedRule)
    assert parity.rule.kind == "parity_rotated"
    assert (parity.rule.odd_course_from, parity.rule.odd_course_to) == (PARITY_ODD_COURSE_FROM, PARITY_ODD_COURSE_TO)
    assert (parity.artcc, parity.destinations) == ("ZSE", None)


def test_a_route_rule_carries_its_tokens_and_destinations(ksfo_inputs: AirportInputs) -> None:
    portland = rule_by_id(ksfo_inputs, "LOA-ZSE-PDX-ROUTE")
    assert isinstance(portland.rule, RouteTokenRule)
    assert portland.rule.kind == "route"
    assert portland.rule.tokens == ("MACHU", "MOXEE", "OED")
    assert (portland.artcc, portland.destinations) == (None, ("KPDX",))


def test_a_route_rule_carries_the_classes_and_the_rnav_flag_it_is_written_for(
    tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts
) -> None:
    override = {
        "id": "LOA-ZSE-PDX-ROUTE",
        "source": "a test row",
        "text": "PDX props, RNAV only",
        "destinations": ["KPDX"],
        "rule": {"kind": "route", "tokens": ["MOXEE"], "classes": ["P", "T"], "rnav_only": True},
    }
    directory = write_loa(airport_copy(tmp_path, ksfo_dir), [override])
    portland = rule_by_id(load_airport(directory, shared_route_facts), "LOA-ZSE-PDX-ROUTE")
    assert isinstance(portland.rule, RouteTokenRule)
    assert (portland.rule.classes, portland.rule.rnav_only) == (("P", "T"), True)
    seattle = rule_by_id(load_airport(directory, shared_route_facts), "LOA-ZSE-SEA-ROUTE")
    assert isinstance(seattle.rule, RouteTokenRule)
    assert (seattle.rule.classes, seattle.rule.rnav_only) == (None, False)


@pytest.mark.parametrize(
    ("classes", "message"),
    [
        ([], r"rules\[LOA-ZSE-PDX-ROUTE\].rule.classes: the list is empty"),
        (["X"], r"rules\[LOA-ZSE-PDX-ROUTE\].rule.classes\[0\]: 'X' is not one of \['P', 'T', 'J'\]"),
    ],
)
def test_a_route_rule_with_no_usable_classes_is_named(
    tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts, classes: list[str], message: str
) -> None:
    override = {
        "id": "LOA-ZSE-PDX-ROUTE",
        "source": "a test row",
        "text": "PDX arrivals from the Bay",
        "destinations": ["KPDX"],
        "rule": {"kind": "route", "tokens": ["MOXEE"], "classes": classes},
    }
    directory = write_loa(airport_copy(tmp_path, ksfo_dir), [override])
    with pytest.raises(ValueError, match=message):
        load_airport(directory, shared_route_facts)


def test_an_airport_without_the_optional_files_has_no_tec_and_inherits_the_shared_loa_rules(
    tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts
) -> None:
    directory = airport_copy(tmp_path, ksfo_dir)
    (directory / TEC_FILE).unlink()
    assert not (directory / LOA_FILE).exists()
    inputs = load_airport(directory, shared_route_facts)
    assert inputs.tec is None
    assert [rule.id for rule in inputs.loa.rules] == SHARED_LOA_RULE_IDS


def test_a_tec_destination_outside_the_route_library_is_named(tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts) -> None:
    def mutate(data: Any) -> None:
        data["routes"][0]["destination"] = "KZZZ"

    with pytest.raises(ValueError, match=r"tec\.yaml routes\[TEC-KSMF-SFOW-J\]: destination 'KZZZ' is in no `destinations` row of routes\.yaml"):
        load_airport(airport_copy(tmp_path, ksfo_dir, tec=mutate), shared_route_facts)


def test_a_tec_plan_no_runway_config_declares_is_named(tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts) -> None:
    def mutate(data: Any) -> None:
        data["routes"][0]["plan"] = "SFOX"

    with pytest.raises(ValueError, match=r"tec\.yaml routes\[TEC-KSMF-SFOW-J\]: plan 'SFOX' is no `runway_configs` plan of sop\.yaml"):
        load_airport(airport_copy(tmp_path, ksfo_dir, tec=mutate), shared_route_facts)


def test_a_tec_route_naming_an_unknown_dp_family_is_named(tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts) -> None:
    def mutate(data: Any) -> None:
        data["routes"][0]["route"] = "TRUKEN# TRUKN FEVTA FEVTA1"

    with pytest.raises(ValueError, match=r"routes\[TEC-KSMF-SFOW-J\]: route names DP family 'TRUKEN', which has no procedure in overrides\.yaml"):
        load_airport(airport_copy(tmp_path, ksfo_dir, tec=mutate), shared_route_facts)


def test_an_unknown_aircraft_class_in_a_tec_row_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["routes"][0]["classes"] = ["J", "X"]

    with pytest.raises(ValueError, match=r"routes\[TEC-KSMF-SFOW-J\].classes\[1\]: 'X' is not one of \['P', 'T', 'J'\]"):
        load_tec(airport_copy(tmp_path, ksfo_dir, tec=mutate) / TEC_FILE)


def test_a_tec_initial_altitude_without_a_final_one_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["routes"][0]["initial_altitude_feet"] = KSMF_JET_ALTITUDE_FEET
        del data["routes"][0]["final_altitude_feet"]

    message = rf"routes\[TEC-KSMF-SFOW-J\]: initial_altitude_feet {KSMF_JET_ALTITUDE_FEET} is stated without final_altitude_feet"
    with pytest.raises(ValueError, match=message):
        load_tec(airport_copy(tmp_path, ksfo_dir, tec=mutate) / TEC_FILE)


def test_a_tec_initial_altitude_above_its_final_one_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["routes"][0]["initial_altitude_feet"] = KSMF_JET_ALTITUDE_FEET
        data["routes"][0]["final_altitude_feet"] = BELOW_THE_KSMF_JET_INITIAL_FEET

    message = (
        rf"routes\[TEC-KSMF-SFOW-J\]: initial_altitude_feet {KSMF_JET_ALTITUDE_FEET} "
        rf"is above final_altitude_feet {BELOW_THE_KSMF_JET_INITIAL_FEET}"
    )
    with pytest.raises(ValueError, match=message):
        load_tec(airport_copy(tmp_path, ksfo_dir, tec=mutate) / TEC_FILE)


def _sea_row_to(destinations: list[str]) -> dict[str, Any]:
    return {
        "id": "LOA-ZSE-SEA-ROUTE",
        "source": "a test row",
        "text": "SEA arrivals from the Bay",
        "destinations": destinations,
        "rule": {"kind": "route", "tokens": ["RBL"]},
    }


def test_a_loa_destination_outside_the_shared_table_is_named(tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts) -> None:
    directory = write_loa(airport_copy(tmp_path, ksfo_dir), [_sea_row_to(["KSEA", "KZZZ"])])
    message = r"loa\.yaml rules\[LOA-ZSE-SEA-ROUTE\]: destination 'KZZZ' is in no `destinations` row of shared/destinations\.yaml"
    with pytest.raises(ValueError, match=message):
        load_airport(directory, shared_route_facts)


def test_a_loa_destination_the_airport_files_to_no_scenario_of_loads(
    tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts, ksfo_inputs: AirportInputs
) -> None:
    filed = {destination.icao for destination in ksfo_inputs.routes.destinations}
    unfiled = next(icao for icao in shared_route_facts.destinations if icao not in filed)
    directory = write_loa(airport_copy(tmp_path, ksfo_dir), [_sea_row_to(["KSEA", unfiled])])
    seattle = rule_by_id(load_airport(directory, shared_route_facts), "LOA-ZSE-SEA-ROUTE")
    assert seattle.destinations == ("KSEA", unfiled)


def test_a_rotated_parity_course_outside_the_compass_is_named(tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts) -> None:
    override = {
        "id": "LOA-ZSE-PARITY",
        "source": "a test row",
        "text": "the rotated hemispheres",
        "artcc": "ZSE",
        "rule": {"kind": "parity_rotated", "odd_course_from": PARITY_ODD_COURSE_FROM, "odd_course_to": OUT_OF_RANGE_COURSE},
    }
    directory = write_loa(airport_copy(tmp_path, ksfo_dir), [override])
    with pytest.raises(ValueError, match=r"rules\[LOA-ZSE-PARITY\].rule.odd_course_to: course 360 is not a magnetic course between 0 and 359"):
        load_airport(directory, shared_route_facts)


def test_an_airport_row_overrides_a_shared_row_by_id_and_adds_its_own(tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts) -> None:
    override = {
        "id": "LOA-ZSE-PDX-ROUTE",
        "source": "a test row",
        "text": "PDX arrivals from the Bay leave on MOXEE only",
        "destinations": ["KPDX"],
        "rule": {"kind": "route", "tokens": ["MOXEE"]},
    }
    added = {
        "id": "LOA-TEST-EXTRA",
        "source": "a test row",
        "text": "everything to Salt Lake is even",
        "artcc": "ZLC",
        "rule": {"kind": "even"},
    }
    directory = write_loa(airport_copy(tmp_path, ksfo_dir), [override, added])
    loa = load_airport(directory, shared_route_facts).loa
    assert [rule.id for rule in loa.rules] == [*SHARED_LOA_RULE_IDS, "LOA-TEST-EXTRA"]
    portland = next(rule for rule in loa.rules if rule.id == "LOA-ZSE-PDX-ROUTE")
    assert isinstance(portland.rule, RouteTokenRule)
    assert (portland.rule.tokens, portland.source) == (("MOXEE",), "a test row")


def test_a_shared_rule_naming_departures_reaches_only_those_airports(ksfo_dir: Path, shared_route_facts: SharedRouteFacts) -> None:
    shared = shared_with(shared_route_facts, KOAK_ONLY_RULE)
    ksfo = [rule.id for rule in load_airport(ksfo_dir, shared).loa.rules]
    koak = [rule.id for rule in load_airport(airport_dir("KOAK"), shared).loa.rules]
    assert ksfo == SHARED_LOA_RULE_IDS
    assert koak == [*SHARED_LOA_RULE_IDS, KOAK_ONLY_RULE.id]


def test_a_departures_code_that_is_no_icao_identifier_is_named(tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts) -> None:
    added = {
        "id": "LOA-TEST-EXTRA",
        "source": "a test row",
        "text": "everything to Salt Lake is even",
        "artcc": "ZLC",
        "departures": ["OAK"],
        "rule": {"kind": "even"},
    }
    directory = write_loa(airport_copy(tmp_path, ksfo_dir), [added])
    with pytest.raises(ValueError, match=r"rules\[LOA-TEST-EXTRA\].departures\[0\]: 'OAK' is not a four-letter upper-case ICAO airport id"):
        load_airport(directory, shared_route_facts)
