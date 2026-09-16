from dataclasses import replace
from typing import Any

import pytest

from craft_generator.emit import data_path, dump, schema_path, validate
from craft_generator.merge import BuildInputs, Document, _phraseology_rules, build_airport
from craft_generator.sop.model import PhraseologyRule, RouteEntry

SID_COUNT = 12
GAPP_TRANSITION_COUNT = 7
TRUKN_TOP_ALTITUDE_FEET = 19000
SNTNA_TOP_ALTITUDE_FEET = 3000
TRUKN_TRANSITION_FIXES = ["DEDHD", "GRTFL", "MOGEE", "ORRCA", "SYRAH", "TIPRE"]
KSFO_LATITUDE = 37.618806
KSFO_LONGITUDE = -122.375417
BASE_FIXES = {
    "CIITY3": "CIITY",
    "GNNRR3": "GNNRR",
    "MOLEN9": "MOLEN",
    "NIITE4": "NIITE",
    "SAHEY4": "SAHEY",
    "SEGUL1": "SEGUL",
    "SNTNA2": "SNTNA",
    "SSTIK5": "PORTE",
    "TRUKN2": "TRUKN",
    "WESLA5": "PORTE",
}
NO_BASE_FIX = ["GAPP7", "SFO5"]
TEC_ROUTE_COUNT = 49
LOA_RULE_COUNT = 3
TEC_SOURCE = "ZOA Reference Tool, TEC/AAR/ADR Routes, https://reference.oakartcc.org/routes"
ADR_ROUTE_IDS = ["ADR-KSAN-SFOW", "ADR-KSAN-SFOE"]
KSMF_PROP_CAP_FEET = 6000
PARITY_ODD_COURSE_FROM = 20
PARITY_ODD_COURSE_TO = 199


def _sids(document: Document) -> dict[str, Document]:
    return {sid["id"]: sid for sid in document["sids"]}


def _destinations(document: Document) -> dict[str, Document]:
    return {destination["icao"]: destination for destination in document["routeLibrary"]["destinations"]}


def _with_sop(inputs: BuildInputs, **changes: Any) -> BuildInputs:
    return replace(inputs, airport=replace(inputs.airport, sop=replace(inputs.airport.sop, **changes)))


def _with_route(inputs: BuildInputs, route: RouteEntry) -> BuildInputs:
    library = replace(inputs.airport.routes, routes=(*inputs.airport.routes.routes, route))
    return replace(inputs, airport=replace(inputs.airport, routes=library))


def _tail(document: Document, exit_fix: str, destination: str) -> str:
    routes = document["routeLibrary"]["routes"]
    return next(str(route["tail"]) for route in routes if route["exitFix"] == exit_fix and route["destination"] == destination)


def test_the_document_matches_the_schema(ksfo_document: Document) -> None:
    validate(ksfo_document, schema_path())


def test_every_published_departure_becomes_a_sid(ksfo_document: Document) -> None:
    assert len(ksfo_document["sids"]) == SID_COUNT
    assert len(_sids(ksfo_document)) == SID_COUNT


def test_the_radar_vector_sid_comes_from_the_override(ksfo_document: Document) -> None:
    sfo5 = _sids(ksfo_document)["SFO5"]
    assert sfo5["kind"] == "radar_vectors"
    assert sfo5["runways"] == ["01L", "01R", "28L", "28R"]
    assert sfo5["transitions"] == []
    assert sfo5["climbViaEligible"] is False
    assert sfo5["routePhrasing"] == "radar_vectors_fix"


def test_the_vector_sid_keeps_its_cifp_transitions_unspoken(ksfo_document: Document) -> None:
    gapp7 = _sids(ksfo_document)["GAPP7"]
    assert gapp7["kind"] == "vector_hybrid"
    assert len(gapp7["transitions"]) == GAPP_TRANSITION_COUNT
    assert {transition["kind"] for transition in gapp7["transitions"]} == {"vector"}
    assert [transition["fix"] for transition in gapp7["transitions"] if transition["spokenAsTransition"]] == []


def test_a_published_top_altitude_makes_a_sid_climb_via_eligible(ksfo_document: Document) -> None:
    trukn2 = _sids(ksfo_document)["TRUKN2"]
    assert trukn2["topAltitude"] == {"kind": "published", "feet": TRUKN_TOP_ALTITUDE_FEET}
    assert trukn2["climbViaEligible"] is True
    assert [transition["fix"] for transition in trukn2["transitions"]] == TRUKN_TRANSITION_FIXES
    assert trukn2["transitions"][0]["spoken"] == "Dedhd"
    assert trukn2["transitions"][0]["spokenAsTransition"] is True


