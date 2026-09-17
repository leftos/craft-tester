from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
import yaml

from craft_generator.nct_boundary import NctBoundary, NctPolygon, load_nct_boundary
from craft_generator.sop.load import NCT_BOUNDARY_FILE, shared_dir

POLYGON_COUNT = 11
INSIDE = {"KCCR": (37.9897, -122.0569), "KRNO": (39.4991, -119.7681), "KOAK": (37.7213, -122.2208)}
OUTSIDE = {"KAPC": (38.2132, -122.2807), "KSTS": (38.5090, -122.8129), "KTRK": (39.3200, -120.1396), "KFAT": (36.7762, -119.7181)}

# A square with a notch cut into its east side: the notch's mouth spans 37.4 to 37.6 north.
NOTCHED = NctPolygon(
    id="TEST",
    name="Notched square",
    ring=(
        (37.0, -122.0),
        (38.0, -122.0),
        (38.0, -121.0),
        (37.6, -121.0),
        (37.6, -121.5),
        (37.4, -121.5),
        (37.4, -121.0),
        (37.0, -121.0),
        (37.0, -122.0),
    ),
)


def boundary_file(tmp_path: Path, mutate: Callable[[dict[str, Any]], None]) -> Path:
    """Copy the checked-in boundary file into ``tmp_path``, applying a mutation to its data first."""
    data = yaml.safe_load((shared_dir() / NCT_BOUNDARY_FILE).read_text(encoding="utf-8"))
    mutate(data)
    path = tmp_path / NCT_BOUNDARY_FILE
    path.write_text(yaml.safe_dump(data), encoding="utf-8")
    return path


def test_the_checked_in_file_loads_every_polygon() -> None:
    boundary = load_nct_boundary(shared_dir() / NCT_BOUNDARY_FILE)
    assert len(boundary.polygons) == POLYGON_COUNT
    assert [polygon.id for polygon in boundary.polygons] == ["MOD", "MRY", "NCT", "NCT_DEP", "OAK", "RNO", "SFO", "SFO_DEP", "SJC", "SJC_DEP", "SMF"]
    assert boundary.polygons[0].name == "NorCal Approach"
    assert boundary.polygons[0].ring[0] == (38.2841, -120.33028)
    assert all(polygon.ring[0] == polygon.ring[-1] for polygon in boundary.polygons)


def test_the_fields_inside_nct_are_contained() -> None:
    boundary = load_nct_boundary(shared_dir() / NCT_BOUNDARY_FILE)
    assert {icao: boundary.contains(*point) for icao, point in INSIDE.items()} == dict.fromkeys(INSIDE, True)


def test_the_fields_outside_nct_are_not_contained() -> None:
    boundary = load_nct_boundary(shared_dir() / NCT_BOUNDARY_FILE)
    assert {icao: boundary.contains(*point) for icao, point in OUTSIDE.items()} == dict.fromkeys(OUTSIDE, False)


def test_a_concave_ring_excludes_its_notch() -> None:
    boundary = NctBoundary(polygons=(NOTCHED,))
    assert boundary.contains(37.5, -121.8) is True
    assert boundary.contains(37.5, -120.9) is False
    assert boundary.contains(37.5, -121.2) is False
    assert boundary.contains(37.9, -121.2) is True


def test_an_unknown_key_fails_the_load(tmp_path: Path) -> None:
    def mutate(data: dict[str, Any]) -> None:
        polygons = data["polygons"]
        polygons["MOD"]["floor_feet"] = 0

    with pytest.raises(ValueError, match=r"polygons\[MOD\]: unknown key\(s\) \['floor_feet'\]"):
        load_nct_boundary(boundary_file(tmp_path, mutate))


def test_a_ring_of_fewer_than_four_points_fails_the_load(tmp_path: Path) -> None:
    def mutate(data: dict[str, Any]) -> None:
        polygons = data["polygons"]
        polygons["MOD"]["coordinates"] = polygons["MOD"]["coordinates"][:3]

    with pytest.raises(ValueError, match=r"polygons\[MOD\]\.coordinates: the ring holds 3 point\(s\); a closed ring needs at least 4"):
        load_nct_boundary(boundary_file(tmp_path, mutate))


def test_a_point_that_is_not_a_pair_of_numbers_fails_the_load(tmp_path: Path) -> None:
    def mutate(data: dict[str, Any]) -> None:
        polygons = data["polygons"]
        polygons["MOD"]["coordinates"][2] = [38.04, "-120.17"]

    with pytest.raises(ValueError, match=r"polygons\[MOD\]\.coordinates\[2\]: expected a \[latitude, longitude\] pair of numbers"):
        load_nct_boundary(boundary_file(tmp_path, mutate))


def test_a_latitude_outside_the_globe_fails_the_load(tmp_path: Path) -> None:
    def mutate(data: dict[str, Any]) -> None:
        polygons = data["polygons"]
        polygons["MOD"]["coordinates"][1] = [138.04, -120.17]

    with pytest.raises(ValueError, match=r"polygons\[MOD\]\.coordinates\[1\]: latitude 138.04 lies outside -90 to 90"):
        load_nct_boundary(boundary_file(tmp_path, mutate))


def test_a_longitude_outside_the_globe_fails_the_load(tmp_path: Path) -> None:
    def mutate(data: dict[str, Any]) -> None:
        polygons = data["polygons"]
        polygons["MOD"]["coordinates"][1] = [38.04, -220.17]

    with pytest.raises(ValueError, match=r"polygons\[MOD\]\.coordinates\[1\]: longitude -220.17 lies outside -180 to 180"):
        load_nct_boundary(boundary_file(tmp_path, mutate))


def test_a_polygon_without_coordinates_fails_the_load(tmp_path: Path) -> None:
    def mutate(data: dict[str, Any]) -> None:
        polygons = data["polygons"]
        del polygons["MOD"]["coordinates"]

    with pytest.raises(ValueError, match=r"polygons\[MOD\]\.coordinates: the polygon states no coordinates"):
        load_nct_boundary(boundary_file(tmp_path, mutate))
