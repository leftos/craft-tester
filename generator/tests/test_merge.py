from dataclasses import replace
from typing import Any

import pytest

from craft_generator.emit import data_path, dump, schema_path, validate
from craft_generator.merge import BuildInputs, Document, _phraseology_rules, build_airport
from craft_generator.sop.model import AircraftGroup, PhraseologyRule, RouteEntry, RouteTokenRule

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
TEC_ROUTE_COUNT = 47
LOA_RULE_COUNT = 24
TEC_SOURCE = "ZOA Reference Tool, TEC/AAR/ADR Routes, https://reference.oakartcc.org/routes"
ADR_ROUTE_IDS = ["ADR-KSAN-SFOW", "ADR-KSAN-SFOE"]
KSMF_PROP_ALTITUDE_FEET = 6000
OUTSIDE_NCT_REASON = "Another facility owns a shelf below NCT's lateral boundary down to the ground"
PARITY_ODD_COURSE_FROM = 20
PARITY_ODD_COURSE_TO = 199
HAND_EXPECT_MINUTES = 7
CHART_EXPECT_MINUTES = 10


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


def test_a_hand_expect_note_wins_over_the_one_read_off_the_chart(ksfo_build_inputs: BuildInputs) -> None:
    overrides = ksfo_build_inputs.airport.overrides
    sfo5 = replace(overrides.sids["SAN FRANCISCO FIVE"], expect_filed_altitude_minutes=HAND_EXPECT_MINUTES)
    airport = replace(ksfo_build_inputs.airport, overrides=replace(overrides, sids={**overrides.sids, "SAN FRANCISCO FIVE": sfo5}))
    sids = _sids(build_airport(replace(ksfo_build_inputs, airport=airport)))
    assert sids["SFO5"]["chartExpectFiledAltitudeMinutes"] == HAND_EXPECT_MINUTES
    assert sids["TRUKN2"]["chartExpectFiledAltitudeMinutes"] == CHART_EXPECT_MINUTES


def test_a_chart_expect_note_reaches_the_document(ksfo_document: Document) -> None:
    assert {sid["chartExpectFiledAltitudeMinutes"] for sid in ksfo_document["sids"]} == {CHART_EXPECT_MINUTES}


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


def _arrival(document: Document, icao: str, star_id: str) -> Document:
    arrivals = _destinations(document)[icao]["arrivals"]
    return next(arrival for arrival in arrivals if arrival["id"] == star_id)


def test_a_destination_publishes_its_arrivals_with_their_families_and_enroute_transitions(ksfo_document: Document) -> None:
    assert _arrival(ksfo_document, "KLAX", "IRNMN2") == {
        "id": "IRNMN2",
        "family": "IRNMN",
        "rnav": True,
        "transitions": ["BURGL", "FRASR", "MUPTT", "REBRG"],
    }
    sadde = _arrival(ksfo_document, "KLAX", "SADDE8")
    assert (sadde["family"], sadde["rnav"]) == ("SADDE", False)
    assert {"AVE", "DERBB"} <= set(sadde["transitions"])


def test_the_arrivals_of_a_destination_are_sorted_by_identifier(ksfo_document: Document) -> None:
    arrivals = _destinations(ksfo_document)["KLAX"]["arrivals"]
    ids = [arrival["id"] for arrival in arrivals]
    assert ids == sorted(ids)
    assert "IRNMN2" in ids


def test_a_destination_with_no_published_arrival_carries_an_empty_list(ksfo_document: Document) -> None:
    destinations = _destinations(ksfo_document)
    assert destinations["KLVK"]["arrivals"] == []
    assert destinations["CYVR"]["arrivals"] == []


def _with_destination(inputs: BuildInputs, icao: str, **changes: Any) -> BuildInputs:
    library = inputs.airport.routes
    destinations = tuple(replace(row, **changes) if row.icao == icao else row for row in library.destinations)
    return replace(inputs, airport=replace(inputs.airport, routes=replace(library, destinations=destinations)))


