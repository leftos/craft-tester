import re
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

import pytest
import yaml

from craft_generator.sop.load import (
    AIRCRAFT_TYPES_FILE,
    AIRLINES_FILE,
    AIRWAYS_FILE,
    COMMON_ARRIVALS_FILE,
    DESTINATIONS_FILE,
    LOA_RULES_FILE,
    NAVAID_NAMES_FILE,
    OVERRIDES_FILE,
    PHRASEOLOGY_RULES_FILE,
    ROUTE_CONNECTIONS_FILE,
    ROUTES_FILE,
    SOP_FILE,
    load_airport,
    load_airways,
    load_common_arrivals,
    load_navaid_names,
    load_overrides,
    load_phraseology_rules,
    load_route_connections,
    load_routes,
    load_shared_route_facts,
    load_sop,
    shared_dir,
    sid_family_of,
)
from craft_generator.sop.model import AirportInputs, SharedRouteFacts

Mutation = Callable[[Any], None]

HAND_EXPECT_MINUTES = 7

SHARED_PHRASEOLOGY_IDS = [
    "R-TRANSITION",
    "R-AS-FILED",
    "R-SID-STRUCTURE",
    "R-RV-SID",
    "R-RV-NAVAID",
    "R-THEN-AS-FILED",
    "R-ROUTE-BUILD",
    "R-ROUTE-TOKEN",
    "R-ARRIVAL",
    "R-HEADING",
    "R-RV-AIRWAY",
    "R-AIRWAY",
    "R-NAVAID",
    "R-RNAV-AIRWAY",
    "R-RNAV-WAYPOINT",
    "T-MODE-C",
    "A-CLIMB-VIA",
    "A-CLIMB-VIA-EXCEPT",
    "A-MAINTAIN",
    "A-EXPECT",
    "A-EXPECT-AMENDED",
    "A-EXPECT-REDUNDANT",
    "A-FINAL",
    "C-DEST",
    "A-PARITY",
    "A-ONE-WAY-AIRWAY",
    "A-RVSM",
    "R-THEN-AS-FILED-END",
    "R-FULL-ROUTE",
    "R-FACILITY-WORD",
    "S-FILLER",
    "S-ORDER",
    "S-NINER",
    "S-GROUP-FORM",
]
KSFO_PHRASEOLOGY_IDS = {"RWY-CLASS-DEFAULT", "RWY-ON-REQUEST", "RWY-DIRECTION", "RWY-FIRST", "A-CLIMB-VIA", "A-EXPECT"}
ROUTE_CONNECTION_COUNT = 31
ROUTE_CONNECTION_SOURCE = "OAK Route Building Cheat Sheet (vZOA S1-OAK-5), Common Fixes, routes dated 2025-01-20; retrieved 2026-09-16"
COMMON_ARRIVAL_COUNT = 29
COMMON_ARRIVAL_SOURCE = "Common ZLA Arrivals from ZOA (Oakland ARTCC on VATSIM), current as of 2025-01-13; retrieved 2026-09-16"
KSFO_TELEPHONY_COUNT = 28
KSFO_CARGO_AIRLINES = {"FDX", "UPS", "GTI", "ABX", "ATN", "CLX", "CKS", "NCA"}
# The airlines of each KSFO fleet type, as `routes.yaml` stated them before the facts moved to
# `generator/shared/`: the composition reproduces these sets, in the airport's own airline order.
KSFO_FLEET_AIRLINES = {
    "A320": {"UAL", "FFT", "NKS", "ACA", "AAY", "VOI", "JBU"},
    "A20N": {"FFT", "VOI", "JBU"},
    "A319": {"AAY", "UAL"},
    "B737": {"SWA", "ASA"},
    "B738": {"DAL", "SWA", "UAL", "ASA"},
    "B752": {"FDX", "UPS", "DAL", "UAL"},
    "B77L": {"FDX", "KAL"},
    "B788": {"NAX", "UAL"},
    "A306": {"UPS", "FDX"},
    "MD11": {"FDX", "UPS"},
    "E75L": {"SKW", "QXE"},
    "E135": {"JSX"},
    "CL30": {"TWY", "EJA"},
    "GL5T": {"EJA"},
    "C750": {"XOJ"},
    "C55B": set[str](),
    "C25B": set[str](),
    "C510": set[str](),
    "E55P": {"LXJ"},
    "B350": set[str](),
    "BE20": set[str](),
    "TBM9": set[str](),
    "C172": set[str](),
    "SR22": set[str](),
    "M20T": set[str](),
}
SHARED_FILES = (
    ("destinations", DESTINATIONS_FILE),
    ("airlines", AIRLINES_FILE),
    ("aircraft_types", AIRCRAFT_TYPES_FILE),
    ("loa_rules", LOA_RULES_FILE),
    ("airways", AIRWAYS_FILE),
    ("common_arrivals", COMMON_ARRIVALS_FILE),
    ("navaid_names", NAVAID_NAMES_FILE),
)


def shared_copy(tmp_path: Path, **mutations: Mutation) -> SharedRouteFacts:
    """Copy the shared route facts into ``tmp_path``, applying one mutation per file before loading them."""
    target = tmp_path / "shared"
    target.mkdir(exist_ok=True)
    for key, name in SHARED_FILES:
        data = yaml.safe_load((shared_dir() / name).read_text(encoding="utf-8"))
        mutate = mutations.get(key)
        if mutate is not None:
            mutate(data)
        (target / name).write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    return load_shared_route_facts(target)


def airport_copy(tmp_path: Path, ksfo_dir: Path, **mutations: Mutation) -> Path:
    """Copy the KSFO YAML into ``tmp_path``, applying one mutation per file before writing it."""
    target = tmp_path / "ksfo"
    target.mkdir(exist_ok=True)
    for key, name in (("sop", SOP_FILE), ("overrides", OVERRIDES_FILE), ("routes", ROUTES_FILE)):
        data = yaml.safe_load((ksfo_dir / name).read_text(encoding="utf-8"))
        mutate = mutations.get(key)
        if mutate is not None:
            mutate(data)
        (target / name).write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    return target