def test_a_published_top_altitude_alone_makes_a_sid_climb_via_eligible(ksfo_document: Document) -> None:
    sntna2 = _sids(ksfo_document)["SNTNA2"]
    assert sntna2["hasCrossingRestrictions"] is False
    assert sntna2["topAltitude"] == {"kind": "published", "feet": SNTNA_TOP_ALTITUDE_FEET}
    assert sntna2["climbViaEligible"] is True


def test_a_sid_with_a_vector_segment_is_never_climb_via_eligible(ksfo_document: Document) -> None:
    sids = _sids(ksfo_document)
    assert sids["GAPP7"]["climbViaEligible"] is False
    assert sids["SFO5"]["climbViaEligible"] is False


def test_the_airport_carries_its_cifp_reference_point(ksfo_document: Document) -> None:
    assert (ksfo_document["airport"]["lat"], ksfo_document["airport"]["lon"]) == (KSFO_LATITUDE, KSFO_LONGITUDE)


def test_an_airport_the_cifp_does_not_carry_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    records = {key: value for key, value in ksfo_build_inputs.airport_records.items() if key != "KSFO"}
    with pytest.raises(ValueError, match=r"airport.icao 'KSFO': the CIFP carries no airport record"):
        build_airport(replace(ksfo_build_inputs, airport_records=records))


def test_the_base_fix_is_where_the_transitions_begin(ksfo_document: Document) -> None:
    sids = _sids(ksfo_document)
    assert {sid_id: sid["baseFix"] for sid_id, sid in sids.items() if "baseFix" in sid} == BASE_FIXES


def test_a_sid_whose_transitions_start_at_the_airport_has_no_base_fix(ksfo_document: Document) -> None:
    sids = _sids(ksfo_document)
    assert [sid_id for sid_id in NO_BASE_FIX if "baseFix" not in sids[sid_id]] == NO_BASE_FIX


def test_transitions_that_disagree_leave_the_base_fix_out(ksfo_build_inputs: BuildInputs) -> None:
    trukn2 = ksfo_build_inputs.sids["TRUKN2"]
    first, *rest = trukn2.transitions
    moved = replace(first, fixes=("ZZZZZ", *first.fixes))
    sids = {**ksfo_build_inputs.sids, "TRUKN2": replace(trukn2, transitions=(moved, *rest))}
    document = build_airport(replace(ksfo_build_inputs, sids=sids))
    assert "baseFix" not in _sids(document)["TRUKN2"]


def test_a_navaid_transition_is_spoken_by_name(ksfo_document: Document) -> None:
    molen9 = _sids(ksfo_document)["MOLEN9"]
    assert [(transition["fix"], transition["spoken"]) for transition in molen9["transitions"]] == [("ENI", "Mendocino")]


def test_an_override_narrows_the_runways_the_cifp_codes(ksfo_document: Document) -> None:
    assert _sids(ksfo_document)["SSTIK5"]["runways"] == ["01L"]


def test_noise_window_times_are_normalised_to_hhmm(ksfo_document: Document) -> None:
    night = next(window for window in ksfo_document["noiseWindows"] if window["id"] == "night")
    assert (night["start"], night["end"], night["sundayEnd"]) == ("2200", "0700", "0800")


def test_the_frequency_pool_keeps_its_labels(ksfo_document: Document) -> None:
    assert ksfo_document["frequencies"][0] == {"label": "San Francisco Clearance", "value": "118.2"}


def test_the_fleet_is_classed_from_the_vnas_specs(ksfo_document: Document) -> None:
    assert ksfo_document["aircraftClasses"]["A320"] == "J"


def test_destination_coordinates_come_from_the_cifp_unless_the_yaml_gives_them(ksfo_document: Document) -> None:
    destinations = _destinations(ksfo_document)
    assert isinstance(destinations["KSEA"]["lat"], float)
    assert isinstance(destinations["KSEA"]["lon"], float)
    assert (destinations["RKSI"]["lat"], destinations["RKSI"]["lon"]) == (37.469, 126.451)


def test_the_tec_rows_carry_their_source_cap_and_kind(ksfo_document: Document) -> None:
    rows = {row["id"]: row for row in ksfo_document["tecRoutes"]}
    assert len(rows) == TEC_ROUTE_COUNT
    capped = rows["TEC-KSMF-SFOW-P-01"]
    assert capped["source"] == TEC_SOURCE
    assert capped["kind"] == "tec"
    assert capped["runwayFamilies"] == ["01"]
    assert capped["classes"] == ["P"]
    assert capped["route"] == "SFO# OAK V6 SAC"
    assert capped["altitudeCapFeet"] == KSMF_PROP_CAP_FEET
    assert "altitudeCapFeet" not in rows["TEC-KSMF-SFOE-J"]
    assert [row["id"] for row in ksfo_document["tecRoutes"] if row["kind"] == "adr"] == ADR_ROUTE_IDS


