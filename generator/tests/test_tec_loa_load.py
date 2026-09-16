from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

import pytest
import yaml

from craft_generator.sop.load import LOA_FILE, OVERRIDES_FILE, ROUTES_FILE, SOP_FILE, TEC_FILE, load_airport, load_tec
from craft_generator.sop.model import AirportInputs, LoaData, LoaRule, ParityRotatedRule, RouteTokenRule, TecData, TecRoute

Mutation = Callable[[Any], None]

FILES = (("sop", SOP_FILE), ("overrides", OVERRIDES_FILE), ("routes", ROUTES_FILE), ("tec", TEC_FILE), ("loa", LOA_FILE))

TEC_ROUTE_COUNT = 49
LOA_RULE_COUNT = 3
ADR_ROUTE_IDS = ["ADR-KSAN-SFOW", "ADR-KSAN-SFOE"]
KSMF_PROP_CAP_FEET = 6000
PARITY_ODD_COURSE_FROM = 20
PARITY_ODD_COURSE_TO = 199
OUT_OF_RANGE_COURSE = 360


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


def tec_of(inputs: AirportInputs) -> TecData:
    tec = inputs.tec
    assert tec is not None
    return tec


def loa_of(inputs: AirportInputs) -> LoaData:
    loa = inputs.loa
    assert loa is not None
    return loa


def route_by_id(inputs: AirportInputs, route_id: str) -> TecRoute:
    return next(route for route in tec_of(inputs).routes if route.id == route_id)


def rule_by_id(inputs: AirportInputs, rule_id: str) -> LoaRule:
    return next(rule for rule in loa_of(inputs).rules if rule.id == rule_id)


def test_the_transcribed_tec_and_loa_files_load(ksfo_inputs: AirportInputs) -> None:
    tec = tec_of(ksfo_inputs)
    loa = loa_of(ksfo_inputs)
    assert len(tec.routes) == TEC_ROUTE_COUNT
    assert tec.source.title == "ZOA Reference Tool, TEC/AAR/ADR Routes"
    assert tec.source.transcribed_at == date(2026, 9, 15)
    assert len(loa.rules) == LOA_RULE_COUNT
    assert [source.id for source in loa.sources] == ["zoa-zse"]
    assert loa.sources[0].effective == date(2025, 9, 4)


def test_a_tec_row_carries_its_runway_family_and_altitude_cap(ksfo_inputs: AirportInputs) -> None:
    capped = route_by_id(ksfo_inputs, "TEC-KSMF-SFOW-P-01")
    assert capped.runway_families == ("01",)
    assert capped.altitude_cap_feet == KSMF_PROP_CAP_FEET
    assert (capped.plan, capped.classes, capped.route) == ("SFOW", ("P",), "SFO# OAK V6 SAC")
    assert route_by_id(ksfo_inputs, "TEC-KSMF-SFOE-J").altitude_cap_feet is None
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


def test_an_airport_without_the_optional_files_carries_no_tec_or_loa(tmp_path: Path, ksfo_dir: Path) -> None:
    directory = airport_copy(tmp_path, ksfo_dir)
    (directory / TEC_FILE).unlink()
    (directory / LOA_FILE).unlink()
    inputs = load_airport(directory)
    assert (inputs.tec, inputs.loa) == (None, None)


def test_a_tec_destination_outside_the_route_library_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["routes"][0]["destination"] = "KZZZ"

    with pytest.raises(ValueError, match=r"tec\.yaml routes\[TEC-KSMF-SFOW-J\]: destination 'KZZZ' is in no `destinations` row of routes\.yaml"):
        load_airport(airport_copy(tmp_path, ksfo_dir, tec=mutate))


def test_a_tec_plan_no_runway_config_declares_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["routes"][0]["plan"] = "SFOX"

    with pytest.raises(ValueError, match=r"tec\.yaml routes\[TEC-KSMF-SFOW-J\]: plan 'SFOX' is no `runway_configs` plan of sop\.yaml"):
        load_airport(airport_copy(tmp_path, ksfo_dir, tec=mutate))


def test_a_tec_route_naming_an_unknown_dp_family_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["routes"][0]["route"] = "TRUKEN# TRUKN FEVTA FEVTA1"

    with pytest.raises(ValueError, match=r"routes\[TEC-KSMF-SFOW-J\]: route names DP family 'TRUKEN', which has no procedure in overrides\.yaml"):
        load_airport(airport_copy(tmp_path, ksfo_dir, tec=mutate))


def test_an_unknown_aircraft_class_in_a_tec_row_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["routes"][0]["classes"] = ["J", "X"]

    with pytest.raises(ValueError, match=r"routes\[TEC-KSMF-SFOW-J\].classes\[1\]: 'X' is not one of \['P', 'T', 'J'\]"):
        load_tec(airport_copy(tmp_path, ksfo_dir, tec=mutate) / TEC_FILE)


def test_a_loa_destination_outside_the_route_library_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["rules"][1]["destinations"] = ["KSEA", "KZZZ"]

    with pytest.raises(ValueError, match=r"loa\.yaml rules\[LOA-ZSE-SEA-ROUTE\]: destination 'KZZZ' is in no `destinations` row of routes\.yaml"):
        load_airport(airport_copy(tmp_path, ksfo_dir, loa=mutate))


def test_a_rotated_parity_course_outside_the_compass_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["rules"][0]["rule"]["odd_course_to"] = OUT_OF_RANGE_COURSE

    with pytest.raises(ValueError, match=r"rules\[LOA-ZSE-PARITY\].rule.odd_course_to: course 360 is not a magnetic course between 0 and 359"):
        load_airport(airport_copy(tmp_path, ksfo_dir, loa=mutate))
