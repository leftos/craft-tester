"""The NCT terminal boundary: the polygons a destination's ``nct`` flag is computed from.

``generator/shared/nct_boundary.yaml`` holds the SimAware TRACON Project's NorCal polygons, one
closed ring per sector id, copied from the project's boundary file. A field is inside NCT when it
lies inside any of those rings, which is what :meth:`NctBoundary.contains` answers and what the build
writes into every destination row rather than reading a hand-written flag.

The rings are geographic, so the ray cast treats longitude as the sweep axis and latitude as the
value; the NorCal polygons are small enough that no ring crosses the antimeridian.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from craft_generator.sop.load import _load_yaml_mapping, _Row, _where

MINIMUM_RING_POINTS = 4
POINT_LENGTH = 2
LATITUDE_LIMIT = 90.0
LONGITUDE_LIMIT = 180.0


@dataclass(frozen=True, slots=True)
class NctPolygon:
    """One sector's boundary: its sector id, the name the source file gives it, and its closed ring."""

    id: str
    name: str
    ring: tuple[tuple[float, float], ...]


@dataclass(frozen=True, slots=True)
class NctBoundary:
    """Every polygon of the NCT terminal boundary, in the order the shared file lists them."""

    polygons: tuple[NctPolygon, ...]

    def contains(self, latitude: float, longitude: float) -> bool:
        """Return whether a point lies inside the NCT terminal boundary.

        Args:
            latitude: Latitude in degrees, positive north.
            longitude: Longitude in degrees, positive east.

        Returns:
            True when the point lies inside any polygon of the boundary, by an even-odd ray cast
            against each ring; a point on a boundary edge falls to whichever side the cast lands on,
            which no field this build reads sits on.
        """
        return any(_inside(polygon.ring, latitude, longitude) for polygon in self.polygons)


def _inside(ring: Sequence[tuple[float, float]], latitude: float, longitude: float) -> bool:
    crossings = False
    previous = len(ring) - 1
    for current, (latitude_current, longitude_current) in enumerate(ring):
        latitude_previous, longitude_previous = ring[previous]
        if (longitude_current > longitude) != (longitude_previous > longitude):
            edge = (latitude_previous - latitude_current) * (longitude - longitude_current) / (longitude_previous - longitude_current)
            if latitude < edge + latitude_current:
                crossings = not crossings
        previous = current
    return crossings


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def _pair(value: object) -> tuple[float, float] | None:
    if isinstance(value, str) or not isinstance(value, Sequence):
        return None
    items = list(value)
    if len(items) != POINT_LENGTH:
        return None
    latitude, longitude = _number(items[0]), _number(items[1])
    return None if latitude is None or longitude is None else (latitude, longitude)


def _point(value: object, where: str) -> tuple[float, float]:
    pair = _pair(value)
    if pair is None:
        raise ValueError(f"{where}: expected a [latitude, longitude] pair of numbers, got {value!r}")
    latitude, longitude = pair
    if not -LATITUDE_LIMIT <= latitude <= LATITUDE_LIMIT:
        raise ValueError(f"{where}: latitude {latitude} lies outside -90 to 90; the file states latitude first, longitude second")
    if not -LONGITUDE_LIMIT <= longitude <= LONGITUDE_LIMIT:
        raise ValueError(f"{where}: longitude {longitude} lies outside -180 to 180; the file states latitude first, longitude second")
    return latitude, longitude


def _polygon(sector: str, row: _Row, where: str) -> NctPolygon:
    name = row.text("name")
    raw = row.optional_raw("coordinates")
    at = f"{where} polygons[{sector}].coordinates"
    if raw is None:
        raise ValueError(f"{at}: the polygon states no coordinates; every polygon is one closed ring of [latitude, longitude] points")
    points = raw if isinstance(raw, Sequence) and not isinstance(raw, str) else []
    if len(points) < MINIMUM_RING_POINTS:
        raise ValueError(
            f"{at}: the ring holds {len(points)} point(s); a closed ring needs at least {MINIMUM_RING_POINTS}, the last repeating the first"
        )
    ring = tuple(_point(point, f"{at}[{index}]") for index, point in enumerate(points))
    row.finish()
    return NctPolygon(id=sector, name=name, ring=ring)


def load_nct_boundary(path: Path) -> NctBoundary:
    """Load the shared NCT terminal boundary polygons.

    The ``source`` block is checked for shape - it records which project the polygons were copied
    from and when - and the ``polygons`` table is what the build ray-casts against.

    Args:
        path: Path to ``generator/shared/nct_boundary.yaml``.

    Returns:
        Every polygon of the boundary, in the order the file lists them.

    Raises:
        ValueError: The file is not a YAML mapping, carries an unknown key, holds a ring of fewer
            than four points, a point that is not a pair of numbers, or a point outside -90 to 90
            latitude or -180 to 180 longitude.
        OSError: The file is missing.
    """
    where = _where(path)
    root = _Row(where, _load_yaml_mapping(path, where))
    source = root.child("source")
    source.text("title")
    source.text("url")
    source.day("copied_at")
    source.finish()
    table = root.table("polygons")
    root.finish()
    return NctBoundary(polygons=tuple(_polygon(sector, _Row(f"{where}.polygons[{sector}]", value), where) for sector, value in table.items()))
