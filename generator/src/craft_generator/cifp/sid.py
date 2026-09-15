"""Grouping of ARINC 424 SID legs into one record per procedure.

Route types (field 5.7) split the legs of a SID: ``1``/``2``/``3`` are the conventional runway,
common and enroute portions, ``4``/``5``/``6`` their RNAV equivalents, and ``T``/``V`` the runway and
enroute portions of a vector SID. A procedure is classified RNAV when it publishes any ``4``/``5``/
``6`` leg, vector-hybrid when it publishes any ``T``/``V`` leg, and conventional otherwise.

A crossing restriction is a leg with a non-blank altitude description whose path terminator is not
one of the initial-climb terminators ``VA CA VI CI FM VM``; those legs carry the "climb heading 284
to 520" style altitude, which is part of the initial climb rather than a crossing restriction the
pilot flies on a climb-via clearance.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from craft_generator.cifp.records import SidRecord

ConstraintKind = Literal["at", "at_or_above", "at_or_below", "between"]
TransitionKind = Literal["enroute", "vector"]
SidKind = Literal["rnav_pilot_nav", "conventional_pilot_nav", "vector_hybrid"]

RUNWAY_ROUTE_TYPES = frozenset({"1", "4", "T"})
COMMON_ROUTE_TYPES = frozenset({"2", "5"})
ENROUTE_ROUTE_TYPES = frozenset({"3", "6"})
VECTOR_ENROUTE_ROUTE_TYPES = frozenset({"V"})
RNAV_ROUTE_TYPES = frozenset({"4", "5", "6"})
VECTOR_ROUTE_TYPES = frozenset({"T", "V"})
INITIAL_CLIMB_TERMINATORS = frozenset({"VA", "CA", "VI", "CI", "FM", "VM"})

_CONSTRAINTS: dict[str, ConstraintKind] = {"+": "at_or_above", "-": "at_or_below", "B": "between"}
_SID_ID_PATTERN = re.compile(r"(?P<family>[A-Z]+)(?P<version>\d+)")


@dataclass(frozen=True, slots=True)
class Restriction:
    """An altitude a SID leg must be crossed at."""

    fix: str
    constraint: ConstraintKind
    feet_low: int | None
    feet_high: int | None


@dataclass(frozen=True, slots=True)
class Transition:
    """One named transition of a SID and the fixes it sequences."""

    name: str
    kind: TransitionKind
    fixes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CifpSid:
    """One departure procedure as the CIFP publishes it."""

    id: str
    family: str
    version: int
    kind: SidKind
    runways: tuple[str, ...]
    common_fixes: tuple[str, ...]
    transitions: tuple[Transition, ...]
    restrictions: tuple[Restriction, ...]
    has_crossing_restrictions: bool


def parse_altitude(value: str) -> int | None:
    """Return a CIFP altitude field in feet.

    Args:
        value: The raw altitude field, e.g. ``"05000"``, ``"FL220"`` or blank.

    Returns:
        The altitude in feet, or ``None`` when the field is blank.

    Raises:
        ValueError: The field is neither blank, a digit string, nor a flight level.
    """
    text = value.strip()
    if not text:
        return None
    if text.startswith("FL") and text[2:].isdigit():
        return int(text[2:]) * 100
    if text.isdigit():
        return int(text)
    raise ValueError(f"unsupported CIFP altitude field {value!r}; expected blank, a digit string, or FLxxx")


def split_sid_id(sid_id: str) -> tuple[str, int]:
    """Split a SID id into its family and version.

    Args:
        sid_id: A SID identifier such as ``TRUKN2``.

    Returns:
        The family (``TRUKN``) and the version number (``2``).

    Raises:
        ValueError: The identifier is not letters followed by digits.
    """
    match = _SID_ID_PATTERN.fullmatch(sid_id)
    if match is None:
        raise ValueError(f"SID id {sid_id!r} is not letters followed by a version number; the CIFP row may be misaligned")
    return match.group("family"), int(match.group("version"))


def expand_runway_transition(ident: str, runways: Sequence[str]) -> tuple[str, ...]:
    """Expand a CIFP runway-transition identifier into runway designators.

    ``RW28B`` means both 28s, so it expands from the airport's runway list; ``RW10L`` names one
    runway and expands to itself.

    Args:
        ident: Runway transition identifier from a SID row, e.g. ``RW28B``.
        runways: The airport's runway designators without the ``RW`` prefix, e.g. ``("01L", "28R")``.

    Returns:
        The runway designators the transition covers, in the order given by ``runways``.

    Raises:
        ValueError: The identifier is not a runway transition, or a ``B`` wildcard matches no runway.
    """
    if not ident.startswith("RW"):
        raise ValueError(f"runway transition {ident!r} does not start with RW; the CIFP row may be misaligned")
    designator = ident.removeprefix("RW")
    if not designator.endswith("B"):
        return (designator,)
    number = designator.removesuffix("B")
    matches = tuple(runway for runway in runways if runway.startswith(number))
    if not matches:
        raise ValueError(f"runway transition {ident!r} matches none of the airport runways {tuple(runways)!r}")
    return matches


def restriction_for(record: SidRecord) -> Restriction | None:
    """Return the crossing restriction a SID leg publishes, if any.

    Args:
        record: One SID leg.

    Returns:
        The restriction, or ``None`` for a leg with no altitude description or an initial-climb path
        terminator.
    """
    if not record.altitude_desc.strip() or record.path_terminator in INITIAL_CLIMB_TERMINATORS:
        return None
    constraint = _CONSTRAINTS.get(record.altitude_desc, "at")
    first = parse_altitude(record.altitude1)
    second = parse_altitude(record.altitude2)
    if constraint == "at_or_above":
        return Restriction(record.fix, constraint, first, None)
    if constraint == "at_or_below":
        return Restriction(record.fix, constraint, None, first)
    if constraint == "between":
        return Restriction(record.fix, constraint, second, first)
    return Restriction(record.fix, constraint, first, first)


def _ordered_unique(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(value for value in values if value))


def _classify(route_types: Sequence[str]) -> SidKind:
    if any(route_type in RNAV_ROUTE_TYPES for route_type in route_types):
        return "rnav_pilot_nav"
    if any(route_type in VECTOR_ROUTE_TYPES for route_type in route_types):
        return "vector_hybrid"
    return "conventional_pilot_nav"


def _transitions_of(records: Sequence[SidRecord]) -> tuple[Transition, ...]:
    fixes: dict[tuple[str, TransitionKind], list[str]] = {}
    for record in records:
        if record.route_type in ENROUTE_ROUTE_TYPES:
            kind: TransitionKind = "enroute"
        elif record.route_type in VECTOR_ENROUTE_ROUTE_TYPES:
            kind = "vector"
        else:
            continue
        fixes.setdefault((record.transition, kind), []).append(record.fix)
    return tuple(Transition(name, kind, _ordered_unique(leg_fixes)) for (name, kind), leg_fixes in fixes.items())


def _runways_of(records: Sequence[SidRecord], runways: Sequence[str]) -> tuple[str, ...]:
    idents = _ordered_unique([record.transition for record in records if record.route_type in RUNWAY_ROUTE_TYPES])
    covered = {designator for ident in idents for designator in expand_runway_transition(ident, runways)}
    return tuple(sorted(covered))


def _restrictions_of(records: Sequence[SidRecord]) -> tuple[Restriction, ...]:
    found: dict[Restriction, None] = {}
    for record in records:
        restriction = restriction_for(record)
        if restriction is not None:
            found.setdefault(restriction, None)
    return tuple(found)


def _build_sid(sid_id: str, records: Sequence[SidRecord], runways: Sequence[str]) -> CifpSid:
    family, version = split_sid_id(sid_id)
    restrictions = _restrictions_of(records)
    return CifpSid(
        id=sid_id,
        family=family,
        version=version,
        kind=_classify([record.route_type for record in records]),
        runways=_runways_of(records, runways),
        common_fixes=_ordered_unique([record.fix for record in records if record.route_type in COMMON_ROUTE_TYPES]),
        transitions=_transitions_of(records),
        restrictions=restrictions,
        has_crossing_restrictions=bool(restrictions),
    )


def group_sids(records: Sequence[SidRecord], runways: Sequence[str]) -> dict[str, CifpSid]:
    """Group SID legs into one :class:`CifpSid` per procedure.

    Args:
        records: Every SID leg of one airport, in CIFP file order.
        runways: The airport's runway designators without the ``RW`` prefix, used to expand ``B``
            runway transitions such as ``RW28B``.

    Returns:
        The procedures keyed by SID id, ordered by id.

    Raises:
        ValueError: A SID id, altitude field or runway transition cannot be interpreted.
    """
    buckets: dict[str, list[SidRecord]] = {}
    for record in records:
        buckets.setdefault(record.sid_id, []).append(record)
    return {sid_id: _build_sid(sid_id, buckets[sid_id], runways) for sid_id in sorted(buckets)}
