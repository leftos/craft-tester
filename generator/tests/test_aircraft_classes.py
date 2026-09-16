from typing import Any

import pytest

from craft_generator.aircraft_classes import classes_for_fleet, classify_engine_type, fetch_aircraft_specs, parse_aircraft_specs, specs_cache_path
from craft_generator.http import cache_dir
from craft_generator.sop.model import AircraftClass, AirportInputs, FleetEntry


def fleet_entry(designator: str, aircraft_class: AircraftClass) -> FleetEntry:
    return FleetEntry(type=designator, aircraft_class=aircraft_class, wtc="M", suffixes=("/L",), airlines=())


def specs_of(*records: tuple[str, str]) -> list[dict[str, Any]]:
    return [{"Designator": designator, "EngineType": engine_type} for designator, engine_type in records]


def test_engine_types_map_to_the_three_sop_classes() -> None:
    assert classify_engine_type("Piston") == "P"
    assert classify_engine_type("Jet") == "J"
    assert classify_engine_type("Turboprop") == "T"
    assert classify_engine_type("Turboprop/Turboshaft") == "T"


def test_an_engine_type_with_no_sop_class_is_named() -> None:
    with pytest.raises(ValueError, match="vNAS EngineType 'Electric' has no SOP aircraft class"):
        classify_engine_type("Electric")


def test_the_whole_ksfo_fleet_classifies_as_declared(aircraft_specs_subset: list[dict[str, Any]], ksfo_inputs: AirportInputs) -> None:
    fleet = ksfo_inputs.routes.fleet
    classes = classes_for_fleet(aircraft_specs_subset, fleet)
    assert classes == {entry.type: entry.aircraft_class for entry in fleet}
    assert classes["B350"] == "T"
    assert classes["C172"] == "P"
    assert classes["A20N"] == "J"


def test_the_subset_fixture_covers_every_fleet_type(aircraft_specs_subset: list[dict[str, Any]], ksfo_inputs: AirportInputs) -> None:
    designators = {record["Designator"] for record in aircraft_specs_subset}
    assert designators == {entry.type for entry in ksfo_inputs.routes.fleet}


def test_a_turboshaft_record_classifies_as_turboprop(aircraft_specs_subset: list[dict[str, Any]]) -> None:
    tbm9 = [record for record in aircraft_specs_subset if record["Designator"] == "TBM9"]
    assert {record["EngineType"] for record in tbm9} == {"Turboprop/Turboshaft"}
    assert classes_for_fleet(aircraft_specs_subset, [fleet_entry("TBM9", "T")]) == {"TBM9": "T"}


def test_a_designator_with_no_record_is_named(aircraft_specs_subset: list[dict[str, Any]]) -> None:
    with pytest.raises(ValueError, match="aircraft type 'A32N' has no record with a Designator and an EngineType"):
        classes_for_fleet(aircraft_specs_subset, [fleet_entry("A32N", "J")])


def test_records_that_disagree_on_the_class_are_named() -> None:
    specs = specs_of(("B738", "Jet"), ("B738", "Piston"))
    with pytest.raises(ValueError, match=r"aircraft type 'B738' maps to more than one class, \['J', 'P'\]"):
        classes_for_fleet(specs, [fleet_entry("B738", "J")])


def test_a_class_the_fleet_declares_wrongly_is_named(aircraft_specs_subset: list[dict[str, Any]]) -> None:
    with pytest.raises(ValueError, match=r"aircraft type 'C172' is class 'P' in the vNAS aircraft specs .* but routes\.yaml declares class 'J'"):
        classes_for_fleet(aircraft_specs_subset, [fleet_entry("C172", "J")])


def test_records_without_the_fields_are_ignored() -> None:
    specs: list[dict[str, Any]] = [{"Designator": "C172"}, {"EngineType": "Piston"}, {"Designator": "C172", "EngineType": "Piston"}]
    assert classes_for_fleet(specs, [fleet_entry("C172", "P")]) == {"C172": "P"}


def test_a_payload_that_is_not_a_list_is_reported() -> None:
    with pytest.raises(ValueError, match="answered a dict, expected a list of aircraft records"):
        parse_aircraft_specs(b'{"Designator": "C172"}')


def test_a_payload_that_is_not_json_is_reported() -> None:
    with pytest.raises(ValueError, match="did not answer JSON"):
        parse_aircraft_specs(b"<html>503</html>")


def test_a_record_that_is_not_an_object_is_reported() -> None:
    with pytest.raises(ValueError, match="record 1 is a str, expected an object"):
        parse_aircraft_specs(b'[{"Designator": "C172"}, "C172"]')


def test_specs_cache_path(tmp_path_factory: pytest.TempPathFactory) -> None:
    cache = tmp_path_factory.mktemp("cache")
    assert specs_cache_path(cache) == cache / "vnas" / "AircraftSpecs.json"


@pytest.mark.network
def test_live_specs_still_class_the_fleet_as_declared(ksfo_inputs: AirportInputs) -> None:
    specs = fetch_aircraft_specs(cache_dir())
    fleet = ksfo_inputs.routes.fleet
    assert classes_for_fleet(specs, fleet) == {entry.type: entry.aircraft_class for entry in fleet}
