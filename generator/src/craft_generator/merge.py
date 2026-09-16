"""The join: CIFP records, chart text, vNAS classes and the hand-authored YAML into one document.

:func:`build_airport` produces the camelCase ``data/<icao>.json`` document that
``data/schema/airport.schema.json`` describes. Three sources meet here and the precedence between
them is always the same: ``overrides.yaml`` wins over the chart text, which wins over the CIFP,
because the overrides are the only place a human states a fact the two machine sources get wrong or
do not carry at all. SAN FRANCISCO FIVE is the extreme case - the FAA codes no CIFP records for a
radar-vector SID, so its kind, runways and top altitude come entirely from the override.

What the sources disagree about is a build failure, not a silent choice: a SID whose chart publishes
a different set of transition fixes than the CIFP codes stops the build, as does a rule naming a DP
family no procedure has, an exit fix in no gate, a runway no runway record lists, or a fleet type the
vNAS specs cannot class. A TEC row is checked the same way: the DP its route begins on must be
published for at least one runway family the row departs from. The arrival a route tail ends on is
the same bargain read the other way: the tail names the family with the ``#`` placeholder and the
build substitutes the revision the CIFP publishes, so no revision number is ever transcribed. A
family the destination does not publish stops the build, as does one whose destination publishes no
arrival at all, and so does a literal revision written for a destination the FAA file carries. The
literal form survives only for a destination the file does not carry - every foreign one, where
nothing can be resolved and the identifier stays hand-maintained. Three conditions only warn, because each is ordinary while the data is
being built up: a SID no assignment rule ever issues, a gate fix no route in the library uses, and a route tail that ends on an arrival
an LOA row names for other destinations. The last one only warns because it cannot be proved: an arrival may serve several airports, so
what makes one wrong for a destination is not being published there, and the FAA file carries no procedures at all for a foreign
destination. A Seattle STAR ending a Vancouver route is a smell the build reports rather than an error it can demonstrate.

``fixSpoken`` is derived, not transcribed: every two- or three-letter token the route library, the
TEC rows, the gates, the SID transitions and the checked-in fixtures name is looked up in the CIFP
navaid table and emitted as the name and its facility word, "Red Bluff VOR". A hand ``fix_spoken``
row still wins, for the names the CIFP spells badly. A navaid the airport data names and neither
source names is a build failure, because the speaker would otherwise spell it out letter by letter;
one only a worksheet fixture names is a warning, as those routes are transcribed from the sheets
rather than curated. Transitions are the exception that keeps their published name: ``spoken`` on a
transition is the bare navaid name, "Mendocino", because a controller says "Mendocino transition"
but "radar vectors Mendocino VOR".

Two SID facts are computed here rather than transcribed. ``climbViaEligible`` follows FAA JO 7110.65
4-3-2 c as ZOA applies it: a procedure may be cleared "climb via SID" when it publishes crossing
restrictions **or** a top altitude, and when it has no vector segment - so the radar-vector and
vector-hybrid kinds are never eligible, while SNTNA2, which publishes 3,000 as its top altitude and
no crossing restriction, is (the ZOA S1-SFO-0 CBT clears it with "climb via SID, top altitude
3000"). ``baseFix`` is the fix the enroute transitions of a SID all begin at - TRUKN2 starts each of
its six transitions at TRUKN - which is the fix a route may exit the procedure at without naming a
transition. It is omitted when the transitions do not agree on one fix, when the procedure codes no
transition at all, and when the fix they agree on is the airport itself, as the vector transitions
of GAPP7 are coded from KSFO.
"""

import re
import sys
from collections import Counter
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any

from craft_generator.chart_text import ChartFacts, TopAltitude
from craft_generator.cifp.airports import AirportRecord
from craft_generator.cifp.navaids import Navaid
from craft_generator.cifp.sid import CifpSid, Restriction, Transition
from craft_generator.sop.load import RUNWAY_FAMILY_LENGTH, SID_PLACEHOLDER, sid_family_of
from craft_generator.sop.model import (
    AircraftClass,
    AirportInfo,
    AirportInputs,
    AltitudeOutcome,
    AltitudeRule,
    AssignmentCondition,
    AssignmentRule,
    DepartureRunway,
    DepartureSector,
    Destination,
    EquipmentSuffix,
    FleetEntry,
    GateDirection,
    Gates,
    LoaRule,
    LoaRuleKind,
    MaxAltitudeRule,
    NoiseWindow,
    Notice,
    ParityRotatedRule,
    PhraseologyRule,
    RouteEntry,
    RouteTokenRule,
    RunwayConfig,
    SidOverride,
    SidTopAltitude,
    SopData,
    TecRoute,
)

Document = dict[str, Any]

PILOT_NAV_KINDS = frozenset({"rnav_pilot_nav", "conventional_pilot_nav"})
RNAV_KIND = "rnav_pilot_nav"
VECTOR_SEGMENT_KINDS = frozenset({"radar_vectors", "vector_hybrid"})
PUBLISHED_TOP_ALTITUDE = "published"

_CLOCK = re.compile(r"^(?P<hours>[01]\d|2[0-3]):?(?P<minutes>[0-5]\d)$")
_NAVAID_TOKEN = re.compile(r"[A-Z]{2,3}")
_PROCEDURE_TOKEN = re.compile(r"(?P<family>[A-Z]{3,5})\d+")
_PROCEDURE_FAMILY_TOKEN = re.compile(rf"(?P<family>[A-Z]{{3,5}}){re.escape(SID_PLACEHOLDER)}")