def test_the_nct_flag_is_computed_from_the_terminal_polygon(ksfo_document: Document) -> None:
    destinations = _destinations(ksfo_document)
    assert destinations["KSMF"]["nct"] is True
    assert destinations["KOAK"]["nct"] is True
    assert destinations["KSEA"]["nct"] is False
    assert destinations["KAPC"]["nct"] is False


def test_a_field_another_facility_owns_is_outside_nct_although_the_polygon_holds_it(ksfo_build_inputs: BuildInputs, ksfo_document: Document) -> None:
    assert _destinations(ksfo_document)["KRNO"]["nct"] is True
    inputs = _with_destination(ksfo_build_inputs, "KRNO", outside_nct=OUTSIDE_NCT_REASON)
    assert _destinations(build_airport(inputs))["KRNO"]["nct"] is False


def test_an_outside_nct_reason_the_polygon_already_excludes_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    inputs = _with_destination(ksfo_build_inputs, "KAPC", outside_nct=OUTSIDE_NCT_REASON)
    with pytest.raises(ValueError, match=r"routes.yaml destinations\[KAPC\]: outside_nct is stated but the NCT terminal polygon already excludes"):
        build_airport(inputs)


def test_the_tec_rows_carry_their_source_cap_and_kind(ksfo_document: Document) -> None:
    rows = {row["id"]: row for row in ksfo_document["tecRoutes"]}
    assert len(rows) == TEC_ROUTE_COUNT
    capped = rows["TEC-KSMF-SFOW-P-01"]
    assert capped["source"] == TEC_SOURCE
    assert capped["kind"] == "tec"
    assert capped["runwayFamilies"] == ["01"]
    assert capped["classes"] == ["P"]
    assert capped["route"] == "SFO# OAK V6 SAC"
    assert "initialAltitudeFeet" not in capped
    assert capped["finalAltitudeFeet"] == KSMF_PROP_ALTITUDE_FEET
    assert "initialAltitudeFeet" not in rows["TEC-KSMF-SFOE-J"]
    assert "finalAltitudeFeet" not in rows["TEC-KSMF-SFOE-J"]
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


def test_the_shared_airways_are_emitted_with_their_direction(ksfo_document: Document, ksfo_build_inputs: BuildInputs) -> None:
    rows = ksfo_document["airways"]
    assert len(rows) == len(ksfo_build_inputs.airport.airways)
    assert rows == [{"id": "R463", "oneWay": True}, {"id": "R464", "oneWay": True}, {"id": "A220", "oneWay": True}]


def test_the_shared_common_arrivals_are_emitted_with_their_families_and_transitions(ksfo_document: Document, ksfo_build_inputs: BuildInputs) -> None:
    rows = {row["id"]: row for row in ksfo_document["commonArrivals"]}
    assert len(rows) == len(ksfo_build_inputs.airport.common_arrivals)
    irnmn = rows["CA-LAX-IRNMN"]
    assert (irnmn["family"], irnmn["transitions"], irnmn["classes"]) == ("IRNMN", ["BURGL", "REBRG"], ["J"])
    assert irnmn["destinations"] == ["KLAX"]
    assert "cargo" not in irnmn
    assert rows["CA-LAX-BAYST"]["cargo"] is True
    assert "classes" not in rows["CA-SMO-BONJO"]


def test_a_common_arrival_family_a_library_destination_does_not_publish_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    unpublished = replace(
        ksfo_build_inputs.airport.common_arrivals[0],
        id="CA-LAX-NOPE",
        family="NOPE",
        destinations=("KLAX",),
    )
    inputs = replace(ksfo_build_inputs, airport=replace(ksfo_build_inputs.airport, common_arrivals=(unpublished,)))
    with pytest.raises(ValueError, match=r"commonArrivals\[CA-LAX-NOPE\]: KLAX publishes no NOPE arrival"):
        build_airport(inputs)


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


