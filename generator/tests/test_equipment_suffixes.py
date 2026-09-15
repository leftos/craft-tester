from pathlib import Path

import pytest

from craft_generator.sop.load import EQUIPMENT_SUFFIXES_FILE, load_equipment_suffixes, shared_dir
from craft_generator.sop.model import EquipmentSuffix

TABLE_ROWS = 18
RNAV_SUFFIXES = {"/Y", "/C", "/I", "/V", "/S", "/G", "/Z", "/L"}
GNSS_SUFFIXES = {"/V", "/S", "/G", "/L"}
RVSM_SUFFIXES = {"/W", "/Z", "/L"}
MODE_C_SUFFIXES = {"/U", "/A", "/P", "/I", "/G", "/W", "/Z", "/L"}


def _by_suffix(suffixes: tuple[EquipmentSuffix, ...]) -> dict[str, EquipmentSuffix]:
    return {suffix.suffix: suffix for suffix in suffixes}


def test_the_table_carries_one_row_per_suffix(equipment_suffixes: tuple[EquipmentSuffix, ...]) -> None:
    assert len(equipment_suffixes) == TABLE_ROWS
    assert len(_by_suffix(equipment_suffixes)) == TABLE_ROWS


def test_lima_is_rvsm_with_satellite_navigation(equipment_suffixes: tuple[EquipmentSuffix, ...]) -> None:
    lima = _by_suffix(equipment_suffixes)["/L"]
    assert (lima.rnav, lima.gnss, lima.rvsm, lima.transponder_mode_c) == (True, True, True, True)


def test_alpha_is_dme_and_mode_c_only(equipment_suffixes: tuple[EquipmentSuffix, ...]) -> None:
    alpha = _by_suffix(equipment_suffixes)["/A"]
    assert (alpha.rnav, alpha.gnss, alpha.rvsm, alpha.transponder_mode_c) == (False, False, False, True)


@pytest.mark.parametrize(
    ("field", "expected"),
    [("rnav", RNAV_SUFFIXES), ("gnss", GNSS_SUFFIXES), ("rvsm", RVSM_SUFFIXES), ("transponder_mode_c", MODE_C_SUFFIXES)],
)
def test_each_capability_belongs_to_the_suffixes_of_table_5_4_1(
    field: str, expected: set[str], equipment_suffixes: tuple[EquipmentSuffix, ...]
) -> None:
    assert {suffix.suffix for suffix in equipment_suffixes if getattr(suffix, field)} == expected


def test_every_row_states_what_the_suffix_means(equipment_suffixes: tuple[EquipmentSuffix, ...]) -> None:
    assert [suffix.suffix for suffix in equipment_suffixes if not suffix.text.strip()] == []


def test_a_malformed_suffix_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / EQUIPMENT_SUFFIXES_FILE
    path.write_text("suffixes:\n  - { suffix: L, rnav: true, gnss: true, rvsm: true, transponder_mode_c: true, text: x }\n", encoding="utf-8")
    with pytest.raises(ValueError, match="is not a slash and one upper-case letter"):
        load_equipment_suffixes(path)


def test_the_shipped_table_loads_from_the_shared_directory() -> None:
    assert len(load_equipment_suffixes(shared_dir() / EQUIPMENT_SUFFIXES_FILE)) == TABLE_ROWS