@dataclass(frozen=True, slots=True)
class ChartInput:
    """One departure chart: the facts read off its text layer and the URL its PDF came from."""

    facts: ChartFacts
    pdf_url: str


@dataclass(frozen=True, slots=True)
class Provenance:
    """Where a build's machine-read sources came from, as the document records them."""

    cycle: str
    effective: date
    cifp_sha256: str
    charts_api_url: str


@dataclass(frozen=True, slots=True)
class BuildInputs:
    """Every source :func:`build_airport` joins, already parsed.

    ``sids``, ``runways``, ``navaids``, ``airport_records`` and ``destination_stars`` come from the
    CIFP - the navaids keyed by identifier, the airport records by ICAO identifier - ``charts`` from the
    charts API and the chart PDFs (keyed by chart name, in the order the API lists them),
    ``aircraft_classes`` from the vNAS specs, and ``fixture_routes`` from the filed route of every
    checked-in fixture of the airport, which name navaids the airport data itself never mentions.

    ``equipment_suffixes`` and ``phraseology_rules`` come from ``generator/shared/``, the YAML every
    airport inherits; the airport's own ``sop.yaml`` overrides a phraseology row by id.

    ``destination_stars`` is every arrival each destination publishes, keyed by ICAO identifier. A
    destination the FAA file does not carry - every foreign one - is simply absent, as is a US airport
    that publishes no arrival at all.
    """

    airport: AirportInputs
    sids: dict[str, CifpSid]
    runways: tuple[str, ...]
    navaids: dict[str, Navaid]
    charts: dict[str, ChartInput]
    aircraft_classes: dict[str, AircraftClass]
    airport_records: dict[str, AirportRecord]
    destination_stars: dict[str, frozenset[str]]
    equipment_suffixes: tuple[EquipmentSuffix, ...]
    phraseology_rules: tuple[PhraseologyRule, ...]
    fixture_routes: tuple[str, ...]
    provenance: Provenance


def _with_optional(base: Document, **optional: Any) -> Document:
    base.update({key: value for key, value in optional.items() if value is not None})
    return base


def _texts(values: Sequence[str] | None) -> list[str] | None:
    return None if values is None else list(values)


def _gate_items(gates: Gates) -> Iterator[tuple[GateDirection, tuple[str, ...]]]:
    yield "north", gates.north
    yield "south", gates.south
    yield "oceanic", gates.oceanic


def _clock(value: str, where: str) -> str:
    match = _CLOCK.fullmatch(value.strip())
    if match is None:
        raise ValueError(f"{where}: {value!r} is not a local time such as 22:00 or 2200; the schema wants HHMM")
    return f"{match.group('hours')}{match.group('minutes')}"


def _airport(info: AirportInfo, airport_records: Mapping[str, AirportRecord]) -> Document:
    found = airport_records.get(info.icao)
    if found is None:
        raise ValueError(
            f"sop.yaml airport.icao {info.icao!r}: the CIFP carries no airport record for it, so the document has no reference point; "
            "correct the identifier, as the direction-of-flight rules measure the course from it"
        )
    return {
        "icao": info.icao,
        "faa": info.faa,
        "spoken": info.spoken,
        "clearanceDelivery": info.clearance_delivery,
        "lat": found.latitude,
        "lon": found.longitude,
        "magneticVariation": found.magnetic_variation,
    }


def _provenance(sop: SopData, provenance: Provenance) -> Document:
    source = sop.source
    return {
        "airac": {"cycle": provenance.cycle, "effective": provenance.effective.isoformat(), "cifpSha256": provenance.cifp_sha256},
        "chartsApi": provenance.charts_api_url,
        "sop": {
            "url": source.url,
            "version": source.version,
            "sha256": source.sha256,
            "transcribedAt": source.transcribed_at.isoformat(),
        },
        "secondarySources": [
            {"id": entry.id, "title": entry.title, "dated": entry.dated.isoformat(), "url": entry.url} for entry in sop.secondary_sources
        ],
    }


def _departure_runway(runway: DepartureRunway) -> Document:
    entry: Document = {
        "runway": runway.runway,
        "classes": list(runway.classes),
        "defaultForClasses": list(runway.default_for_classes),
        "onRequestFor": list(runway.on_request_for),
    }
    return _with_optional(entry, note=runway.note)


def _runway_config(config: RunwayConfig) -> Document:
    return {
        "id": config.id,
        "source": config.source,
        "name": config.name,
        "plan": config.plan,
        "trainingWeight": config.training_weight,
        "arrivalRunways": list(config.arrival_runways),
        "departureRunways": [_departure_runway(runway) for runway in config.departure_runways],
    }


def _sector(sector: DepartureSector) -> Document:
    return {"id": sector.id, "name": sector.name, "frequency": sector.frequency}


def _noise_window(window: NoiseWindow) -> Document:
    where = f"sop.yaml noise_windows[{window.id}]"
    entry: Document = {"id": window.id, "start": _clock(window.start, f"{where}.start"), "end": _clock(window.end, f"{where}.end")}
    if window.sunday_end is not None:
        entry["sundayEnd"] = _clock(window.sunday_end, f"{where}.sunday_end")
    return entry


