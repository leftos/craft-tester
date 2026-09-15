from datetime import date, timedelta

import pytest
from hypothesis import given
from hypothesis import strategies as st

from craft_generator.cifp.cycle import (
    AIRAC_EPOCH,
    CYCLE_DAYS,
    cifp_url,
    cycle_id_for,
    effective_date_for,
    effective_date_for_cycle,
    first_effective_date_of_year,
    is_effective_date,
)


def test_epoch_is_cycle_2501() -> None:
    assert cycle_id_for(AIRAC_EPOCH) == "2501"


@pytest.mark.parametrize(
    ("effective", "cycle_id"),
    [
        (date(2026, 1, 22), "2601"),
        (date(2026, 8, 6), "2608"),
        (date(2026, 9, 3), "2609"),
        (date(2026, 10, 1), "2610"),
        (date(2026, 12, 24), "2613"),
    ],
)
def test_cycle_ids(effective: date, cycle_id: str) -> None:
    assert is_effective_date(effective)
    assert cycle_id_for(effective) == cycle_id
    assert effective_date_for_cycle(cycle_id) == effective


def test_effective_date_for_holds_until_the_next_cycle() -> None:
    assert effective_date_for(date(2026, 9, 3)) == date(2026, 9, 3)
    assert effective_date_for(date(2026, 9, 15)) == date(2026, 9, 3)
    assert effective_date_for(date(2026, 9, 30)) == date(2026, 9, 3)
    assert effective_date_for(date(2026, 10, 1)) == date(2026, 10, 1)


def test_first_effective_date_of_year() -> None:
    assert first_effective_date_of_year(2025) == AIRAC_EPOCH
    assert first_effective_date_of_year(2026) == date(2026, 1, 22)


def test_cifp_url_uses_the_effective_date_stamp() -> None:
    assert cifp_url(date(2026, 9, 3)) == "https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_260903.zip"
    assert cifp_url(date(2026, 8, 6)) == "https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_260806.zip"


def test_before_the_epoch_is_rejected() -> None:
    with pytest.raises(ValueError, match="before the AIRAC epoch"):
        effective_date_for(date(2025, 1, 22))


def test_mid_cycle_date_is_not_an_effective_date() -> None:
    assert not is_effective_date(date(2026, 9, 4))
    with pytest.raises(ValueError, match="not an AIRAC effective date"):
        cycle_id_for(date(2026, 9, 4))
    with pytest.raises(ValueError, match="not an AIRAC effective date"):
        cifp_url(date(2026, 9, 4))


@pytest.mark.parametrize("cycle_id", ["26", "260a", "2600", "2614"])
def test_bad_cycle_ids_are_rejected(cycle_id: str) -> None:
    with pytest.raises(ValueError):
        effective_date_for_cycle(cycle_id)


@given(st.dates(min_value=AIRAC_EPOCH, max_value=date(2099, 12, 31)))
def test_effective_date_brackets_any_date(day: date) -> None:
    effective = effective_date_for(day)
    assert effective <= day < effective + timedelta(days=CYCLE_DAYS)
    assert is_effective_date(effective)


@given(st.dates(min_value=AIRAC_EPOCH, max_value=date(2099, 12, 31)))
def test_cycle_id_round_trips(day: date) -> None:
    effective = effective_date_for(day)
    assert effective_date_for_cycle(cycle_id_for(effective)) == effective