def _with_loa_rule(inputs: BuildInputs, rule_id: str, rule: RouteTokenRule) -> BuildInputs:
    loa = inputs.airport.loa
    rules = tuple(replace(row, rule=rule) if row.id == rule_id else row for row in loa.rules)
    return replace(inputs, airport=replace(inputs.airport, loa=replace(loa, rules=rules)))


def test_a_route_rule_emits_its_classes_and_rnav_flag_only_where_the_row_states_them(ksfo_build_inputs: BuildInputs, ksfo_document: Document) -> None:
    narrowed = RouteTokenRule(tokens=("MOXEE",), classes=("P", "T"), rnav_only=True)
    document = build_airport(_with_loa_rule(ksfo_build_inputs, "LOA-ZSE-PDX-ROUTE", narrowed))
    portland = next(rule for rule in document["loaRules"] if rule["id"] == "LOA-ZSE-PDX-ROUTE")
    assert portland["rule"] == {"kind": "route", "tokens": ["MOXEE"], "classes": ["P", "T"], "rnavOnly": True}
    validate(document, schema_path())
    plain = next(rule for rule in ksfo_document["loaRules"] if rule["id"] == "LOA-ZSE-PDX-ROUTE")["rule"]
    assert "classes" not in plain
    assert "rnavOnly" not in plain


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


def _with_tec_route(inputs: BuildInputs, row_id: str, route: str) -> BuildInputs:
    tec = inputs.airport.tec
    assert tec is not None
    routes = tuple(replace(row, route=route) if row.id == row_id else row for row in tec.routes)
    return replace(inputs, airport=replace(inputs.airport, tec=replace(tec, routes=routes)))


def test_a_tec_row_on_an_initial_heading_keeps_the_token(ksfo_build_inputs: BuildInputs) -> None:
    inputs = _with_tec_route(ksfo_build_inputs, "TEC-KSMF-SFOW-P-28", "H270 OAK V6 SAC")
    rows = {row["id"]: row for row in build_airport(inputs)["tecRoutes"]}
    assert rows["TEC-KSMF-SFOW-P-28"]["route"] == "H270 OAK V6 SAC"


def test_a_tec_row_on_a_heading_no_aircraft_can_fly_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    inputs = _with_tec_route(ksfo_build_inputs, "TEC-KSMF-SFOW-P-28", "H000 OAK V6 SAC")
    with pytest.raises(ValueError, match=r"tecRoutes\[TEC-KSMF-SFOW-P-28\]: route begins on 'H000'.*write H001 through H360"):
        build_airport(inputs)


def _with_tec_destination(inputs: BuildInputs, row_id: str, destination: str) -> BuildInputs:
    tec = inputs.airport.tec
    assert tec is not None
    routes = tuple(replace(row, destination=destination) if row.id == row_id else row for row in tec.routes)
    return replace(inputs, airport=replace(inputs.airport, tec=replace(tec, routes=routes)))


def test_a_tec_row_to_a_field_outside_the_nct_polygon_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    inputs = _with_tec_destination(ksfo_build_inputs, "TEC-KSMF-SFOW-P-28", "KAPC")
    with pytest.raises(
        ValueError,
        match=r"tec.yaml routes\[TEC-KSMF-SFOW-P-28\]: destination KAPC lies outside the NCT terminal polygon "
        r"\(generator/shared/nct_boundary.yaml\); a TEC route is issued only to a field inside NCT",
    ):
        build_airport(inputs)


def test_a_field_another_facility_owns_takes_its_tec_rows_with_it(ksfo_build_inputs: BuildInputs) -> None:
    inputs = _with_destination(ksfo_build_inputs, "KSMF", outside_nct=OUTSIDE_NCT_REASON)
    with pytest.raises(ValueError, match=r"tec.yaml routes\[TEC-KSMF-SFOW-J\]: destination KSMF lies outside the NCT terminal polygon"):
        build_airport(inputs)


def test_an_adr_row_is_issued_to_a_field_outside_nct(ksfo_document: Document) -> None:
    rows = {row["id"]: row for row in ksfo_document["tecRoutes"]}
    assert rows["ADR-KSAN-SFOW"]["kind"] == "adr"
    assert _destinations(ksfo_document)["KSAN"]["nct"] is False