def rule_by_id(inputs: AirportInputs, rule_id: str) -> Any:
    return next(rule for rule in inputs.sop.assignment_rules if rule.id == rule_id)


def test_airport_dir_points_at_the_checked_in_yaml(ksfo_dir: Path) -> None:
    assert ksfo_dir.name == "ksfo"
    assert (ksfo_dir / SOP_FILE).is_file()


def test_ksfo_loads(ksfo_inputs: AirportInputs) -> None:
    sop = ksfo_inputs.sop
    assert ksfo_inputs.icao == "KSFO"
    assert sop.airport.clearance_delivery == "118.2"
    assert sop.runways == ("01L", "01R", "10L", "10R", "19L", "19R", "28L", "28R")
    assert len(sop.source.sha256) == 64
    assert len(sop.source.sentinels) == 5
    assert sop.source.transcribed_at == date(2026, 9, 15)
    assert [source.id for source in sop.secondary_sources] == ["cbt", "craft_phraseology"]
    assert sop.secondary_sources[0].dated == date(2023, 2, 26)
    assert sop.secondary_sources[1].dated == date(2026, 9, 15)


def test_runway_configs_and_sectors(ksfo_inputs: AirportInputs) -> None:
    sop = ksfo_inputs.sop
    configs = {config.id: config for config in sop.runway_configs}
    assert set(configs) == {"01/01", "28/01", "28 RT", "28 SO", "10/10", "19/10", "19/19"}
    assert all(config.source == "SFO ATCT SOP 1-7" for config in sop.runway_configs)
    assert configs["28/01"].plan == "SFOW"
    assert configs["28/01"].training_weight == 55
    assert sum(config.training_weight for config in sop.runway_configs) == 100
    twenty_eight_left = next(runway for runway in configs["28/01"].departure_runways if runway.runway == "28L")
    assert twenty_eight_left.classes == ("J",)
    assert twenty_eight_left.note is not None
    assert configs["01/01"].departure_runways[0].note is None
    assert [sector.id for sector in sop.departure_sectors] == ["richmond", "sutro"]
    assert [fallback.id for fallback in sop.departure_staffing_fallbacks] == ["area_d_combined", "nct_combined", "center_combined"]
    assert sop.direction_runway_preference["SFOW"]["north"] == {"01": "01R", "28": "28L"}
    assert sop.direction_runway_preference["SFOE"]["oceanic"]["19"] == "19R"


def test_gates_no_sid_and_noise_windows(ksfo_inputs: AirportInputs) -> None:
    sop = ksfo_inputs.sop
    assert "DEDHD" in sop.gates.north
    assert "YYUNG" in sop.gates.south
    assert "BEBOP" in sop.gates.oceanic
    assert sop.no_sid.runway_families == ("01", "10")
    assert sop.no_sid.phrasing == "radar_vectors_fix"
    night = next(window for window in sop.noise_windows if window.id == "night")
    assert (night.start, night.end, night.sunday_end) == ("22:00", "07:00", "08:00")
    assert next(window for window in sop.noise_windows if window.id == "late_night").sunday_end is None


def test_assignment_rules_carry_their_conditions(ksfo_inputs: AirportInputs) -> None:
    first = ksfo_inputs.sop.assignment_rules[0]
    assert first.id == "SFOW-NOISE-N-NIITE"
    assert (first.direction, first.classes, first.sector) == ("north", ("P", "T", "J"), "richmond")
    assert first.when is not None
    assert (first.when.noise_window, first.when.rnav) == ("night", True)
    late_night = rule_by_id(ksfo_inputs, "SFOW-NOISE-S-NIITE-GOBBS")
    assert late_night.when is not None
    assert late_night.when.forced_transition == "GOBBS"
    assert rule_by_id(ksfo_inputs, "SFOW-N-TRUKN-28").when.configs == ("28 RT",)
    assert rule_by_id(ksfo_inputs, "SFOW-N-SNTNA-28").when.not_configs == ("28 RT",)
    assert rule_by_id(ksfo_inputs, "SFOW-S-SEGUL").when.exit_fixes == ("YYUNG",)
    assert rule_by_id(ksfo_inputs, "SFOW-S-GAPP").when is None
    assert first.when.tec_route_without_dp is None


def test_tec_route_without_dp_loads_as_a_flag(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["assignment_rules"][0]["when"]["tec_route_without_dp"] = True

    sop = load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)
    assert sop.assignment_rules[0].when is not None
    assert sop.assignment_rules[0].when.tec_route_without_dp is True