def _condition(when: AssignmentCondition) -> Document:
    return _with_optional(
        {},
        configs=_texts(when.configs),
        notConfigs=_texts(when.not_configs),
        noiseWindow=when.noise_window,
        rnav=when.rnav,
        exitFixes=_texts(when.exit_fixes),
        forcedTransition=when.forced_transition,
    )


def _assignment_rule(rule: AssignmentRule) -> Document:
    entry: Document = {
        "id": rule.id,
        "source": rule.source,
        "text": rule.text,
        "plan": rule.plan,
        "direction": rule.direction,
        "runwayFamilies": list(rule.runway_families),
        "classes": list(rule.classes),
        "sidFamily": rule.sid_family,
        "sector": rule.sector,
    }
    return _with_optional(entry, nonDpHeading=rule.non_dp_heading, when=None if rule.when is None else _condition(rule.when))


def _altitude_outcome(outcome: AltitudeOutcome, where: str) -> Document:
    if outcome.kind != "interim":
        return {"kind": outcome.kind}
    if outcome.feet is None:
        raise ValueError(f"{where}: an interim altitude outcome needs `feet`")
    return {"kind": "interim", "feet": outcome.feet}


def _altitude_rule(rule: AltitudeRule) -> Document:
    entry: Document = {
        "id": rule.id,
        "source": rule.source,
        "text": rule.text,
        "plan": rule.plan,
        "runwayFamilies": list(rule.runway_families),
        "classes": list(rule.classes),
        "outcome": _altitude_outcome(rule.outcome, f"sop.yaml altitude_rules[{rule.id}].outcome"),
        "whenTopAltitudePublished": rule.when_top_altitude_published,
        "expectAfterMinutes": rule.expect_after_minutes,
    }
    return _with_optional(entry, sidFamilies=_texts(rule.sid_families))


def _notice(notice: Notice) -> Document:
    return {
        "id": notice.id,
        "source": notice.source,
        "dated": notice.dated.isoformat(),
        "text": notice.text,
        "plan": notice.plan,
        "effect": {"kind": notice.effect.kind, "sidFamily": notice.effect.sid_family},
        "defaultActive": notice.default_active,
    }


def _equipment_suffix(suffix: EquipmentSuffix) -> Document:
    return {
        "suffix": suffix.suffix,
        "rnav": suffix.rnav,
        "gnss": suffix.gnss,
        "rvsm": suffix.rvsm,
        "transponderModeC": suffix.transponder_mode_c,
        "text": suffix.text,
    }


def _phraseology_rules(shared: Sequence[PhraseologyRule], airport: Sequence[PhraseologyRule]) -> list[Document]:
    """Join the phraseology rows every airport shares with the rows one airport states itself.

    Args:
        shared: The inherited rows, in the order ``shared/phraseology_rules.yaml`` states them.
        airport: The rows the airport's ``sop.yaml`` states, in its file order.

    Returns:
        The shared rows in shared-file order, each replaced in place by the airport row of the same
        id where the airport states one, followed by the rows only the airport has, in its file order.
    """
    overrides = {rule.id: rule for rule in airport}
    shared_ids = {rule.id for rule in shared}
    rules = [overrides.get(rule.id, rule) for rule in shared]
    rules += [rule for rule in airport if rule.id not in shared_ids]
    return [{"id": rule.id, "source": rule.source, "text": rule.text} for rule in rules]


def _destination(destination: Destination, airport_records: Mapping[str, AirportRecord]) -> Document:
    latitude, longitude = destination.lat, destination.lon
    if latitude is None or longitude is None:
        found = airport_records.get(destination.icao)
        if found is None:
            raise ValueError(
                f"routes.yaml destinations[{destination.icao}]: the CIFP has no airport record for {destination.icao!r} and the row gives no "
                "lat/lon; add hand coordinates to that row, as the FAA file carries US airports only"
            )
        latitude, longitude = found.latitude, found.longitude
    return {
        "icao": destination.icao,
        "spoken": destination.spoken,
        "artcc": destination.artcc,
        "nct": destination.nct,
        "lat": latitude,
        "lon": longitude,
    }


def _fleet_entry(entry: FleetEntry) -> Document:
    return {
        "type": entry.type,
        "class": entry.aircraft_class,
        "wtc": entry.wtc,
        "ceilingFeet": entry.ceiling_feet,
        "suffixes": list(entry.suffixes),
        "airlines": list(entry.airlines),
    }


def _route_where(route: RouteEntry) -> str:
    return f"routeLibrary.routes[{route.exit_fix} -> {route.destination}].tail"


