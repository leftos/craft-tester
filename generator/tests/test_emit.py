import json
from copy import deepcopy
from pathlib import Path

import pytest

from craft_generator.emit import data_path, dump, schema_path, validate, write_or_check
from craft_generator.merge import Document

EXPECTED_ERROR_COUNT = 2


def test_dump_is_byte_stable(ksfo_document: Document) -> None:
    first, second = dump(ksfo_document), dump(ksfo_document)
    assert first == second
    assert first.endswith("}\n")
    assert json.loads(first) == dict(ksfo_document)


def test_dump_sorts_the_top_level_keys(ksfo_document: Document) -> None:
    lines = dump(ksfo_document).splitlines()
    assert lines[0] == "{"
    assert lines[1].startswith('  "aircraftClasses"')


def test_writing_twice_reports_unchanged(tmp_path: Path, ksfo_document: Document) -> None:
    path = tmp_path / "ksfo.json"
    text = dump(ksfo_document)
    assert write_or_check(path, text, check=False).status == "written"
    assert write_or_check(path, text, check=False).status == "unchanged"
    assert write_or_check(path, text, check=True).status == "unchanged"


def test_check_reports_a_difference_and_leaves_the_file_alone(tmp_path: Path) -> None:
    path = tmp_path / "ksfo.json"
    path.write_text('{\n  "a": 1\n}\n', encoding="utf-8", newline="\n")
    result = write_or_check(path, '{\n  "a": 2\n}\n', check=True)
    assert result.status == "differs"
    assert '-  "a": 1\n' in result.diff
    assert '+  "a": 2\n' in result.diff
    assert path.read_text(encoding="utf-8", newline="") == '{\n  "a": 1\n}\n'


def test_check_reports_a_missing_file_as_differing(tmp_path: Path) -> None:
    result = write_or_check(tmp_path / "absent.json", "{}\n", check=True)
    assert result.status == "differs"
    assert not (tmp_path / "absent.json").exists()


def test_files_are_written_with_line_feed_endings(tmp_path: Path, ksfo_document: Document) -> None:
    path = tmp_path / "ksfo.json"
    write_or_check(path, dump(ksfo_document), check=False)
    assert b"\r\n" not in path.read_bytes()


def test_validation_names_the_json_path_of_a_bad_value(ksfo_document: Document) -> None:
    broken = deepcopy(dict(ksfo_document))
    broken["sids"][0]["kind"] = "banana"
    with pytest.raises(ValueError, match=r"\$\.sids\[0\]\.kind"):
        validate(broken, schema_path())


def test_validation_reports_every_error_at_once(ksfo_document: Document) -> None:
    broken = deepcopy(dict(ksfo_document))
    broken["airport"]["icao"] = 5
    broken["sids"][0]["kind"] = "banana"
    with pytest.raises(ValueError, match=rf"{EXPECTED_ERROR_COUNT} error\(s\)"):
        validate(broken, schema_path())


def test_the_committed_document_validates() -> None:
    committed = json.loads(data_path("KSFO").read_text(encoding="utf-8"))
    validate(committed, schema_path())