def test_non_boolean_tec_route_without_dp_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["assignment_rules"][0]["when"]["tec_route_without_dp"] = "yes"

    with pytest.raises(ValueError, match=r"tec_route_without_dp"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_non_dp_rule_has_no_sid_family(ksfo_inputs: AirportInputs) -> None:
    rule = rule_by_id(ksfo_inputs, "SFOW-NOISE-P-RWY")
    assert rule.sid_family is None
    assert rule.non_dp_heading == "runway heading"
    assert rule.direction == "any"


def test_altitude_rules_notices_and_phraseology(ksfo_inputs: AirportInputs) -> None:
    sop = ksfo_inputs.sop
    first = sop.altitude_rules[0]
    assert first.id == "SFOW-28-3000"
    assert first.sid_families == ("GAPP", "MOLEN", "SEGUL", "SFO", "WESLA")
    assert (first.outcome.kind, first.outcome.feet) == ("interim", 3000)
    assert (first.when_top_altitude_published, first.expect_after_minutes) == ("climb_via", 10)
    assert sop.altitude_rules[1].sid_families is None
    notice = sop.notices[0]
    assert (notice.id, notice.effect.kind, notice.effect.sid_family, notice.default_active) == ("SFO-SEGUL-OFF", "sid_off", "SEGUL", True)
    assert notice.effect.heading is None
    assert notice.dated == date(2026, 9, 15)
    assert sop.phraseology.expect_altitude == "unless_chart_publishes_it"
    assert sop.phraseology.non_standard_interim_expect_minutes == 3
    assert sop.phraseology.vector_hybrid_transitions_spoken is False
    assert {rule.id for rule in sop.phraseology_rules} == KSFO_PHRASEOLOGY_IDS


def test_the_shared_phraseology_rules_carry_the_rows_every_airport_inherits() -> None:
    rules = load_phraseology_rules(shared_dir() / PHRASEOLOGY_RULES_FILE)
    assert [rule.id for rule in rules] == SHARED_PHRASEOLOGY_IDS
    assert [rule.id for rule in rules if rule.id.startswith("RWY-")] == []


def test_a_shared_phraseology_id_stated_twice_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / PHRASEOLOGY_RULES_FILE
    path.write_text(
        "phraseology_rules:\n  - { id: A-MAINTAIN, source: one, text: first }\n  - { id: A-MAINTAIN, source: two, text: second }\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"A-MAINTAIN.*already used by an earlier row"):
        load_phraseology_rules(path)


def test_the_shared_route_connections_load() -> None:
    connections = load_route_connections(shared_dir() / ROUTE_CONNECTIONS_FILE)
    assert len(connections) == ROUTE_CONNECTION_COUNT
    strengths = {(connection.from_fix, connection.to): connection.connects for connection in connections}
    assert strengths[("SUSEY", "EBAYE")] == "always"
    assert strengths[("EBAYE", "AVE")] == "usually"
    assert {connection.source for connection in connections} == {ROUTE_CONNECTION_SOURCE}


def test_a_route_connection_stated_twice_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / ROUTE_CONNECTIONS_FILE
    path.write_text(
        "source: the sheet\nconnections:\n  - { from: SUSEY, to: EBAYE, connects: always }\n  - { from: SUSEY, to: EBAYE, connects: usually }\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"SUSEY -> EBAYE.*already stated by an earlier row"):
        load_route_connections(path)


def test_a_route_connection_with_a_bad_token_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / ROUTE_CONNECTIONS_FILE
    path.write_text("source: the sheet\nconnections:\n  - { from: SUSEY, to: ebaye, connects: always }\n", encoding="utf-8")
    with pytest.raises(ValueError, match=r"connections\[0\]\.to: 'ebaye' is not an upper-case route token"):
        load_route_connections(path)


def test_the_shared_airways_load() -> None:
    airways = load_airways(shared_dir() / AIRWAYS_FILE)
    by_id = {airway.id: airway for airway in airways}
    assert set(by_id) == {"R463", "R464", "A220"}
    assert all(airway.one_way for airway in airways)
    assert "BEBOP" in by_id["R464"].note


def test_an_airway_stated_twice_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / AIRWAYS_FILE
    path.write_text(
        "source: { title: the charts, dated: 2026-09-16 }\nairways:\n"
        "  - { id: R464, one_way: true, note: first }\n  - { id: R464, one_way: false, note: second }\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"airways\[R464\]: the identifier is already stated by an earlier row"):
        load_airways(path)


def test_an_airway_with_a_bad_identifier_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / AIRWAYS_FILE
    path.write_text(
        "source: { title: the charts, dated: 2026-09-16 }\nairways:\n  - { id: BEBOP, one_way: true, note: a fix, not an airway }\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"airways\[BEBOP\]\.id: 'BEBOP' is not an airway identifier"):
        load_airways(path)


def test_the_shared_airways_reach_every_airport(ksfo_inputs: AirportInputs) -> None:
    assert [airway.id for airway in ksfo_inputs.airways] == ["R463", "R464", "A220"]


def test_the_shared_navaid_names_load() -> None:
    names = load_navaid_names(shared_dir() / NAVAID_NAMES_FILE)
    assert [(row.id, row.spoken) for row in names] == [("ECA", "Manteca VOR"), ("SMA", "Saint Mary's NDB"), ("KAE", "Gangwon VOR")]
    assert "decommissioned" in names[0].note


def test_a_navaid_name_stated_twice_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / NAVAID_NAMES_FILE
    path.write_text(
        "source: { title: the charts, dated: 2026-09-17 }\nnavaid_names:\n"
        "  - { id: ECA, spoken: Manteca VOR, note: first }\n  - { id: ECA, spoken: Stockton VOR, note: second }\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"navaid_names\[ECA\]: the identifier is already stated by an earlier row"):
        load_navaid_names(path)


def test_a_navaid_name_with_a_bad_identifier_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / NAVAID_NAMES_FILE
    path.write_text(
        'source: { title: the charts, dated: 2026-09-17 }\nnavaid_names:\n  - { id: BEBOP, spoken: Bebop, note: "a fix, not a navaid" }\n',
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"navaid_names\[BEBOP\]\.id: 'BEBOP' is not a navaid identifier"):
        load_navaid_names(path)


def test_the_shared_common_arrivals_load() -> None:
    arrivals = load_common_arrivals(shared_dir() / COMMON_ARRIVALS_FILE)
    assert len(arrivals) == COMMON_ARRIVAL_COUNT
    by_id = {arrival.id: arrival for arrival in arrivals}
    first = arrivals[0]
    assert first.id == "CA-LAX-IRNMN"
    assert (first.family, first.transitions, first.classes, first.cargo) == ("IRNMN", ("BURGL", "REBRG"), ("J",), False)
    assert first.text == "LAX jets: IRNMN# via BURGL or REBRG (west flow)"
    assert by_id["CA-SMO-BONJO"].classes is None
    assert by_id["CA-SMO-BONJO"].text.startswith("SMO all: BONJO# via REBRG, RDHOT or HONZK")
    assert by_id["CA-LAX-BAYST"].cargo is True
    assert {arrival.source for arrival in arrivals} == {COMMON_ARRIVAL_SOURCE}


def test_a_common_arrival_row_with_an_unknown_class_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / COMMON_ARRIVALS_FILE
    path.write_text(
        "source: { title: the sheet, dated: 2025-01-13 }\narrivals:\n"
        "  - { destinations: [KLAX], classes: [X], family: IRNMN, transitions: [BURGL] }\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"arrivals\[0\]\.classes\[0\]: 'X' is not one of"):
        load_common_arrivals(path)


def test_two_common_arrival_rows_for_the_same_family_and_first_destination_are_rejected(tmp_path: Path) -> None:
    path = tmp_path / COMMON_ARRIVALS_FILE
    path.write_text(
        "source: { title: the sheet, dated: 2025-01-13 }\narrivals:\n"
        "  - { destinations: [KLAX], family: IRNMN, transitions: [BURGL] }\n"
        "  - { destinations: [KLAX, KSMO], family: IRNMN, transitions: [REBRG] }\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"arrivals\[CA-LAX-IRNMN\]: the identifier is already stated by an earlier row"):
        load_common_arrivals(path)


def test_the_shared_common_arrivals_reach_every_airport(ksfo_inputs: AirportInputs) -> None:
    assert ksfo_inputs.common_arrivals == load_common_arrivals(shared_dir() / COMMON_ARRIVALS_FILE)
    assert [arrival.id for arrival in ksfo_inputs.common_arrivals[:2]] == ["CA-LAX-IRNMN", "CA-LAX-SADDE"]


def test_an_airport_phraseology_id_stated_twice_is_rejected(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["phraseology_rules"].append(dict(data["phraseology_rules"][0]))

    with pytest.raises(ValueError, match=r"RWY-CLASS-DEFAULT.*already used by an earlier row"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_overrides_carry_per_runway_facts(ksfo_inputs: AirportInputs) -> None:
    overrides = ksfo_inputs.overrides
    sfo5 = overrides.sids["SAN FRANCISCO FIVE"]
    assert (sfo5.cifp_id, sfo5.kind, sfo5.route_phrasing) == ("SFO5", "radar_vectors", "radar_vectors_fix")
    assert sfo5.runways == ("01L", "01R", "28L", "28R")
    assert sfo5.top_altitude is not None
    assert (sfo5.top_altitude.kind, sfo5.top_altitude.feet) == ("assigned_by_atc", None)
    assert sfo5.has_crossing_restrictions is False
    assert sfo5.crossing_restrictions_by_runway_family == {"01": True, "28": False}
    assert overrides.sids["GAP SEVEN"].transitions_spoken_as_transition is False
    assert overrides.sids["CIITY THREE (RNAV)"].note is None
    assert overrides.fix_spoken["MCK"] == "McCook VOR"


def test_routes_destinations_and_fleet(ksfo_inputs: AirportInputs) -> None:
    routes = ksfo_inputs.routes
    destinations = {destination.icao: destination for destination in routes.destinations}
    assert destinations["KSEA"].outside_nct is None
    assert destinations["KSMF"].outside_nct is None
    assert (destinations["RKSI"].lat, destinations["RKSI"].lon) == (37.469, 126.451)
    assert destinations["KSEA"].lat is None
    fleet = {entry.type: entry for entry in routes.fleet}
    assert (fleet["A20N"].aircraft_class, fleet["A20N"].wtc, fleet["A20N"].suffixes) == ("J", "M", ("/L",))
    assert fleet["B350"].aircraft_class == "T"
    assert fleet["C55B"].airlines == ()
    first = routes.routes[0]
    assert (first.exit_fix, first.destination, first.classes, first.altitudes) == ("DEDHD", "KSEA", ("J",), (32000, 34000, 36000))


def test_the_composed_fleet_and_airlines_match_the_curated_library(ksfo_inputs: AirportInputs) -> None:
    routes = ksfo_inputs.routes
    assert {entry.type: set(entry.airlines) for entry in routes.fleet} == KSFO_FLEET_AIRLINES
    assert len(routes.telephony) == KSFO_TELEPHONY_COUNT
    assert routes.telephony["UAL"] == "United"
    assert set(routes.cargo_airlines) == KSFO_CARGO_AIRLINES
    assert set(routes.telephony) >= set(routes.cargo_airlines)


def test_the_shared_route_facts_load_and_agree(shared_route_facts: SharedRouteFacts) -> None:
    assert shared_route_facts.destinations["KSMF"].outside_nct is None
    assert shared_route_facts.destinations["KCCR"].outside_nct == (
        "Travis Approach owns a shelf below NCT's lateral boundary down to the ground over Concord (user, 2026-09-16)"
    )
    assert shared_route_facts.destinations["KPHX"].artcc == "ZAB"
    assert shared_route_facts.airlines["PCM"].cargo is True
    assert shared_route_facts.airlines["UAL"].cargo is False
    assert shared_route_facts.aircraft_types["C208"].suffixes == ("/G", "/A")
    for airline in shared_route_facts.airlines.values():
        unknown = [designator for designator in airline.types if designator not in shared_route_facts.aircraft_types]
        assert unknown == [], f"{airline.code} flies {unknown}, which {AIRCRAFT_TYPES_FILE} does not state"


def test_a_hand_nct_flag_is_rejected(tmp_path: Path) -> None:
    def mutate(data: Any) -> None:
        data["destinations"]["KSMF"]["nct"] = True

    with pytest.raises(ValueError, match=r"destinations\[KSMF\]: `nct` is computed at build time from generator/shared/nct_boundary\.yaml"):
        shared_copy(tmp_path, destinations=mutate)


def test_an_empty_outside_nct_reason_is_rejected(tmp_path: Path) -> None:
    def mutate(data: Any) -> None:
        data["destinations"]["KCCR"]["outside_nct"] = "  "

    with pytest.raises(ValueError, match=r"destinations\[KCCR\]\.outside_nct: the key states no reason"):
        shared_copy(tmp_path, destinations=mutate)


def test_sid_family_of_rejects_an_unversioned_id() -> None:
    assert sid_family_of("TRUKN2", "where") == "TRUKN"
    with pytest.raises(ValueError, match="cifp_id 'GAPP' is not upper-case letters followed by a version number"):
        sid_family_of("GAPP", "overrides.yaml sids[GAP SEVEN]")


def test_unknown_key_in_a_rule_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["assignment_rules"][0]["runway_familes"] = ["01"]

    with pytest.raises(ValueError, match=r"assignment_rules\[SFOW-NOISE-N-NIITE\]: unknown key\(s\) \['runway_familes'\]"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_unknown_top_level_key_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["noise_window"] = []

    with pytest.raises(ValueError, match=r"sop.yaml: unknown key\(s\) \['noise_window'\]"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_missing_required_key_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        del data["source"]["sha256"]

    with pytest.raises(ValueError, match=r"sop\.yaml\.source: required key 'sha256' is missing"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_unknown_sector_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["assignment_rules"][0]["sector"] = "nowhere"

    with pytest.raises(ValueError, match=r"assignment_rules\[SFOW-NOISE-N-NIITE\]: sector 'nowhere' is not a `departure_sectors` id"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_rule_with_both_a_sid_family_and_a_heading_is_rejected(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["assignment_rules"][0]["non_dp_heading"] = "runway heading"

    with pytest.raises(ValueError, match="needs exactly one of `sid_family` and `non_dp_heading`"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def _with_non_dp_heading(value: Any) -> Mutation:
    """A mutation that puts ``value`` on the one KSFO rule that clears a flight without a DP."""

    def mutate(data: Any) -> None:
        rule = next(row for row in data["assignment_rules"] if row["id"] == "SFOW-NOISE-P-RWY")
        rule["non_dp_heading"] = value

    return mutate


def test_rule_with_a_numbered_heading_loads(tmp_path: Path, ksfo_dir: Path) -> None:
    sop = load_sop(airport_copy(tmp_path, ksfo_dir, sop=_with_non_dp_heading(270)) / SOP_FILE)
    rule = next(row for row in sop.assignment_rules if row.id == "SFOW-NOISE-P-RWY")
    assert rule.non_dp_heading == 270


@pytest.mark.parametrize("value", ["270", 0, 361])
def test_rule_with_a_heading_that_is_not_a_degree_number_is_rejected(tmp_path: Path, ksfo_dir: Path, value: Any) -> None:
    message = f"non_dp_heading is {value!r}; write 'runway heading' or a magnetic heading as an integer from 1 to 360"
    with pytest.raises(ValueError, match=re.escape(message)):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=_with_non_dp_heading(value)) / SOP_FILE)


def _with_notice_heading(value: Any) -> Mutation:
    """A mutation that has the KSFO notice issue ``value`` in place of the DP it takes out of use."""

    def mutate(data: Any) -> None:
        data["notices"][0]["effect"]["heading"] = value

    return mutate


def test_notice_that_issues_a_heading_loads(tmp_path: Path, ksfo_dir: Path) -> None:
    sop = load_sop(airport_copy(tmp_path, ksfo_dir, sop=_with_notice_heading(120)) / SOP_FILE)
    assert sop.notices[0].effect.heading == 120


def test_notice_heading_that_is_not_a_degree_number_is_rejected(tmp_path: Path, ksfo_dir: Path) -> None:
    message = "non_dp_heading is 0; write 'runway heading' or a magnetic heading as an integer from 1 to 360"
    with pytest.raises(ValueError, match=re.escape(message)):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=_with_notice_heading(0)) / SOP_FILE)


def _with_altitude_headings(value: Any) -> Mutation:
    """A mutation that keys the first KSFO altitude row to ``value`` in place of its DP families."""

    def mutate(data: Any) -> None:
        rule = data["altitude_rules"][0]
        del rule["sid_families"]
        rule["non_dp_headings"] = value

    return mutate


def test_altitude_rule_keyed_to_headings_loads(tmp_path: Path, ksfo_dir: Path) -> None:
    sop = load_sop(airport_copy(tmp_path, ksfo_dir, sop=_with_altitude_headings([315, "runway heading"])) / SOP_FILE)
    rule = sop.altitude_rules[0]
    assert rule.non_dp_headings == (315, "runway heading")
    assert rule.sid_families is None
    assert sop.altitude_rules[1].non_dp_headings is None


@pytest.mark.parametrize("value", [0, 361, "north"])
def test_altitude_rule_heading_that_is_not_a_degree_number_is_rejected(tmp_path: Path, ksfo_dir: Path, value: Any) -> None:
    message = f"non_dp_heading is {value!r}; write 'runway heading' or a magnetic heading as an integer from 1 to 360"
    with pytest.raises(ValueError, match=re.escape(message)):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=_with_altitude_headings([value])) / SOP_FILE)


def test_altitude_rule_with_both_sid_families_and_headings_is_rejected(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["altitude_rules"][0]["non_dp_headings"] = ["runway heading"]

    with pytest.raises(ValueError, match=r"altitude_rules\[SFOW-28-3000\]: a rule keys on `sid_families` or on `non_dp_headings`, never both"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_rule_with_neither_a_sid_family_nor_a_heading_is_rejected(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["assignment_rules"][0]["sid_family"] = None

    with pytest.raises(ValueError, match=r"assignment_rules\[SFOW-NOISE-N-NIITE\].*needs exactly one of"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_unknown_noise_window_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["assignment_rules"][0]["when"]["noise_window"] = "evening"

    with pytest.raises(ValueError, match=r"when\.noise_window 'evening' is not a `noise_windows` id"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


@pytest.mark.parametrize("key", ["configs", "not_configs"])
def test_unknown_runway_config_is_named(tmp_path: Path, ksfo_dir: Path, key: str) -> None:
    def mutate(data: Any) -> None:
        rule = next(row for row in data["assignment_rules"] if row["id"] == "SFOW-N-TRUKN-28")
        rule["when"].pop("configs", None)
        rule["when"][key] = ["28 LT"]

    with pytest.raises(ValueError, match=rf"assignment_rules\[SFOW-N-TRUKN-28\]: when.{key} names '28 LT'"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_default_for_classes_round_trips(ksfo_inputs: AirportInputs) -> None:
    configs = {config.id: config for config in ksfo_inputs.sop.runway_configs}
    defaults = [runway for runway in configs["28/01"].departure_runways if runway.default_for_classes]
    assert [(runway.runway, runway.default_for_classes) for runway in defaults] == [("28R", ("P", "T"))]
    assert defaults[0].classes == ("P", "T")
    assert configs["28/01"].departure_runways[0].default_for_classes == ()


def test_default_for_a_class_the_row_excludes_is_rejected(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        config = next(row for row in data["runway_configs"] if row["id"] == "28/01")
        config["departure_runways"][0]["default_for_classes"] = ["J", "P"]
        config["departure_runways"][0]["classes"] = ["P", "T"]

    match = r"runway_configs\[28/01\]\.departure_runways\[01L\]\.default_for_classes: class 'J' is not in the row's `classes`"
    with pytest.raises(ValueError, match=match):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_default_for_airlines_round_trips(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        config = next(row for row in data["runway_configs"] if row["id"] == "28/01")
        config["departure_runways"][4]["default_for_airlines"] = ["PCM"]

    sop = load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)
    config = next(row for row in sop.runway_configs if row.id == "28/01")
    assert config.departure_runways[4].default_for_airlines == ("PCM",)
    assert config.departure_runways[0].default_for_airlines == ()


@pytest.mark.parametrize("code", ["pcm", "PCMX"])
def test_malformed_airline_code_is_named(tmp_path: Path, ksfo_dir: Path, code: str) -> None:
    def mutate(data: Any) -> None:
        config = next(row for row in data["runway_configs"] if row["id"] == "28/01")
        config["departure_runways"][0]["default_for_airlines"] = [code]

    match = rf"departure_runways\[0\]\.default_for_airlines\[0\]: '{code}' is not a three-letter upper-case ICAO airline code"
    with pytest.raises(ValueError, match=match):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_airline_default_that_is_also_on_request_is_rejected(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        config = next(row for row in data["runway_configs"] if row["id"] == "28/01")
        config["departure_runways"][2]["default_for_airlines"] = ["PCM"]

    match = r"runway '28L' is the default for airline\(s\) \['PCM'\] and also on request for \['cargo', 'heavy', 'oceanic'\]"
    with pytest.raises(ValueError, match=match):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_two_rows_defaulting_the_same_airline_are_rejected(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        config = next(row for row in data["runway_configs"] if row["id"] == "28/01")
        config["departure_runways"][0]["default_for_airlines"] = ["PCM"]
        config["departure_runways"][1]["default_for_airlines"] = ["PCM"]

    match = r"departure_runways\[01R\]\.default_for_airlines: airline 'PCM' already defaults to runway '01L' in this configuration"
    with pytest.raises(ValueError, match=match):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def _with_jet_group(data: Any) -> None:
    """Give the SOP the OAK group that takes the jets whole and adds the Dash 8 by type."""
    data["aircraft_groups"] = {"jets_and_dh8d": {"classes": ["J"], "types": ["DH8D"]}}


def test_default_for_groups_round_trips(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        _with_jet_group(data)
        config = next(row for row in data["runway_configs"] if row["id"] == "28/01")
        config["departure_runways"][0]["default_for_groups"] = ["jets_and_dh8d"]

    sop = load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)
    config = next(row for row in sop.runway_configs if row.id == "28/01")
    assert config.departure_runways[0].default_for_groups == ("jets_and_dh8d",)
    assert config.departure_runways[1].default_for_groups == ()


def test_default_for_an_unknown_group_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        _with_jet_group(data)
        config = next(row for row in data["runway_configs"] if row["id"] == "28/01")
        config["departure_runways"][0]["default_for_groups"] = ["heavies"]

    match = (
        r"runway_configs\[28/01\]\.departure_runways\[01L\]\.default_for_groups: 'heavies' is not an `aircraft_groups` id; "
        r"use one of \['jets_and_dh8d'\]"
    )
    with pytest.raises(ValueError, match=match):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_group_default_that_is_also_on_request_is_rejected(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        _with_jet_group(data)
        config = next(row for row in data["runway_configs"] if row["id"] == "28/01")
        config["departure_runways"][2]["default_for_groups"] = ["jets_and_dh8d"]

    match = r"runway '28L' is the default for group\(s\) \['jets_and_dh8d'\] and also on request for \['cargo', 'heavy', 'oceanic'\]"
    with pytest.raises(ValueError, match=match):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_two_rows_defaulting_the_same_group_are_rejected(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        _with_jet_group(data)
        config = next(row for row in data["runway_configs"] if row["id"] == "28/01")
        config["departure_runways"][0]["default_for_groups"] = ["jets_and_dh8d"]
        config["departure_runways"][1]["default_for_groups"] = ["jets_and_dh8d"]

    match = r"departure_runways\[01R\]\.default_for_groups: group 'jets_and_dh8d' already defaults to runway '01L' in this configuration"
    with pytest.raises(ValueError, match=match):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_non_positive_training_weight_is_rejected(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        config = next(row for row in data["runway_configs"] if row["id"] == "28/01")
        config["training_weight"] = 0

    with pytest.raises(ValueError, match=r"training_weight must be a positive integer"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_two_rows_defaulting_the_same_class_are_rejected(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        config = next(row for row in data["runway_configs"] if row["id"] == "28/01")
        config["departure_runways"][0]["default_for_classes"] = ["T"]

    match = r"departure_runways\[28R\]\.default_for_classes: class 'T' already defaults to runway '01L' in this configuration"
    with pytest.raises(ValueError, match=match):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_unknown_runway_family_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["altitude_rules"][0]["runway_families"] = ["27"]

    with pytest.raises(ValueError, match=r"altitude_rules\[SFOW-28-3000\]: runway family '27' is not a two-character prefix"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_unknown_no_sid_runway_family_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["no_sid"]["runway_families"] = ["01", "1"]

    with pytest.raises(ValueError, match="no_sid: runway family '1' is not a two-character prefix"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_direction_preference_runway_must_exist(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["direction_runway_preference"]["SFOW"]["north"]["01"] = "01C"

    with pytest.raises(ValueError, match=r"direction_runway_preference.SFOW.north.01: runway '01C' is not in `runways`"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_gate_fix_in_two_directions_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["gates"]["south"].append("DEDHD")

    with pytest.raises(ValueError, match=r"gates\.south: fix 'DEDHD' is already listed under gates\.north"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_duplicate_override_procedure_id_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["sids"]["SNTNA TWO (RNAV)"]["cifp_id"] = "TRUKN2"

    with pytest.raises(ValueError, match=r"sids\[SNTNA TWO \(RNAV\)\]: cifp_id 'TRUKN2' is already used by sids\[TRUKN TWO \(RNAV\)\]"):
        load_overrides(airport_copy(tmp_path, ksfo_dir, overrides=mutate) / OVERRIDES_FILE)


def test_unknown_route_destination_is_named(tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts) -> None:
    def mutate(data: Any) -> None:
        data["routes"][0]["destination"] = "KZZZ"

    with pytest.raises(ValueError, match=r"routes\[DEDHD -> KZZZ\]: destination 'KZZZ' is not in `destinations`"):
        load_routes(airport_copy(tmp_path, ksfo_dir, routes=mutate) / ROUTES_FILE, shared_route_facts)


def test_unknown_aircraft_class_in_a_route_is_named(tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts) -> None:
    def mutate(data: Any) -> None:
        data["routes"][0]["classes"] = ["J", "X"]

    with pytest.raises(ValueError, match=r"routes\[0\].classes\[1\]: 'X' is not one of \['P', 'T', 'J'\]"):
        load_routes(airport_copy(tmp_path, ksfo_dir, routes=mutate) / ROUTES_FILE, shared_route_facts)


def test_malformed_equipment_suffix_is_named(tmp_path: Path) -> None:
    def mutate(data: Any) -> None:
        data["types"]["A320"]["suffixes"] = ["/L", "LL"]

    with pytest.raises(ValueError, match="suffix 'LL' is not a slash and one upper-case letter"):
        shared_copy(tmp_path, aircraft_types=mutate)


def test_a_destination_code_outside_the_shared_file_is_named(tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts) -> None:
    def mutate(data: Any) -> None:
        data["destinations"][0] = "KZZZ"

    with pytest.raises(ValueError, match=r"routes\.yaml\.destinations: 'KZZZ' is not in generator/shared/destinations\.yaml; add it there first"):
        load_routes(airport_copy(tmp_path, ksfo_dir, routes=mutate) / ROUTES_FILE, shared_route_facts)


def test_an_airline_code_outside_the_shared_file_is_named(tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts) -> None:
    def mutate(data: Any) -> None:
        data["airlines"][0] = "ZZZ"

    with pytest.raises(ValueError, match=r"routes\.yaml\.airlines: 'ZZZ' is not in generator/shared/airlines\.yaml; add it there first"):
        load_routes(airport_copy(tmp_path, ksfo_dir, routes=mutate) / ROUTES_FILE, shared_route_facts)


def test_a_fleet_type_outside_the_shared_file_is_named(tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts) -> None:
    def mutate(data: Any) -> None:
        data["fleet"][0] = "ZZZZ"

    with pytest.raises(ValueError, match=r"routes\.yaml\.fleet: 'ZZZZ' is not in generator/shared/aircraft_types\.yaml; add it there first"):
        load_routes(airport_copy(tmp_path, ksfo_dir, routes=mutate) / ROUTES_FILE, shared_route_facts)


@pytest.mark.parametrize(("key", "code"), [("destinations", "KSEA"), ("airlines", "UAL"), ("fleet", "A320")])
def test_a_code_listed_twice_is_named(tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts, key: str, code: str) -> None:
    def mutate(data: Any) -> None:
        data[key].append(code)

    with pytest.raises(ValueError, match=rf"routes\.yaml\.{key}: '{code}' is listed twice; an airport names each code once"):
        load_routes(airport_copy(tmp_path, ksfo_dir, routes=mutate) / ROUTES_FILE, shared_route_facts)


def test_rule_sid_family_without_an_override_is_named(tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts) -> None:
    def mutate(data: Any) -> None:
        data["assignment_rules"][0]["sid_family"] = "NITE"

    with pytest.raises(
        ValueError, match=r"assignment_rules\[SFOW-NOISE-N-NIITE\].sid_family: DP family 'NITE' has no procedure in ksfo/overrides.yaml"
    ):
        load_airport(airport_copy(tmp_path, ksfo_dir, sop=mutate), shared_route_facts)


def test_altitude_rule_sid_family_without_an_override_is_named(tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts) -> None:
    def mutate(data: Any) -> None:
        data["altitude_rules"][0]["sid_families"] = ["GAPP", "OFFSH"]

    with pytest.raises(ValueError, match=r"altitude_rules\[SFOW-28-3000\].sid_families: DP family 'OFFSH' has no procedure"):
        load_airport(airport_copy(tmp_path, ksfo_dir, sop=mutate), shared_route_facts)


def test_notice_sid_family_without_an_override_is_named(tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts) -> None:
    def mutate(data: Any) -> None:
        data["notices"][0]["effect"]["sid_family"] = "COAST"

    with pytest.raises(ValueError, match=r"notices\[SFO-SEGUL-OFF\].effect.sid_family: DP family 'COAST' has no procedure"):
        load_airport(airport_copy(tmp_path, ksfo_dir, sop=mutate), shared_route_facts)


def test_route_exit_fix_outside_every_gate_is_named(tmp_path: Path, ksfo_dir: Path, shared_route_facts: SharedRouteFacts) -> None:
    def mutate(data: Any) -> None:
        data["routes"][0]["exit_fix"] = "DEDHX"

    with pytest.raises(ValueError, match=r"routes\[DEDHX -> KSEA\]: exit_fix 'DEDHX' is in no gate of ksfo/sop.yaml"):
        load_airport(airport_copy(tmp_path, ksfo_dir, routes=mutate), shared_route_facts)


def test_unquoted_runway_family_key_is_reported(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["direction_runway_preference"]["SFOE"]["north"] = {10: "10L", "19": "19L"}

    with pytest.raises(ValueError, match="key 10 is a int, not a string; quote it"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_an_airport_without_aircraft_groups_loads_an_empty_table(ksfo_inputs: AirportInputs) -> None:
    assert ksfo_inputs.sop.aircraft_groups == {}
    assert all(rule.groups is None and rule.approach_categories is None for rule in ksfo_inputs.sop.assignment_rules)
    assert all(rule.groups is None for rule in ksfo_inputs.sop.altitude_rules)
    assert all(entry.approach_category is None for entry in ksfo_inputs.routes.fleet)


def test_aircraft_groups_round_trip_onto_the_rows_that_name_them(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["aircraft_groups"] = {"jets_and_dh8d": {"classes": ["J"], "types": ["DH8D"]}}
        data["assignment_rules"][0]["groups"] = ["jets_and_dh8d"]
        data["assignment_rules"][0]["approach_categories"] = ["A", "B"]
        data["altitude_rules"][0]["groups"] = ["jets_and_dh8d"]

    sop = load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)
    assert sop.aircraft_groups["jets_and_dh8d"].classes == ("J",)
    assert sop.aircraft_groups["jets_and_dh8d"].types == ("DH8D",)
    assert sop.assignment_rules[0].groups == ("jets_and_dh8d",)
    assert sop.assignment_rules[0].approach_categories == ("A", "B")
    assert sop.altitude_rules[0].groups == ("jets_and_dh8d",)


def test_a_group_addressing_nobody_is_rejected(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["aircraft_groups"] = {"nobody": {"classes": [], "types": []}}

    with pytest.raises(ValueError, match=r"aircraft_groups\[nobody\]: an aircraft group addresses nobody"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_a_group_naming_an_unknown_class_is_rejected(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["aircraft_groups"] = {"heavies": {"classes": ["H"], "types": []}}

    with pytest.raises(ValueError, match=r"aircraft_groups\[heavies\].classes\[0\]: 'H' is not one of"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


@pytest.mark.parametrize("key", ["assignment_rules", "altitude_rules"])
def test_a_rule_naming_an_undefined_group_is_rejected(tmp_path: Path, ksfo_dir: Path, key: str) -> None:
    def mutate(data: Any) -> None:
        data[key][0]["groups"] = ["jets_and_dh8d"]

    with pytest.raises(ValueError, match=r"groups names 'jets_and_dh8d', which is not an `aircraft_groups` id"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


@pytest.mark.parametrize("key", ["assignment_rules", "altitude_rules"])
def test_a_rule_addressing_nobody_is_rejected(tmp_path: Path, ksfo_dir: Path, key: str) -> None:
    def mutate(data: Any) -> None:
        data[key][0]["classes"] = []

    with pytest.raises(ValueError, match=r"the row addresses nobody"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_a_rule_naming_an_unknown_approach_category_is_rejected(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["assignment_rules"][0]["approach_categories"] = ["E"]

    with pytest.raises(ValueError, match=r"approach_categories\[0\]: 'E' is not one of"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)


def test_a_shared_approach_category_override_reaches_the_fleet(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["types"]["A320"]["approach_category"] = "C"
        data["types"]["A320"]["note"] = "flown at category C speeds here"

    routes = load_routes(ksfo_dir / ROUTES_FILE, shared_copy(tmp_path, aircraft_types=mutate))
    fleet = {entry.type: entry for entry in routes.fleet}
    assert fleet["A320"].approach_category == "C"
    assert fleet["A319"].approach_category is None


def test_a_climb_via_eligible_override_round_trips(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["sids"]["GAP SEVEN"]["climb_via_eligible"] = True

    overrides = load_overrides(airport_copy(tmp_path, ksfo_dir, overrides=mutate) / OVERRIDES_FILE)
    assert overrides.sids["GAP SEVEN"].climb_via_eligible is True
    assert overrides.sids["TRUKN TWO (RNAV)"].climb_via_eligible is None


def test_an_expect_filed_altitude_minutes_override_round_trips(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["sids"]["GAP SEVEN"]["expect_filed_altitude_minutes"] = HAND_EXPECT_MINUTES

    overrides = load_overrides(airport_copy(tmp_path, ksfo_dir, overrides=mutate) / OVERRIDES_FILE)
    assert overrides.sids["GAP SEVEN"].expect_filed_altitude_minutes == HAND_EXPECT_MINUTES
    assert overrides.sids["SAN FRANCISCO FIVE"].expect_filed_altitude_minutes is None
    assert overrides.sids["TRUKN TWO (RNAV)"].expect_filed_altitude_minutes is None


def test_a_non_positive_expect_filed_altitude_minutes_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["sids"]["GAP SEVEN"]["expect_filed_altitude_minutes"] = 0

    with pytest.raises(ValueError, match=r"sids\[GAP SEVEN\]: expect_filed_altitude_minutes must be a positive whole number, got 0"):
        load_overrides(airport_copy(tmp_path, ksfo_dir, overrides=mutate) / OVERRIDES_FILE)