def _resolved_arrival(
    family: str,
    route: RouteEntry,
    airport_records: Mapping[str, AirportRecord],
    destination_stars: Mapping[str, frozenset[str]],
) -> str:
    """Return the identifier of the one arrival ``family`` the destination publishes."""
    where = _route_where(route)
    destination = route.destination
    if destination not in airport_records:
        raise ValueError(
            f"{where}: the tail names arrival family {family!r} with the {SID_PLACEHOLDER} placeholder, but the FAA file carries no "
            f"procedure for {destination}, so the revision cannot be resolved; write the published identifier literally, {family} plus its "
            "revision, which is then hand-maintained from the destination's own source"
        )
    published = destination_stars.get(destination)
    if published is None:
        raise ValueError(
            f"{where}: the tail names arrival family {family!r}, but {destination} publishes no arrival at all; end the tail on a fix instead"
        )
    matching = sorted(star for star in published if sid_family_of(star, where) == family)
    if not matching:
        raise ValueError(
            f"{where}: the tail names arrival family {family!r}, which {destination} does not publish; it publishes {sorted(published)}; "
            "correct the family, or end the tail on a fix"
        )
    if len(matching) > 1:
        raise ValueError(
            f"{where}: the tail names arrival family {family!r}, which {destination} publishes as {matching}; the build cannot choose between "
            "them, so write the identifier of the one the route files literally"
        )
    return matching[0]


def _resolved_tail(route: RouteEntry, airport_records: Mapping[str, AirportRecord], destination_stars: Mapping[str, frozenset[str]]) -> str:
    """Return the tail with its trailing arrival resolved to the revision the destination publishes now."""
    tokens = route.tail.split()
    if not tokens:
        return route.tail
    placeholder = _PROCEDURE_FAMILY_TOKEN.fullmatch(tokens[-1])
    if placeholder is not None:
        tokens[-1] = _resolved_arrival(placeholder.group("family"), route, airport_records, destination_stars)
        return " ".join(tokens)
    literal = _PROCEDURE_TOKEN.fullmatch(tokens[-1])
    if literal is not None and route.destination in airport_records:
        raise ValueError(
            f"{_route_where(route)}: the tail ends on the literal arrival {tokens[-1]!r}, but the FAA file carries {route.destination}, so the "
            f"build resolves the published revision itself; write {literal.group('family')}{SID_PLACEHOLDER} instead and let the CIFP supply "
            "the number, which keeps the row current across AIRAC cycles"
        )
    return route.tail


def _route_entry(route: RouteEntry, airport_records: Mapping[str, AirportRecord], destination_stars: Mapping[str, frozenset[str]]) -> Document:
    return {
        "exitFix": route.exit_fix,
        "tail": _resolved_tail(route, airport_records, destination_stars),
        "destination": route.destination,
        "classes": list(route.classes),
        "altitudes": list(route.altitudes),
    }


def _tec_route(route: TecRoute, source: str) -> Document:
    entry: Document = {
        "id": route.id,
        "source": source,
        "kind": route.kind,
        "destination": route.destination,
        "plan": route.plan,
        "runwayFamilies": list(route.runway_families),
        "classes": list(route.classes),
        "route": route.route,
    }
    return _with_optional(entry, altitudeCapFeet=route.altitude_cap_feet)


def _tec_routes(inputs: BuildInputs) -> list[Document]:
    tec = inputs.airport.tec
    if tec is None:
        return []
    source = f"{tec.source.title}, {tec.source.url}"
    return [_tec_route(route, source) for route in tec.routes]


def _loa_effect(rule: LoaRuleKind) -> Document:
    if isinstance(rule, ParityRotatedRule):
        return {"kind": rule.kind, "oddCourseFrom": rule.odd_course_from, "oddCourseTo": rule.odd_course_to}
    if isinstance(rule, MaxAltitudeRule):
        return {"kind": rule.kind, "feet": rule.feet}
    if isinstance(rule, RouteTokenRule):
        return {"kind": rule.kind, "tokens": list(rule.tokens)}
    return {"kind": rule.kind}


def _loa_rule(rule: LoaRule) -> Document:
    entry: Document = {"id": rule.id, "source": rule.source, "text": rule.text, "rule": _loa_effect(rule.rule)}
    return _with_optional(entry, artcc=rule.artcc, destinations=_texts(rule.destinations))


def _loa_rules(inputs: BuildInputs) -> list[Document]:
    loa = inputs.airport.loa
    return [] if loa is None else [_loa_rule(rule) for rule in loa.rules]


def _route_library(inputs: BuildInputs) -> Document:
    routes = inputs.airport.routes
    return {
        "destinations": [_destination(destination, inputs.airport_records) for destination in routes.destinations],
        "telephony": dict(routes.telephony),
        "cargoAirlines": list(routes.cargo_airlines),
        "fleet": [_fleet_entry(entry) for entry in routes.fleet],
        "routes": [_route_entry(route, inputs.airport_records, inputs.destination_stars) for route in routes.routes],
    }


def _transition_spoken(fix: str, navaids: Mapping[str, Navaid], fix_spoken: Mapping[str, str]) -> str:
    navaid = navaids.get(fix)
    if navaid is not None:
        return navaid.name
    spoken = fix_spoken.get(fix)
    return spoken if spoken else fix.capitalize()


def _transition(transition: Transition, override: SidOverride, navaids: Mapping[str, Navaid], fix_spoken: Mapping[str, str], where: str) -> Document:
    if not transition.fixes:
        raise ValueError(f"{where}: transition {transition.name!r} sequences no fix, so it has no terminal fix to speak")
    fix = transition.fixes[-1]
    spoken_as_transition = override.transitions_spoken_as_transition
    if spoken_as_transition is None:
        spoken_as_transition = transition.kind == "enroute"
    return {
        "fix": fix,
        "spoken": _transition_spoken(fix, navaids, fix_spoken),
        "kind": transition.kind,
        "spokenAsTransition": spoken_as_transition,
    }