def test_a_rule_keyed_on_a_tec_route_without_a_dp_that_assigns_one_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    rules = list(ksfo_build_inputs.airport.sop.assignment_rules)
    index, rule = next((index, rule) for index, rule in enumerate(rules) if rule.when is not None and rule.sid_family is not None)
    when = rule.when
    assert when is not None
    rules[index] = replace(rule, when=replace(when, tec_route_without_dp=True))
    with pytest.raises(ValueError, match=rf"assignmentRules\[{rule.id}\]: the row is keyed on a TEC route without a DP"):
        build_airport(_with_sop(ksfo_build_inputs, assignment_rules=tuple(rules)))


def _defaulting_pcm(inputs: BuildInputs) -> BuildInputs:
    """Make the 28/01 class-default row default the airline PCM as well."""
    configs = []
    for config in inputs.airport.sop.runway_configs:
        if config.id == "28/01":
            runways = tuple(
                replace(runway, default_for_airlines=("PCM",)) if runway.default_for_classes else runway for runway in config.departure_runways
            )
            config = replace(config, departure_runways=runways)
        configs.append(config)
    return _with_sop(inputs, runway_configs=tuple(configs))


def _with_pcm_telephony(inputs: BuildInputs) -> BuildInputs:
    routes = replace(inputs.airport.routes, telephony={**inputs.airport.routes.telephony, "PCM": "Peninsula"})
    return replace(inputs, airport=replace(inputs.airport, routes=routes))


def _with_airline_default_rule(inputs: BuildInputs) -> BuildInputs:
    rule = PhraseologyRule(id="RWY-AIRLINE-DEFAULT", source="OAK ATCT SOP 2-1", text="the airline's props depart the runway their ramp is on")
    return _with_sop(inputs, phraseology_rules=(*inputs.airport.sop.phraseology_rules, rule))


def test_an_airline_default_without_telephony_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    match = r"runwayConfigs\[28/01\]\.departureRunways\[28R\]\.defaultForAirlines: 'PCM' has no telephony entry in routes.yaml"
    with pytest.raises(ValueError, match=match):
        build_airport(_defaulting_pcm(ksfo_build_inputs))


def test_an_airline_default_without_its_phraseology_row_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    inputs = _defaulting_pcm(_with_pcm_telephony(ksfo_build_inputs))
    with pytest.raises(ValueError, match=r"the airport has no RWY-AIRLINE-DEFAULT phraseology row"):
        build_airport(inputs)


def test_an_airline_default_is_emitted_on_the_departure_runway(ksfo_build_inputs: BuildInputs) -> None:
    document = build_airport(_with_airline_default_rule(_defaulting_pcm(_with_pcm_telephony(ksfo_build_inputs))))
    config = next(row for row in document["runwayConfigs"] if row["id"] == "28/01")
    defaults = [runway["defaultForAirlines"] for runway in config["departureRunways"]]
    assert defaults == [[], [], [], [], ["PCM"]]


def _defaulting_the_jet_group(inputs: BuildInputs) -> BuildInputs:
    """Make the 28/01 class-default row default the group the jets and the Dash 8 share."""
    configs = []
    for config in inputs.airport.sop.runway_configs:
        if config.id == "28/01":
            runways = tuple(
                replace(runway, default_for_groups=("jets_and_dh8d",)) if runway.default_for_classes else runway
                for runway in config.departure_runways
            )
            config = replace(config, departure_runways=runways)
        configs.append(config)
    groups = {**inputs.airport.sop.aircraft_groups, "jets_and_dh8d": AircraftGroup(classes=("J",), types=("DH8D",))}
    return _with_sop(inputs, runway_configs=tuple(configs), aircraft_groups=groups)


