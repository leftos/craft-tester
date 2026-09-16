from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

import pytest
import yaml

from craft_generator.sop.load import (
    OVERRIDES_FILE,
    PHRASEOLOGY_RULES_FILE,
    ROUTE_CONNECTIONS_FILE,
    ROUTES_FILE,
    SOP_FILE,
    load_airport,
    load_overrides,
    load_phraseology_rules,
    load_route_connections,
    load_routes,
    load_sop,
    shared_dir,
    sid_family_of,
)
from craft_generator.sop.model import AirportInputs

Mutation = Callable[[Any], None]

SHARED_PHRASEOLOGY_IDS = [
    "R-TRANSITION",
    "R-AS-FILED",
    "R-RV-SID",
    "R-THEN-AS-FILED",
    "R-ROUTE-BUILD",
    "R-RV-AIRWAY",
    "R-AIRWAY",
    "R-NAVAID",
    "A-CLIMB-VIA",
    "A-CLIMB-VIA-EXCEPT",
    "A-MAINTAIN",
    "A-EXPECT",
    "A-EXPECT-AMENDED",
    "A-EXPECT-REDUNDANT",
    "A-FINAL",
    "C-DEST",
    "A-PARITY",
    "A-RVSM",
]
KSFO_PHRASEOLOGY_IDS = {"RWY-CLASS-DEFAULT", "RWY-ON-REQUEST", "RWY-DIRECTION", "RWY-FIRST", "A-CLIMB-VIA", "A-EXPECT"}
ROUTE_CONNECTION_COUNT = 26
ROUTE_CONNECTION_SOURCE = "OAK Route Building Cheat Sheet (vZOA S1-OAK-5), Common Fixes, routes dated 2025-01-20; retrieved 2026-09-16"


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
    assert destinations["KSEA"].nct is False
    assert destinations["KSMF"].nct is True
    assert (destinations["RKSI"].lat, destinations["RKSI"].lon) == (37.469, 126.451)
    assert destinations["KSEA"].lat is None
    fleet = {entry.type: entry for entry in routes.fleet}
    assert (fleet["A20N"].aircraft_class, fleet["A20N"].wtc, fleet["A20N"].suffixes) == ("J", "M", ("/L",))
    assert fleet["B350"].aircraft_class == "T"
    assert fleet["C55B"].airlines == ()
    first = routes.routes[0]
    assert (first.exit_fix, first.destination, first.classes, first.altitudes) == ("DEDHD", "KSEA", ("J",), (32000, 34000, 36000))


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


def test_unknown_route_destination_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["routes"][0]["destination"] = "KZZZ"

    with pytest.raises(ValueError, match=r"routes\[DEDHD -> KZZZ\]: destination 'KZZZ' is not in `destinations`"):
        load_routes(airport_copy(tmp_path, ksfo_dir, routes=mutate) / ROUTES_FILE)


def test_unknown_aircraft_class_in_a_route_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["routes"][0]["classes"] = ["J", "X"]

    with pytest.raises(ValueError, match=r"routes\[0\].classes\[1\]: 'X' is not one of \['P', 'T', 'J'\]"):
        load_routes(airport_copy(tmp_path, ksfo_dir, routes=mutate) / ROUTES_FILE)


def test_malformed_equipment_suffix_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["fleet"][0]["suffixes"] = ["/L", "LL"]

    with pytest.raises(ValueError, match="suffix 'LL' is not a slash and one upper-case letter"):
        load_routes(airport_copy(tmp_path, ksfo_dir, routes=mutate) / ROUTES_FILE)


def test_rule_sid_family_without_an_override_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["assignment_rules"][0]["sid_family"] = "NITE"

    with pytest.raises(
        ValueError, match=r"assignment_rules\[SFOW-NOISE-N-NIITE\].sid_family: DP family 'NITE' has no procedure in ksfo/overrides.yaml"
    ):
        load_airport(airport_copy(tmp_path, ksfo_dir, sop=mutate))


def test_altitude_rule_sid_family_without_an_override_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["altitude_rules"][0]["sid_families"] = ["GAPP", "OFFSH"]

    with pytest.raises(ValueError, match=r"altitude_rules\[SFOW-28-3000\].sid_families: DP family 'OFFSH' has no procedure"):
        load_airport(airport_copy(tmp_path, ksfo_dir, sop=mutate))


def test_notice_sid_family_without_an_override_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["notices"][0]["effect"]["sid_family"] = "COAST"

    with pytest.raises(ValueError, match=r"notices\[SFO-SEGUL-OFF\].effect.sid_family: DP family 'COAST' has no procedure"):
        load_airport(airport_copy(tmp_path, ksfo_dir, sop=mutate))


def test_route_exit_fix_outside_every_gate_is_named(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["routes"][0]["exit_fix"] = "DEDHX"

    with pytest.raises(ValueError, match=r"routes\[DEDHX -> KSEA\]: exit_fix 'DEDHX' is in no gate of ksfo/sop.yaml"):
        load_airport(airport_copy(tmp_path, ksfo_dir, routes=mutate))


def test_unquoted_runway_family_key_is_reported(tmp_path: Path, ksfo_dir: Path) -> None:
    def mutate(data: Any) -> None:
        data["direction_runway_preference"]["SFOE"]["north"] = {10: "10L", "19": "19L"}

    with pytest.raises(ValueError, match="key 10 is a int, not a string; quote it"):
        load_sop(airport_copy(tmp_path, ksfo_dir, sop=mutate) / SOP_FILE)
