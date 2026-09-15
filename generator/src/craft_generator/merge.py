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
vNAS specs cannot class. Two conditions only warn, because both are ordinary while the data is being
built up: a SID no assignment rule ever issues, and a gate fix no route in the library uses.

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
from craft_generator.cifp.sid import CifpSid, Restriction, Transition
from craft_generator.sop.load import sid_family_of
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
    NoiseWindow,
    Notice,
    RouteEntry,
    RunwayConfig,
    SidOverride,
    SidTopAltitude,
    SopData,
)

Document = dict[str, Any]

PILOT_NAV_KINDS = frozenset({"rnav_pilot_nav", "conventional_pilot_nav"})
RNAV_KIND = "rnav_pilot_nav"
VECTOR_SEGMENT_KINDS = frozenset({"radar_vectors", "vector_hybrid"})
PUBLISHED_TOP_ALTITUDE = "published"

_CLOCK = re.compile(r"^(?P<hours>[01]\d|2[0-3]):?(?P<minutes>[0-5]\d)$")


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

    ``sids`` and ``runways`` come from the CIFP, ``charts`` from the charts API and the chart PDFs
    (keyed by chart name, in the order the API lists them), ``aircraft_classes`` from the vNAS specs
    and ``coordinates`` from the CIFP airport records, keyed by ICAO identifier.
    """

    airport: AirportInputs
    sids: dict[str, CifpSid]
    runways: tuple[str, ...]
    charts: dict[str, ChartInput]
    aircraft_classes: dict[str, AircraftClass]
    coordinates: dict[str, tuple[float, float]]
    equipment_suffixes: tuple[EquipmentSuffix, ...]
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


def _airport(info: AirportInfo, coordinates: Mapping[str, tuple[float, float]]) -> Document:
    found = coordinates.get(info.icao)
    if found is None:
        raise ValueError(
            f"sop.yaml airport.icao {info.icao!r}: the CIFP carries no airport record for it, so the document has no reference point; "
            "correct the identifier, as the direction-of-flight rules measure the course from it"
        )
    latitude, longitude = found
    return {
        "icao": info.icao,
        "faa": info.faa,
        "spoken": info.spoken,
        "clearanceDelivery": info.clearance_delivery,
        "lat": latitude,
        "lon": longitude,
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
    return _with_optional({"runway": runway.runway, "classes": list(runway.classes)}, note=runway.note)


def _runway_config(config: RunwayConfig) -> Document:
    return {
        "id": config.id,
        "name": config.name,
        "plan": config.plan,
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


def _destination(destination: Destination, coordinates: Mapping[str, tuple[float, float]]) -> Document:
    latitude, longitude = destination.lat, destination.lon
    if latitude is None or longitude is None:
        found = coordinates.get(destination.icao)
        if found is None:
            raise ValueError(
                f"routes.yaml destinations[{destination.icao}]: the CIFP has no airport record for {destination.icao!r} and the row gives no "
                "lat/lon; add hand coordinates to that row, as the FAA file carries US airports only"
            )
        latitude, longitude = found
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


def _route_entry(route: RouteEntry) -> Document:
    return {
        "exitFix": route.exit_fix,
        "tail": route.tail,
        "destination": route.destination,
        "classes": list(route.classes),
        "altitudes": list(route.altitudes),
    }


def _route_library(inputs: BuildInputs) -> Document:
    routes = inputs.airport.routes
    return {
        "destinations": [_destination(destination, inputs.coordinates) for destination in routes.destinations],
        "telephony": dict(routes.telephony),
        "fleet": [_fleet_entry(entry) for entry in routes.fleet],
        "routes": [_route_entry(route) for route in routes.routes],
    }


def _transition_spoken(fix: str, fix_spoken: Mapping[str, str]) -> str:
    spoken = fix_spoken.get(fix)
    return spoken if spoken else fix.capitalize()


def _transition(transition: Transition, override: SidOverride, fix_spoken: Mapping[str, str], where: str) -> Document:
    if not transition.fixes:
        raise ValueError(f"{where}: transition {transition.name!r} sequences no fix, so it has no terminal fix to speak")
    fix = transition.fixes[-1]
    spoken_as_transition = override.transitions_spoken_as_transition
    if spoken_as_transition is None:
        spoken_as_transition = transition.kind == "enroute"
    return {
        "fix": fix,
        "spoken": _transition_spoken(fix, fix_spoken),
        "kind": transition.kind,
        "spokenAsTransition": spoken_as_transition,
    }


def _transitions(cifp: CifpSid | None, override: SidOverride, fix_spoken: Mapping[str, str]) -> list[Document]:
    if cifp is None:
        return []
    where = f"CIFP {cifp.id}"
    transitions = [_transition(transition, override, fix_spoken, where) for transition in cifp.transitions]
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


def _sid(chart_name: str, chart: ChartInput, override: SidOverride, cifp: CifpSid | None, fix_spoken: Mapping[str, str], *, icao: str) -> Document:
    where = f"overrides.yaml sids[{chart_name}]"
    kind = override.kind if override.kind is not None else _required(None if cifp is None else cifp.kind, where, "kind")
    runways = override.runways if override.runways is not None else _required(None if cifp is None else cifp.runways, where, "runways")
    has_restrictions = override.has_crossing_restrictions
    if has_restrictions is None:
        has_restrictions = cifp is not None and cifp.has_crossing_restrictions
    transitions = _transitions(cifp, override, fix_spoken)
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
        documents.append(_sid(chart_name, chart, override, inputs.sids.get(override.cifp_id), overrides.fix_spoken, icao=inputs.airport.icao))
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


def _check(document: Document, inputs: BuildInputs) -> None:
    _check_sid_families(document)
    _check_gate_fixes(document)
    _check_conditions(document)
    _check_sectors(document)
    _check_runways(document, inputs.runways)
    _check_fleet(document)
    _check_destinations(document)


def _warn(document: Document) -> None:
    assigned = {rule["sidFamily"] for rule in document["assignmentRules"]}
    unassigned = sorted(sid["id"] for sid in document["sids"] if sid["family"] not in assigned)
    for sid_id in unassigned:
        print(f"warning: {sid_id} is issued by no assignment rule; the engine can never select it", file=sys.stderr)
    used = {route["exitFix"] for route in _routes(document)}
    unused = sorted(fix for fix in _gate_directions(document) if fix not in used)
    if unused:
        print(f"warning: {len(unused)} gate fix(es) no route in routeLibrary leaves the DP at: {unused}", file=sys.stderr)


def build_airport(inputs: BuildInputs) -> Document:
    """Join every source into the airport document the web app loads.

    Args:
        inputs: The parsed CIFP, chart, vNAS and YAML sources of one airport.

    Returns:
        The document, shaped as ``data/schema/airport.schema.json`` describes. Integrity problems
        that only warn are printed to stderr.

    Raises:
        ValueError: Two sources disagree, or a rule, runway, fix, fleet type or destination does not
            resolve. Every message names the row it came from.
    """
    sop = inputs.airport.sop
    document: Document = {
        "airport": _airport(sop.airport, inputs.coordinates),
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
        "fixSpoken": dict(inputs.airport.overrides.fix_spoken),
        "assignmentRules": [_assignment_rule(rule) for rule in sop.assignment_rules],
        "noiseWindows": [_noise_window(window) for window in sop.noise_windows],
        "altitudeRules": [_altitude_rule(rule) for rule in sop.altitude_rules],
        "notices": [_notice(notice) for notice in sop.notices],
        "phraseology": {
            "expectAltitude": sop.phraseology.expect_altitude,
            "nonStandardInterimExpectMinutes": sop.phraseology.non_standard_interim_expect_minutes,
            "vectorHybridTransitionsSpoken": sop.phraseology.vector_hybrid_transitions_spoken,
        },
        "phraseologyRules": [{"id": rule.id, "source": rule.source, "text": rule.text} for rule in sop.phraseology_rules],
        "equipmentSuffixes": [_equipment_suffix(suffix) for suffix in inputs.equipment_suffixes],
        "tecRoutes": [],
        "loaRules": [],
        "aircraftClasses": dict(inputs.aircraft_classes),
        "routeLibrary": _route_library(inputs),
    }
    _check(document, inputs)
    _warn(document)
    return document