def _with_group_default_rule(inputs: BuildInputs) -> BuildInputs:
    rule = PhraseologyRule(id="RWY-GROUP-DEFAULT", source="OAK ATCT SOP 3-4", text="the heavy turboprops depart with the jets")
    return _with_sop(inputs, phraseology_rules=(*inputs.airport.sop.phraseology_rules, rule))


def test_a_group_default_without_its_phraseology_row_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    match = r"runwayConfigs\[28/01\]\.departureRunways\[28R\]\.defaultForGroups: the airport has no RWY-GROUP-DEFAULT phraseology row"
    with pytest.raises(ValueError, match=match):
        build_airport(_defaulting_the_jet_group(ksfo_build_inputs))


def test_a_group_default_is_emitted_on_the_departure_runway(ksfo_build_inputs: BuildInputs) -> None:
    document = build_airport(_with_group_default_rule(_defaulting_the_jet_group(ksfo_build_inputs)))
    config = next(row for row in document["runwayConfigs"] if row["id"] == "28/01")
    defaults = [runway["defaultForGroups"] for runway in config["departureRunways"]]
    assert defaults == [[], [], [], [], ["jets_and_dh8d"]]


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
    runways = tuple(record for record in ksfo_build_inputs.runways if record.designator != "19L")
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


def test_ksfo_emits_its_runway_bearings(ksfo_document: Document) -> None:
    assert ksfo_document["runways"] == [
        {"designator": "01L", "magneticBearing": 14.0},
        {"designator": "01R", "magneticBearing": 14.0},
        {"designator": "10L", "magneticBearing": 104.0},
        {"designator": "10R", "magneticBearing": 104.0},
        {"designator": "19L", "magneticBearing": 194.0},
        {"designator": "19R", "magneticBearing": 194.0},
        {"designator": "28L", "magneticBearing": 284.0},
        {"designator": "28R", "magneticBearing": 284.0},
    ]


def test_an_airport_whose_rows_name_no_group_emits_an_empty_table(ksfo_document: Document) -> None:
    assert ksfo_document["aircraftGroups"] == {}
    assert all("groups" not in rule for rule in ksfo_document["assignmentRules"])
    assert all("approachCategories" not in rule for rule in ksfo_document["assignmentRules"])
    assert all("groups" not in rule for rule in ksfo_document["altitudeRules"])


def test_aircraft_groups_and_the_rows_naming_them_are_emitted(ksfo_build_inputs: BuildInputs) -> None:
    groups = {"jets_and_dh8d": AircraftGroup(classes=("J",), types=("DH8D",))}
    rules = list(ksfo_build_inputs.airport.sop.assignment_rules)
    rules[0] = replace(rules[0], groups=("jets_and_dh8d",))
    altitudes = list(ksfo_build_inputs.airport.sop.altitude_rules)
    altitudes[0] = replace(altitudes[0], groups=("jets_and_dh8d",))
    document = build_airport(_with_sop(ksfo_build_inputs, aircraft_groups=groups, assignment_rules=tuple(rules), altitude_rules=tuple(altitudes)))
    assert document["aircraftGroups"] == {"jets_and_dh8d": {"classes": ["J"], "types": ["DH8D"]}}
    assert document["assignmentRules"][0]["groups"] == ["jets_and_dh8d"]
    assert document["altitudeRules"][0]["groups"] == ["jets_and_dh8d"]


def test_the_faa_table_fills_the_approach_category_of_every_fleet_type(ksfo_document: Document) -> None:
    categories = {entry["type"]: entry["approachCategory"] for entry in ksfo_document["routeLibrary"]["fleet"]}
    assert len(categories) == len(ksfo_document["routeLibrary"]["fleet"])
    assert set(categories.values()) <= {"A", "B", "C", "D"}
    assert categories["C172"] == "A"
    assert categories["B738"] == "D"