def _transitions(cifp: CifpSid | None, override: SidOverride, navaids: Mapping[str, Navaid], fix_spoken: Mapping[str, str]) -> list[Document]:
    if cifp is None:
        return []
    where = f"CIFP {cifp.id}"
    transitions = [_transition(transition, override, navaids, fix_spoken, where) for transition in cifp.transitions]
    return sorted(transitions, key=lambda entry: str(entry["fix"]))


def _restriction(restriction: Restriction) -> Document:
    entry: Document = {"fix": restriction.fix, "altitudeDescription": restriction.constraint}
    return _with_optional(entry, altitudeOneFeet=restriction.feet_low, altitudeTwoFeet=restriction.feet_high)


def _top_altitude(override: SidTopAltitude | None, published: TopAltitude, where: str) -> Document:
    kind = override.kind if override is not None else published.kind
    feet = override.feet if override is not None else published.feet
    if kind != "published":
        return {"kind": kind}
    if feet is None:
        raise ValueError(f"{where}: the top altitude is published but carries no feet; state `feet` in the override or fix the chart parser")
    return {"kind": "published", "feet": feet}


def _required(value: Any, where: str, key: str) -> Any:
    if value is None:
        raise ValueError(f"{where}: no CIFP records carry {key!r} for this procedure, so the override must state it")
    return value


def _check_chart_transitions(sid_id: str, chart: ChartInput, transitions: Sequence[Document]) -> None:
    charted = set(chart.facts.transitions.values())
    coded = {str(transition["fix"]) for transition in transitions}
    if not charted or not coded or charted == coded:
        return
    raise ValueError(
        f"{sid_id} ({chart.facts.chart_name}): the chart publishes transitions to {sorted(charted)} but the CIFP codes {sorted(coded)}; "
        "one of the two is stale, so re-capture the chart text or the CIFP rows for this cycle"
    )


def _base_fix(cifp: CifpSid | None, icao: str) -> str | None:
    if cifp is None:
        return None
    first_fixes = {transition.fixes[0] for transition in cifp.transitions if transition.fixes}
    if len(first_fixes) != 1:
        return None
    fix = first_fixes.pop()
    return None if fix == icao else fix


def _climb_via_eligible(kind: str, top_altitude: Document, *, has_restrictions: bool) -> bool:
    if kind in VECTOR_SEGMENT_KINDS:
        return False
    return has_restrictions or top_altitude["kind"] == PUBLISHED_TOP_ALTITUDE


def _sid(
    chart_name: str,
    chart: ChartInput,
    override: SidOverride,
    cifp: CifpSid | None,
    fix_spoken: Mapping[str, str],
    *,
    navaids: Mapping[str, Navaid],
    icao: str,
) -> Document:
    where = f"overrides.yaml sids[{chart_name}]"
    kind = override.kind if override.kind is not None else _required(None if cifp is None else cifp.kind, where, "kind")
    runways = override.runways if override.runways is not None else _required(None if cifp is None else cifp.runways, where, "runways")
    has_restrictions = override.has_crossing_restrictions
    if has_restrictions is None:
        has_restrictions = cifp is not None and cifp.has_crossing_restrictions
    transitions = _transitions(cifp, override, navaids, fix_spoken)
    _check_chart_transitions(override.cifp_id, chart, transitions)
    top_altitude = _top_altitude(override.top_altitude, chart.facts.top_altitude, where)
    entry: Document = {
        "id": override.cifp_id,
        "family": sid_family_of(override.cifp_id, where),
        "chartName": chart_name,
        "spoken": _required(override.spoken, where, "spoken"),
        "kind": kind,
        "rnavRequired": kind == RNAV_KIND,
        "runways": list(runways),
        "transitions": transitions,
        "topAltitude": top_altitude,
        "chartExpectFiledAltitudeMinutes": chart.facts.expect_filed_altitude_minutes,
        "hasCrossingRestrictions": has_restrictions,
        "restrictions": [] if cifp is None else [_restriction(restriction) for restriction in cifp.restrictions],
        "climbViaEligible": _climb_via_eligible(kind, top_altitude, has_restrictions=has_restrictions),
        "routePhrasing": override.route_phrasing if override.route_phrasing is not None else _route_phrasing(kind),
        "chartFrequencies": [_with_optional({"frequency": frequency.frequency}, note=frequency.note) for frequency in chart.facts.dep_frequencies],
        "chart": {"pdfUrl": chart.pdf_url},
    }
    return _with_optional(
        entry,
        baseFix=_base_fix(cifp, icao),
        crossingRestrictionsByRunwayFamily=None
        if override.crossing_restrictions_by_runway_family is None
        else dict(override.crossing_restrictions_by_runway_family),
        note=override.note,
    )


def _route_phrasing(kind: str) -> str:
    return "transition" if kind in PILOT_NAV_KINDS else "radar_vectors_fix"


def _sids(inputs: BuildInputs) -> list[Document]:
    overrides = inputs.airport.overrides
    documents: list[Document] = []
    for chart_name, chart in inputs.charts.items():
        override = overrides.sids.get(chart_name)
        if override is None:
            known = sorted(overrides.sids)
            raise ValueError(f"overrides.yaml has no `sids` entry for chart {chart_name!r}, which the charts API publishes; it carries {known}")
        documents.append(
            _sid(
                chart_name,
                chart,
                override,
                inputs.sids.get(override.cifp_id),
                overrides.fix_spoken,
                navaids=inputs.navaids,
                icao=inputs.airport.icao,
            )
        )
    return documents


