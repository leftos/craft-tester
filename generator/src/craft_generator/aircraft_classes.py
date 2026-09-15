"""Aircraft class P/T/J for the curated fleet, from the vNAS aircraft specs.

``https://data-api.vnas.vatsim.net/Files/AircraftSpecs.json`` is the type table vNAS ships: about
ten thousand records keyed by ICAO ``Designator``, each carrying ``EngineType``, ``WTC`` and the
``Description`` code. The SOP splits departures three ways - prop, turboprop, jet - so only
``EngineType`` is read here, and only for the types ``routes.yaml`` curates.

The file is the authority on the split: a fleet row whose declared ``class`` disagrees with it fails
the build rather than quietly grading against the wrong SOP row, and a designator it does not know
is a typo in the fleet.
"""

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from craft_generator.http import fetch_bytes
from craft_generator.sop.model import AircraftClass, FleetEntry

AIRCRAFT_SPECS_URL = "https://data-api.vnas.vatsim.net/Files/AircraftSpecs.json"
DESIGNATOR_FIELD = "Designator"
ENGINE_TYPE_FIELD = "EngineType"

_TURBOPROP_PREFIX = "Turboprop"
_ENGINE_TYPE_CLASSES: dict[str, AircraftClass] = {"Piston": "P", "Jet": "J"}


def specs_cache_path(cache: Path) -> Path:
    """Return the cache file the vNAS aircraft specs are downloaded to."""
    return cache / "vnas" / "AircraftSpecs.json"


def parse_aircraft_specs(payload: bytes | str) -> list[dict[str, Any]]:
    """Read the vNAS aircraft specs file.

    Args:
        payload: The raw JSON body.

    Returns:
        One dictionary per aircraft type record, in file order.

    Raises:
        ValueError: The body is not JSON, or is not a list of records.
    """
    try:
        body = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{AIRCRAFT_SPECS_URL} did not answer JSON: {exc}") from exc
    if not isinstance(body, list):
        raise ValueError(f"{AIRCRAFT_SPECS_URL} answered a {type(body).__name__}, expected a list of aircraft records")
    for index, record in enumerate(body):
        if not isinstance(record, Mapping):
            raise ValueError(f"{AIRCRAFT_SPECS_URL} record {index} is a {type(record).__name__}, expected an object with a {DESIGNATOR_FIELD} field")
    return body


def fetch_aircraft_specs(cache: Path, *, force: bool = False) -> list[dict[str, Any]]:
    """Fetch the vNAS aircraft specs through the download cache.

    Args:
        cache: Download cache directory, normally :func:`craft_generator.http.cache_dir`.
        force: Re-download even when the cache already holds the file.

    Returns:
        One dictionary per aircraft type record.

    Raises:
        RuntimeError: The download failed.
        ValueError: The body is not the expected list of records.
    """
    return parse_aircraft_specs(fetch_bytes(AIRCRAFT_SPECS_URL, specs_cache_path(cache), force=force))


def classify_engine_type(engine_type: str) -> AircraftClass:
    """Return the SOP aircraft class of one vNAS ``EngineType``.

    Args:
        engine_type: The field as vNAS writes it, e.g. ``Piston``, ``Turboprop/Turboshaft``, ``Jet``.

    Returns:
        ``P`` for piston, ``T`` for any turboprop or turboshaft, ``J`` for jet.

    Raises:
        ValueError: The engine type is none of those; the SOP has no class for it.
    """
    if engine_type.startswith(_TURBOPROP_PREFIX):
        return "T"
    aircraft_class = _ENGINE_TYPE_CLASSES.get(engine_type)
    if aircraft_class is None:
        known = [*sorted(_ENGINE_TYPE_CLASSES), f"{_TURBOPROP_PREFIX}*"]
        raise ValueError(f"vNAS EngineType {engine_type!r} has no SOP aircraft class; the SOP splits departures into {known} only")
    return aircraft_class


def _class_for(entry: FleetEntry, engine_types: Sequence[str], known_types: int) -> AircraftClass:
    if not engine_types:
        raise ValueError(
            f"aircraft type {entry.type!r} has no record with a {DESIGNATOR_FIELD} and an {ENGINE_TYPE_FIELD} "
            f"among the {known_types} vNAS aircraft specs; fix the ICAO designator of that fleet row in routes.yaml"
        )
    classes = sorted({classify_engine_type(engine_type) for engine_type in engine_types})
    if len(classes) > 1:
        raise ValueError(
            f"aircraft type {entry.type!r} maps to more than one class, {classes}, from vNAS engine types "
            f"{sorted(set(engine_types))}; the fleet row cannot be classified from the specs"
        )
    if classes[0] != entry.aircraft_class:
        raise ValueError(
            f"aircraft type {entry.type!r} is class {classes[0]!r} in the vNAS aircraft specs "
            f"({ENGINE_TYPE_FIELD} {sorted(set(engine_types))[0]!r}) but routes.yaml declares class {entry.aircraft_class!r}; "
            "correct the fleet row or drop the type"
        )
    return classes[0]


def classes_for_fleet(specs: Sequence[Mapping[str, Any]], fleet: Sequence[FleetEntry]) -> dict[str, AircraftClass]:
    """Resolve the aircraft class of every curated fleet type against the vNAS specs.

    Args:
        specs: The records from :func:`fetch_aircraft_specs` or :func:`parse_aircraft_specs`.
        fleet: The ``routes.yaml`` fleet rows.

    Returns:
        The class of each fleet type, keyed by ICAO designator.

    Raises:
        ValueError: A designator has no vNAS record, its records disagree on the class, or the class
            disagrees with the one the fleet row declares.
    """
    by_designator: dict[str, list[str]] = {}
    for record in specs:
        designator = record.get(DESIGNATOR_FIELD)
        engine_type = record.get(ENGINE_TYPE_FIELD)
        if isinstance(designator, str) and isinstance(engine_type, str):
            by_designator.setdefault(designator, []).append(engine_type)
    return {entry.type: _class_for(entry, by_designator.get(entry.type, []), len(specs)) for entry in fleet}