def test_a_fleet_type_the_faa_table_has_no_category_for_fails_the_build(ksfo_build_inputs: BuildInputs) -> None:
    table = {code: ksfo_build_inputs.aircraft_characteristics[code] for code in ("C172", "B738")}
    message = (
        r"routes\.yaml fleet\[A320\]: no approach category: the FAA table generator/shared/faa_aircraft_characteristics\.yaml "
        r"has no AAC for A320; run craft-gen fetch-aircraft-characteristics or state approach_category on the row with a note"
    )
    with pytest.raises(ValueError, match=message):
        build_airport(replace(ksfo_build_inputs, aircraft_characteristics=table))


def test_a_hand_approach_category_wins_over_the_faa_table(ksfo_build_inputs: BuildInputs) -> None:
    fleet = tuple(replace(entry, approach_category="B") if entry.type == "C172" else entry for entry in ksfo_build_inputs.airport.routes.fleet)
    library = replace(ksfo_build_inputs.airport.routes, fleet=fleet)
    document = build_airport(replace(ksfo_build_inputs, airport=replace(ksfo_build_inputs.airport, routes=library)))
    categories = {entry["type"]: entry["approachCategory"] for entry in document["routeLibrary"]["fleet"]}
    assert categories["C172"] == "B"
    assert categories["B738"] == "D"


def test_a_notice_that_issues_a_heading_emits_it(ksfo_build_inputs: BuildInputs) -> None:
    notice = ksfo_build_inputs.airport.sop.notices[0]
    with_heading = replace(notice, effect=replace(notice.effect, heading=120))
    document = build_airport(_with_sop(ksfo_build_inputs, notices=(with_heading,)))
    assert document["notices"][0]["effect"] == {"kind": "sid_off", "sidFamily": "SEGUL", "heading": 120}


def test_a_notice_that_issues_no_heading_emits_none(ksfo_document: Document) -> None:
    assert "heading" not in ksfo_document["notices"][0]["effect"]


def test_an_altitude_row_keyed_to_headings_emits_them(ksfo_build_inputs: BuildInputs) -> None:
    altitudes = list(ksfo_build_inputs.airport.sop.altitude_rules)
    altitudes[0] = replace(altitudes[0], sid_families=None, non_dp_headings=(315, "runway heading"))
    document = build_airport(_with_sop(ksfo_build_inputs, altitude_rules=tuple(altitudes)))
    assert document["altitudeRules"][0]["nonDpHeadings"] == [315, "runway heading"]
    assert "sidFamilies" not in document["altitudeRules"][0]
    assert all("nonDpHeadings" not in rule for rule in document["altitudeRules"][1:])


def test_approach_categories_are_emitted_once_the_fleet_carries_them(ksfo_build_inputs: BuildInputs) -> None:
    rules = list(ksfo_build_inputs.airport.sop.assignment_rules)
    rules[0] = replace(rules[0], approach_categories=("A", "B"))
    fleet = tuple(replace(entry, approach_category="C") for entry in ksfo_build_inputs.airport.routes.fleet)
    library = replace(ksfo_build_inputs.airport.routes, fleet=fleet)
    inputs = replace(ksfo_build_inputs, airport=replace(ksfo_build_inputs.airport, routes=library))
    document = build_airport(_with_sop(inputs, assignment_rules=tuple(rules)))
    assert document["assignmentRules"][0]["approachCategories"] == ["A", "B"]
    assert document["routeLibrary"]["fleet"][0]["approachCategory"] == "C"


def test_a_climb_via_eligible_override_wins_over_the_computed_reading(ksfo_build_inputs: BuildInputs) -> None:
    assert {sid["id"]: sid["climbViaEligible"] for sid in build_airport(ksfo_build_inputs)["sids"]}["GAPP7"] is False
    overrides = dict(ksfo_build_inputs.airport.overrides.sids)
    overrides["GAP SEVEN"] = replace(overrides["GAP SEVEN"], climb_via_eligible=True)
    airport = replace(ksfo_build_inputs.airport, overrides=replace(ksfo_build_inputs.airport.overrides, sids=overrides))
    document = build_airport(replace(ksfo_build_inputs, airport=airport))
    assert {sid["id"]: sid["climbViaEligible"] for sid in document["sids"]}["GAPP7"] is True