def _wanted_families(document: Document) -> list[tuple[str, str]]:
    wanted = [(rule["sidFamily"], f"assignmentRules[{rule['id']}].sidFamily") for rule in document["assignmentRules"] if rule["sidFamily"]]
    wanted += [(family, f"altitudeRules[{rule['id']}].sidFamilies") for rule in document["altitudeRules"] for family in rule.get("sidFamilies", [])]
    wanted += [(notice["effect"]["sidFamily"], f"notices[{notice['id']}].effect.sidFamily") for notice in document["notices"]]
    return wanted


def _check_sid_families(document: Document) -> None:
    counts = Counter(sid["family"] for sid in document["sids"])
    for family, where in _wanted_families(document):
        if counts[family] != 1:
            ids = sorted(sid["id"] for sid in document["sids"] if sid["family"] == family)
            raise ValueError(
                f"{where}: DP family {family!r} resolves to {counts[family]} procedures {ids}, expected exactly one; "
                f"fix the family or the `cifp_id` of the charts in overrides.yaml. Known families: {sorted(counts)}"
            )


def _gate_directions(document: Document) -> dict[str, list[str]]:
    directions: dict[str, list[str]] = {}
    for direction, fixes in document["gates"].items():
        for fix in fixes:
            directions.setdefault(fix, []).append(direction)
    return directions


def _fixes_needing_a_gate(document: Document) -> list[tuple[str, str]]:
    wanted = [(transition["fix"], f"sids[{sid['id']}].transitions") for sid in document["sids"] for transition in sid["transitions"]]
    wanted += [(route["exitFix"], f"routeLibrary.routes[{route['exitFix']} -> {route['destination']}].exitFix") for route in _routes(document)]
    wanted += [
        (route["tail"].split()[0], f"routeLibrary.routes[{route['exitFix']} -> {route['destination']}].tail")
        for route in _routes(document)
        if route["tail"].split()
    ]
    return wanted


def _routes(document: Document) -> list[Document]:
    return list(document["routeLibrary"]["routes"])


def _check_gate_fixes(document: Document) -> None:
    directions = _gate_directions(document)
    missing = sorted({f"{fix} ({where})" for fix, where in _fixes_needing_a_gate(document) if len(directions.get(fix, [])) != 1})
    if missing:
        raise ValueError(
            f"{len(missing)} fix(es) are not in exactly one gate direction: {missing}; "
            "add each to gates.north, gates.south or gates.oceanic in sop.yaml so the engine can resolve its direction"
        )


def _transition_fixes_by_family(document: Document) -> dict[str, set[str]]:
    return {sid["family"]: {transition["fix"] for transition in sid["transitions"]} for sid in document["sids"]}


def _check_forced_transition(rule: Document, by_family: Mapping[str, set[str]]) -> None:
    forced = rule["when"].get("forcedTransition")
    if forced is None:
        return
    family = rule["sidFamily"]
    if family is None:
        raise ValueError(f"assignmentRules[{rule['id']}].when.forcedTransition names {forced!r} but the rule assigns no DP family")
    known = sorted(by_family.get(family, set()))
    if forced not in known:
        raise ValueError(f"assignmentRules[{rule['id']}].when.forcedTransition {forced!r} is not a transition of {family}#; it has {known}")


def _check_exit_fixes(rule: Document, by_family: Mapping[str, set[str]], gate_fixes: set[str]) -> None:
    known = gate_fixes.union(*by_family.values()) if by_family else gate_fixes
    for fix in rule["when"].get("exitFixes", []):
        if fix not in known:
            raise ValueError(
                f"assignmentRules[{rule['id']}].when.exitFixes names {fix!r}, which is neither a transition of any DP nor a gate fix; "
                "fix the spelling or add it to a gate"
            )


def _check_conditions(document: Document) -> None:
    by_family = _transition_fixes_by_family(document)
    gate_fixes = set(_gate_directions(document))
    for rule in document["assignmentRules"]:
        if "when" not in rule:
            continue
        _check_forced_transition(rule, by_family)
        _check_exit_fixes(rule, by_family, gate_fixes)


def _check_sectors(document: Document) -> None:
    known = {sector["id"] for sector in document["departureSectors"]}
    for rule in document["assignmentRules"]:
        if rule["sector"] not in known:
            raise ValueError(f"assignmentRules[{rule['id']}].sector {rule['sector']!r} is not a departureSectors id; known: {sorted(known)}")


def _config_runways(document: Document) -> list[tuple[str, str]]:
    wanted: list[tuple[str, str]] = []
    for config in document["runwayConfigs"]:
        wanted += [(runway, f"runwayConfigs[{config['id']}].arrivalRunways") for runway in config["arrivalRunways"]]
        wanted += [(runway["runway"], f"runwayConfigs[{config['id']}].departureRunways") for runway in config["departureRunways"]]
    for plan, directions in document["directionRunwayPreference"].items():
        for direction, preference in directions.items():
            wanted += [(runway, f"directionRunwayPreference.{plan}.{direction}.{family}") for family, runway in preference.items()]
    return wanted


