import pytest

from craft_generator.cifp.records import SidRecord
from craft_generator.cifp.sid import (
    INITIAL_CLIMB_TERMINATORS,
    CifpSid,
    Restriction,
    expand_runway_transition,
    group_sids,
    parse_altitude,
    restriction_for,
    split_sid_id,
)

KSFO_RUNWAYS = ("01L", "01R", "10L", "10R", "19L", "19R", "28L", "28R")
EXPECTED_SIDS = {"CIITY3", "GAPP7", "GNNRR3", "MOLEN9", "NIITE4", "SAHEY4", "SEGUL1", "SNTNA2", "SSTIK5", "TRUKN2", "WESLA5"}


def leg(**overrides: object) -> SidRecord:
    fields: dict[str, object] = {
        "sid_id": "TRUKN2",
        "route_type": "6",
        "transition": "DEDHD",
        "sequence": 10,
        "fix": "TYDYE",
        "path_terminator": "TF",
        "altitude_desc": " ",
        "altitude1": "",
        "altitude2": "",
        "raw": "",
    }
    fields.update(overrides)
    return SidRecord(**fields)


def transition_names(sid: CifpSid, kind: str) -> set[str]:
    return {transition.name for transition in sid.transitions if transition.kind == kind}


@pytest.mark.parametrize(("raw", "feet"), [("", None), ("   ", None), ("05000", 5000), ("00520", 520), ("FL220", 22000), ("FL410", 41000)])
def test_parse_altitude(raw: str, feet: int | None) -> None:
    assert parse_altitude(raw) == feet


def test_parse_altitude_rejects_unknown_encoding() -> None:
    with pytest.raises(ValueError, match="unsupported CIFP altitude field"):
        parse_altitude("MSL")


def test_split_sid_id() -> None:
    assert split_sid_id("TRUKN2") == ("TRUKN", 2)
    assert split_sid_id("GAPP7") == ("GAPP", 7)
    assert split_sid_id("MOLEN9") == ("MOLEN", 9)
    with pytest.raises(ValueError, match="not letters followed by a version number"):
        split_sid_id("TRUKN")


def test_expand_runway_transition() -> None:
    assert expand_runway_transition("RW28B", KSFO_RUNWAYS) == ("28L", "28R")
    assert expand_runway_transition("RW10L", KSFO_RUNWAYS) == ("10L",)
    with pytest.raises(ValueError, match="matches none of the airport runways"):
        expand_runway_transition("RW33B", KSFO_RUNWAYS)
    with pytest.raises(ValueError, match="does not start with RW"):
        expand_runway_transition("ALCOA", KSFO_RUNWAYS)


@pytest.mark.parametrize("terminator", sorted(INITIAL_CLIMB_TERMINATORS))
def test_initial_climb_legs_are_not_crossing_restrictions(terminator: str) -> None:
    assert restriction_for(leg(path_terminator=terminator, altitude_desc="+", altitude1="00520", fix="")) is None


def test_restriction_constraints() -> None:
    assert restriction_for(leg(altitude_desc="+", altitude1="02500")) == Restriction("TYDYE", "at_or_above", 2500, None)
    assert restriction_for(leg(altitude_desc="-", altitude1="10000")) == Restriction("TYDYE", "at_or_below", None, 10000)
    assert restriction_for(leg(altitude_desc="B", altitude1="10000", altitude2="08000")) == Restriction("TYDYE", "between", 8000, 10000)
    assert restriction_for(leg(altitude_desc="@", altitude1="03000")) == Restriction("TYDYE", "at", 3000, 3000)
    assert restriction_for(leg(altitude_desc=" ", altitude1="")) is None


def test_every_published_ksfo_sid_is_grouped(ksfo_sids: dict[str, CifpSid]) -> None:
    assert set(ksfo_sids) == EXPECTED_SIDS
    assert "SFO5" not in ksfo_sids
    assert all(sid.common_fixes == () for sid in ksfo_sids.values())


def test_trukn2(ksfo_sids: dict[str, CifpSid]) -> None:
    sid = ksfo_sids["TRUKN2"]
    assert (sid.family, sid.version, sid.kind) == ("TRUKN", 2, "rnav_pilot_nav")
    assert set(sid.runways) == {"01L", "01R", "28L", "28R"}
    assert transition_names(sid, "enroute") == {"DEDHD", "GRTFL", "MOGEE", "ORRCA", "SYRAH", "TIPRE"}
    assert transition_names(sid, "vector") == set()
    assert sid.has_crossing_restrictions


def test_gapp7_is_a_vector_hybrid(ksfo_sids: dict[str, CifpSid]) -> None:
    sid = ksfo_sids["GAPP7"]
    assert sid.kind == "vector_hybrid"
    assert transition_names(sid, "vector") == {"ALCOA", "BEBOP", "ENI", "OAK", "OSI", "SAU", "SGD"}
    assert transition_names(sid, "enroute") == set()
    assert set(sid.runways) == set(KSFO_RUNWAYS)
    assert sid.restrictions == ()
    assert not sid.has_crossing_restrictions


def test_molen9_is_conventional_with_crossing_restrictions(ksfo_sids: dict[str, CifpSid]) -> None:
    sid = ksfo_sids["MOLEN9"]
    assert sid.kind == "conventional_pilot_nav"
    assert transition_names(sid, "enroute") == {"ENI"}
    assert Restriction("SIPLY", "at_or_above", 2500, None) in sid.restrictions
    assert Restriction("WESLA", "at_or_above", 1800, None) in sid.restrictions
    assert sid.has_crossing_restrictions


def test_sstik5_publishes_an_at_or_below(ksfo_sids: dict[str, CifpSid]) -> None:
    sid = ksfo_sids["SSTIK5"]
    assert Restriction("PORTE", "at_or_below", None, 10000) in sid.restrictions
    assert set(sid.runways) == {"01L", "01R"}


def test_segul1_carries_its_transition_restriction(ksfo_sids: dict[str, CifpSid]) -> None:
    sid = ksfo_sids["SEGUL1"]
    yyung = next(transition for transition in sid.transitions if transition.name == "YYUNG")
    assert yyung.kind == "enroute"
    assert "CYPRS" in yyung.fixes
    assert Restriction("CYPRS", "at_or_above", 22000, None) in sid.restrictions


def test_initial_climb_altitudes_are_absent_from_every_sid(ksfo_sids: dict[str, CifpSid]) -> None:
    initial_climb_feet = {413, 513, 520}
    for sid in ksfo_sids.values():
        assert all(restriction.fix for restriction in sid.restrictions)
        assert not initial_climb_feet & {restriction.feet_low for restriction in sid.restrictions if restriction.feet_low is not None}


def test_grouping_is_ordered_and_keyed_by_id(ksfo_sids: dict[str, CifpSid]) -> None:
    assert list(ksfo_sids) == sorted(EXPECTED_SIDS)
    assert all(sid_id == sid.id for sid_id, sid in ksfo_sids.items())


def test_group_sids_of_nothing_is_empty() -> None:
    assert group_sids([], KSFO_RUNWAYS) == {}