def test_the_shared_route_connections_are_emitted_as_citable_rows(ksfo_document: Document, ksfo_build_inputs: BuildInputs) -> None:
    rows = ksfo_document["routeConnections"]
    assert len(rows) == len(ksfo_build_inputs.route_connections)
    source = ksfo_build_inputs.route_connections[0].source
    assert next(row for row in rows if row["id"] == "CONN-SUSEY-EBAYE") == {
        "id": "CONN-SUSEY-EBAYE",
        "from": "SUSEY",
        "to": "EBAYE",
        "connects": "always",
        "source": source,
        "text": "SUSEY always connects to EBAYE",
    }


def test_the_loa_rules_keep_their_discriminated_kinds(ksfo_document: Document) -> None:
    rules = {rule["id"]: rule for rule in ksfo_document["loaRules"]}
    assert len(rules) == LOA_RULE_COUNT
    parity = rules["LOA-ZSE-PARITY"]
    assert parity["rule"] == {"kind": "parity_rotated", "oddCourseFrom": PARITY_ODD_COURSE_FROM, "oddCourseTo": PARITY_ODD_COURSE_TO}
    assert parity["artcc"] == "ZSE"
    assert "destinations" not in parity
    portland = rules["LOA-ZSE-PDX-ROUTE"]
    assert portland["rule"] == {"kind": "route", "tokens": ["MACHU", "MOXEE", "OED"]}
    assert portland["destinations"] == ["KPDX"]
    assert "artcc" not in portland


def test_a_tec_row_on_a_dp_its_runways_do_not_publish_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    tec = ksfo_build_inputs.airport.tec
    assert tec is not None
    index, row = next((index, row) for index, row in enumerate(tec.routes) if row.id == "TEC-KSMF-SFOW-P-28")
    routes = list(tec.routes)
    routes[index] = replace(row, route="SSTIK# OAK V6 SAC")
    mutated = replace(tec, routes=tuple(routes))
    inputs = replace(ksfo_build_inputs, airport=replace(ksfo_build_inputs.airport, tec=mutated))
    with pytest.raises(
        ValueError, match=r"tecRoutes\[TEC-KSMF-SFOW-P-28\]: the row departs runway family \['28'\].*SSTIK5 is published for \['01'\]"
    ):
        build_airport(inputs)


def test_a_rule_naming_an_unknown_dp_family_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    rules = list(ksfo_build_inputs.airport.sop.assignment_rules)
    rules[0] = replace(rules[0], sid_family="NOPE")
    with pytest.raises(ValueError, match=r"DP family 'NOPE' resolves to 0 procedures"):
        build_airport(_with_sop(ksfo_build_inputs, assignment_rules=tuple(rules)))


def test_an_exit_fix_in_no_gate_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    gates = ksfo_build_inputs.airport.sop.gates
    narrowed = replace(gates, north=tuple(fix for fix in gates.north if fix != "DEDHD"))
    with pytest.raises(ValueError, match="DEDHD"):
        build_airport(_with_sop(ksfo_build_inputs, gates=narrowed))


def test_a_forced_transition_the_sid_does_not_publish_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    rules = list(ksfo_build_inputs.airport.sop.assignment_rules)
    index, rule = next((index, rule) for index, rule in enumerate(rules) if rule.when is not None and rule.when.forced_transition)
    when = rule.when
    assert when is not None
    rules[index] = replace(rule, when=replace(when, forced_transition="ZZZZZ"))
    with pytest.raises(ValueError, match=r"forcedTransition 'ZZZZZ' is not a transition of NIITE#"):
        build_airport(_with_sop(ksfo_build_inputs, assignment_rules=tuple(rules)))


def test_a_chart_and_cifp_transition_mismatch_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    chart = ksfo_build_inputs.charts["TRUKN TWO (RNAV)"]
    stale = replace(chart, facts=replace(chart.facts, transitions={"DEDHD": "DEDHD"}))
    charts = {**ksfo_build_inputs.charts, "TRUKN TWO (RNAV)": stale}
    with pytest.raises(ValueError, match=r"TRUKN2 \(TRUKN TWO \(RNAV\)\): the chart publishes transitions"):
        build_airport(replace(ksfo_build_inputs, charts=charts))