def _check_runways(document: Document, runways: Sequence[str]) -> None:
    for runway, where in _config_runways(document):
        if runway not in runways:
            raise ValueError(f"{where}: runway {runway!r} has no CIFP runway record at this airport; it publishes {list(runways)}")


def _check_fleet(document: Document) -> None:
    classes = document["aircraftClasses"]
    for entry in document["routeLibrary"]["fleet"]:
        if entry["type"] not in classes:
            raise ValueError(f"routeLibrary.fleet[{entry['type']}]: no aircraft class was resolved for {entry['type']!r} from the vNAS specs")


def _check_destinations(document: Document) -> None:
    known = {destination["icao"] for destination in document["routeLibrary"]["destinations"]}
    for route in _routes(document):
        if route["destination"] not in known:
            raise ValueError(f"routeLibrary.routes[{route['exitFix']} -> {route['destination']}]: destination is not in routeLibrary.destinations")


def _runway_families(runways: Sequence[str]) -> set[str]:
    return {runway[:RUNWAY_FAMILY_LENGTH] for runway in runways}


def _plan_runway_families(document: Document) -> dict[str, set[str]]:
    families: dict[str, set[str]] = {}
    for config in document["runwayConfigs"]:
        families.setdefault(config["plan"], set()).update(_runway_families([runway["runway"] for runway in config["departureRunways"]]))
    return families


def _leading_sid_family(route: str) -> str | None:
    tokens = route.split()
    if not tokens or not tokens[0].endswith(SID_PLACEHOLDER):
        return None
    return tokens[0].removesuffix(SID_PLACEHOLDER)


def _check_tec_route_runways(row: Document, sids: Mapping[str, Document], plans: Mapping[str, set[str]]) -> None:
    family = _leading_sid_family(str(row["route"]))
    if family is None:
        return
    sid = sids.get(family)
    if sid is None:
        raise ValueError(f"tecRoutes[{row['id']}]: route begins on DP family {family!r}, which resolves to no procedure; known: {sorted(sids)}")
    wanted = set(row["runwayFamilies"]) or plans.get(row["plan"], set())
    published = _runway_families(sid["runways"])
    if not wanted & published:
        raise ValueError(
            f"tecRoutes[{row['id']}]: the row departs runway family {sorted(wanted)} of plan {row['plan']}, but {sid['id']} is published for "
            f"{sorted(published)}; correct `runway_families` in tec.yaml, or the DP the route begins on"
        )


def _check_tec_routes(document: Document) -> None:
    sids = {sid["family"]: sid for sid in document["sids"]}
    plans = _plan_runway_families(document)
    for row in document["tecRoutes"]:
        _check_tec_route_runways(row, sids, plans)


def _route_navaid_tokens(document: Document) -> list[tuple[str, str]]:
    wanted: list[tuple[str, str]] = []
    for route in _routes(document):
        wanted += [(token, f"routeLibrary.routes[{route['exitFix']} -> {route['destination']}].tail") for token in str(route["tail"]).split()]
    for row in document["tecRoutes"]:
        wanted += [(token, f"tecRoutes[{row['id']}].route") for token in str(row["route"]).split()]
    for direction, fixes in document["gates"].items():
        wanted += [(fix, f"gates.{direction}") for fix in fixes]
    for sid in document["sids"]:
        wanted += [(transition["fix"], f"sids[{sid['id']}].transitions") for transition in sid["transitions"]]
    return wanted


def _document_navaid_tokens(document: Document) -> dict[str, str]:
    """Return every navaid the airport data itself names, mapped to the first row that names it."""
    found: dict[str, str] = {}
    for token, where in _route_navaid_tokens(document):
        if _NAVAID_TOKEN.fullmatch(token):
            found.setdefault(token, where)
    found.pop(document["airport"]["faa"], None)
    return found


def _fixture_navaid_tokens(document: Document, inputs: BuildInputs) -> set[str]:
    """Return every navaid the checked-in fixtures file that the airport data itself does not name."""
    tokens = {token for route in inputs.fixture_routes for token in route.split() if _NAVAID_TOKEN.fullmatch(token)}
    return tokens - {document["airport"]["faa"]}


def _fix_spoken(document: Document, inputs: BuildInputs) -> dict[str, str]:
    tokens = set(_document_navaid_tokens(document)) | _fixture_navaid_tokens(document, inputs)
    named = {token: inputs.navaids[token].spoken for token in sorted(tokens) if token in inputs.navaids}
    return {**named, **inputs.airport.overrides.fix_spoken}


def _check_fix_spoken(document: Document) -> None:
    spoken = document["fixSpoken"]
    missing = sorted((token, where) for token, where in _document_navaid_tokens(document).items() if token not in spoken)
    if missing:
        listed = "; ".join(f"{token} (from {where})" for token, where in missing)
        raise ValueError(f"fixSpoken: navaid {listed} has no name in the CIFP and no fix_spoken override; add one to overrides.yaml")


def _check(document: Document, inputs: BuildInputs) -> None:
    _check_sid_families(document)
    _check_gate_fixes(document)
    _check_conditions(document)
    _check_sectors(document)
    _check_runways(document, inputs.runways)
    _check_fleet(document)
    _check_destinations(document)
    _check_tec_routes(document)
    _check_fix_spoken(document)


def _trailing_procedure(tail: str) -> str | None:
    """Return the procedure family the last token of a route tail names, or None when it names none."""
    tokens = tail.split()
    if not tokens:
        return None
    found = _PROCEDURE_TOKEN.fullmatch(tokens[-1])
    return None if found is None else found.group("family")


def _loa_claimed_arrivals(document: Document) -> dict[str, tuple[str, frozenset[str]]]:
    """Map every token an LOA route row names to that row and the destinations it covers."""
    destinations = document["routeLibrary"]["destinations"]
    claimed: dict[str, tuple[str, frozenset[str]]] = {}
    for rule in document["loaRules"]:
        if rule["rule"]["kind"] != "route":
            continue
        covered = set(rule.get("destinations", []))
        covered |= {entry["icao"] for entry in destinations if entry["artcc"] == rule.get("artcc")}
        for token in rule["rule"]["tokens"]:
            claimed.setdefault(token, (rule["id"], frozenset(covered)))
    return claimed


def _warn_route_arrivals(document: Document) -> None:
    claimed = _loa_claimed_arrivals(document)
    for route in _routes(document):
        family = _trailing_procedure(str(route["tail"]))
        names = claimed.get(family) if family is not None else None
        if names is not None and route["destination"] not in names[1]:
            print(
                f"warning: routeLibrary.routes[{route['exitFix']} -> {route['destination']}].tail ends on the {family} arrival, which "
                f"{names[0]} names for {sorted(names[1])}",
                file=sys.stderr,
            )


def _warn(document: Document, inputs: BuildInputs) -> None:
    assigned = {rule["sidFamily"] for rule in document["assignmentRules"]}
    unassigned = sorted(sid["id"] for sid in document["sids"] if sid["family"] not in assigned)
    for sid_id in unassigned:
        print(f"warning: {sid_id} is issued by no assignment rule; the engine can never select it", file=sys.stderr)
    used = {route["exitFix"] for route in _routes(document)}
    unused = sorted(fix for fix in _gate_directions(document) if fix not in used)
    if unused:
        print(f"warning: {len(unused)} gate fix(es) no route in routeLibrary leaves the DP at: {unused}", file=sys.stderr)
    unnamed = sorted(token for token in _fixture_navaid_tokens(document, inputs) if token not in document["fixSpoken"])
    if unnamed:
        print(f"warning: {len(unnamed)} navaid(s) on worksheet routes have no spoken name: {', '.join(unnamed)}", file=sys.stderr)
    _warn_route_arrivals(document)


def build_airport(inputs: BuildInputs) -> Document:
    """Join every source into the airport document the web app loads.

    Args:
        inputs: The parsed CIFP, chart, vNAS and YAML sources of one airport.

    Returns:
        The document, shaped as ``data/schema/airport.schema.json`` describes. Integrity problems
        that only warn are printed to stderr.

    Raises:
        ValueError: Two sources disagree, or a rule, runway, fix, navaid name, fleet type or
            destination does not resolve. Every message names the row it came from.
    """
    sop = inputs.airport.sop
    document: Document = {
        "airport": _airport(sop.airport, inputs.airport_records),
        "provenance": _provenance(sop, inputs.provenance),
        "runwayConfigs": [_runway_config(config) for config in sop.runway_configs],
        "departureSectors": [_sector(sector) for sector in sop.departure_sectors],
        "departureStaffingFallbacks": [_sector(sector) for sector in sop.departure_staffing_fallbacks],
        "frequencies": [{"label": option.label, "value": option.value} for option in sop.frequencies],
        "directionRunwayPreference": {
            plan: {direction: dict(preference) for direction, preference in directions.items()}
            for plan, directions in sop.direction_runway_preference.items()
        },
        "gates": {direction: list(fixes) for direction, fixes in _gate_items(sop.gates)},
        "noSid": {"runwayFamilies": list(sop.no_sid.runway_families), "phrasing": sop.no_sid.phrasing},
        "sids": _sids(inputs),
        "fixSpoken": {},
        "assignmentRules": [_assignment_rule(rule) for rule in sop.assignment_rules],
        "noiseWindows": [_noise_window(window) for window in sop.noise_windows],
        "altitudeRules": [_altitude_rule(rule) for rule in sop.altitude_rules],
        "notices": [_notice(notice) for notice in sop.notices],
        "phraseology": {
            "expectAltitude": sop.phraseology.expect_altitude,
            "nonStandardInterimExpectMinutes": sop.phraseology.non_standard_interim_expect_minutes,
            "vectorHybridTransitionsSpoken": sop.phraseology.vector_hybrid_transitions_spoken,
        },
        "phraseologyRules": _phraseology_rules(inputs.phraseology_rules, sop.phraseology_rules),
        "equipmentSuffixes": [_equipment_suffix(suffix) for suffix in inputs.equipment_suffixes],
        "tecRoutes": _tec_routes(inputs),
        "loaRules": _loa_rules(inputs),
        "aircraftClasses": dict(inputs.aircraft_classes),
        "routeLibrary": _route_library(inputs),
    }
    document["fixSpoken"] = _fix_spoken(document, inputs)
    _check(document, inputs)
    _warn(document, inputs)
    return document