def test_a_fleet_type_without_a_class_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    classes = {key: value for key, value in ksfo_build_inputs.aircraft_classes.items() if key != "A320"}
    with pytest.raises(ValueError, match=r"fleet\[A320\]"):
        build_airport(replace(ksfo_build_inputs, aircraft_classes=classes))


def test_a_destination_without_coordinates_names_the_airport(ksfo_build_inputs: BuildInputs) -> None:
    records = {key: value for key, value in ksfo_build_inputs.airport_records.items() if key != "KSEA"}
    with pytest.raises(ValueError, match=r"destinations\[KSEA\]: the CIFP has no airport record"):
        build_airport(replace(ksfo_build_inputs, airport_records=records))


def test_a_runway_no_runway_record_lists_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    runways = tuple(runway for runway in ksfo_build_inputs.runways if runway != "19L")
    with pytest.raises(ValueError, match=r"runway '19L' has no CIFP runway record"):
        build_airport(replace(ksfo_build_inputs, runways=runways))


def test_an_exit_fix_condition_naming_nothing_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    rules = list(ksfo_build_inputs.airport.sop.assignment_rules)
    index, rule = next((index, rule) for index, rule in enumerate(rules) if rule.when is not None and rule.when.exit_fixes)
    when = rule.when
    assert when is not None
    rules[index] = replace(rule, when=replace(when, exit_fixes=("ZZZZZ",)))
    with pytest.raises(ValueError, match=r"exitFixes names 'ZZZZZ'"):
        build_airport(_with_sop(ksfo_build_inputs, assignment_rules=tuple(rules)))


def test_a_rule_naming_an_unknown_sector_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    rules = list(ksfo_build_inputs.airport.sop.assignment_rules)
    rules[0] = replace(rules[0], sector="tower")
    with pytest.raises(ValueError, match=r"sector 'tower' is not a departureSectors id"):
        build_airport(_with_sop(ksfo_build_inputs, assignment_rules=tuple(rules)))


def test_a_route_to_an_unlisted_destination_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    routes = ksfo_build_inputs.airport.routes
    without_seattle = replace(routes, destinations=tuple(entry for entry in routes.destinations if entry.icao != "KSEA"))
    mutated = replace(ksfo_build_inputs, airport=replace(ksfo_build_inputs.airport, routes=without_seattle))
    with pytest.raises(ValueError, match=r"destination is not in routeLibrary.destinations"):
        build_airport(mutated)


def test_a_navaid_is_spoken_as_its_name_and_facility_word(ksfo_document: Document) -> None:
    spoken = ksfo_document["fixSpoken"]
    assert spoken["RBL"] == "Red Bluff VOR"
    assert spoken["LMT"] == "Klamath Falls VOR"
    assert spoken["SWR"] == "Palisades VOR"
    assert spoken["PWE"] == "Pawnee City DME"


def test_a_navaid_only_a_worksheet_route_names_is_spoken_too(ksfo_document: Document) -> None:
    assert ksfo_document["fixSpoken"]["PSP"] == "Palm Springs VOR"


def test_a_hand_row_wins_over_the_cifp_name(ksfo_build_inputs: BuildInputs) -> None:
    overrides = replace(ksfo_build_inputs.airport.overrides, fix_spoken={"RBL": "Big Red"})
    document = build_airport(replace(ksfo_build_inputs, airport=replace(ksfo_build_inputs.airport, overrides=overrides)))
    assert document["fixSpoken"]["RBL"] == "Big Red"
    assert document["fixSpoken"]["SAC"] == "Sacramento VOR"


def test_a_navaid_the_cifp_does_not_name_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    navaids = {ident: navaid for ident, navaid in ksfo_build_inputs.navaids.items() if ident != "OAK"}
    with pytest.raises(ValueError, match=r"fixSpoken: navaid OAK \(from routeLibrary\.routes\[.*\) has no name in the CIFP"):
        build_airport(replace(ksfo_build_inputs, navaids=navaids))


def test_a_navaid_only_a_fixture_names_warns_instead_of_failing(ksfo_build_inputs: BuildInputs, capsys: pytest.CaptureFixture[str]) -> None:
    build_airport(replace(ksfo_build_inputs, fixture_routes=("TRUKN2 DEDHD RBL ZZQ HAWKZ7",)))
    assert "navaid(s) on worksheet routes have no spoken name: ZZQ" in capsys.readouterr().err


def test_a_route_tail_ending_on_another_destinations_arrival_warns(ksfo_build_inputs: BuildInputs, capsys: pytest.CaptureFixture[str]) -> None:
    routes = ksfo_build_inputs.airport.routes
    seattle_star_to_vancouver = RouteEntry(exit_fix="DEDHD", destination="CYVR", tail="DEDHD LMT BTG HAWKZ7", classes=("J",), altitudes=(36000,))
    library = replace(routes, routes=(*routes.routes, seattle_star_to_vancouver))
    build_airport(replace(ksfo_build_inputs, airport=replace(ksfo_build_inputs.airport, routes=library)))
    warning = "routeLibrary.routes[DEDHD -> CYVR].tail ends on the HAWKZ arrival, which LOA-ZSE-SEA-ROUTE names for ['KBFI', 'KSEA']"
    assert warning in capsys.readouterr().err


def test_a_family_placeholder_tail_resolves_to_the_revision_the_destination_publishes(ksfo_document: Document) -> None:
    assert _tail(ksfo_document, "DEDHD", "KSEA") == "DEDHD RBL LMT HAWKZ8"


def test_an_arrival_family_the_destination_does_not_publish_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    route = RouteEntry(exit_fix="MOGEE", destination="KSLC", tail="MOGEE Q124 BVL WAATS#", classes=("J",), altitudes=(37000,))
    with pytest.raises(ValueError, match=r"routeLibrary\.routes\[MOGEE -> KSLC\]\.tail: the tail names arrival family 'WAATS'") as error:
        build_airport(_with_route(ksfo_build_inputs, route))
    assert "'BVL2'" in str(error.value)
    assert "'JAZZZ1'" in str(error.value)


def test_a_family_placeholder_fails_for_a_destination_the_faa_file_does_not_carry(ksfo_build_inputs: BuildInputs) -> None:
    route = RouteEntry(exit_fix="DEDHD", destination="CYVR", tail="DEDHD LMT BTG GRIZZ#", classes=("J",), altitudes=(36000,))
    with pytest.raises(ValueError, match=r"routeLibrary\.routes\[DEDHD -> CYVR\]\.tail: .* no procedure for CYVR") as error:
        build_airport(_with_route(ksfo_build_inputs, route))
    assert "write the published identifier literally, GRIZZ plus its revision" in str(error.value)


def test_a_family_placeholder_fails_for_a_destination_that_publishes_no_arrival(ksfo_build_inputs: BuildInputs) -> None:
    route = RouteEntry(exit_fix="OAK", destination="KLVK", tail="OAK V244 ALTAM ANYYY#", classes=("T",), altitudes=(7000,))
    with pytest.raises(ValueError, match=r"routeLibrary\.routes\[OAK -> KLVK\]\.tail: .* KLVK publishes no arrival at all"):
        build_airport(_with_route(ksfo_build_inputs, route))


def test_a_literal_arrival_revision_fails_for_a_destination_the_faa_file_carries(ksfo_build_inputs: BuildInputs) -> None:
    route = RouteEntry(exit_fix="DEDHD", destination="KSEA", tail="DEDHD RBL LMT HAWKZ8", classes=("J",), altitudes=(34000,))
    with pytest.raises(ValueError, match=r"routeLibrary\.routes\[DEDHD -> KSEA\]\.tail: the tail ends on the literal arrival 'HAWKZ8'") as error:
        build_airport(_with_route(ksfo_build_inputs, route))
    assert "write HAWKZ# instead" in str(error.value)


def test_a_literal_arrival_revision_is_kept_for_a_destination_the_faa_file_does_not_carry(ksfo_document: Document) -> None:
    assert _tail(ksfo_document, "DEDHD", "CYVR") == "DEDHD LMT BTG J1 SEA PAE GRIZZ1"


def test_an_airport_phraseology_row_replaces_the_shared_row_of_its_id() -> None:
    shared = (
        PhraseologyRule(id="A", source="shared A source", text="shared A text"),
        PhraseologyRule(id="B", source="shared B source", text="shared B text"),
    )
    airport = (
        PhraseologyRule(id="B", source="airport B source", text="airport B text"),
        PhraseologyRule(id="C", source="airport C source", text="airport C text"),
    )
    rules = _phraseology_rules(shared, airport)
    assert [rule["id"] for rule in rules] == ["A", "B", "C"]
    assert rules[1] == {"id": "B", "source": "airport B source", "text": "airport B text"}
    assert rules[0]["text"] == "shared A text"


def test_build_matches_committed_data(ksfo_document: Document) -> None:
    committed = data_path("KSFO")
    assert committed.exists(), f"{committed} is missing; run `uv run craft-gen build --airport KSFO`"
    assert dump(ksfo_document) == committed.read_text(encoding="utf-8", newline="")
