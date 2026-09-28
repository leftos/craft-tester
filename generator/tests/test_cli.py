import argparse
from pathlib import Path

import pytest

from craft_generator import cli
from craft_generator.cli import _print_sheet_summary, build_parser, faa_code, main, normalize_icao
from craft_generator.worksheets import SkippedPlan


def test_help_exits_zero() -> None:
    with pytest.raises(SystemExit) as excinfo:
        main(["--help"])
    assert excinfo.value.code == 0


def test_subcommand_help_exits_zero() -> None:
    for command in ("build", "verify-sop", "import-worksheets", "fetch-cifp", "fetch-charts"):
        with pytest.raises(SystemExit) as excinfo:
            main([command, "--help"])
        assert excinfo.value.code == 0


def test_missing_command_exits_two() -> None:
    with pytest.raises(SystemExit) as excinfo:
        main([])
    assert excinfo.value.code == 2


def test_import_worksheets_accepts_the_check_flag() -> None:
    args = build_parser().parse_args(["import-worksheets", "--airport", "ksfo", "--check"])
    assert (args.airport, args.check, args.force) == ("KSFO", True, False)


def test_verify_sop_accepts_the_drift_flag() -> None:
    args = build_parser().parse_args(["verify-sop", "--airport", "ksfo", "--allow-sop-drift"])
    assert (args.airport, args.allow_sop_drift) == ("KSFO", True)


def test_build_accepts_its_own_flags() -> None:
    args = build_parser().parse_args(["build", "--airport", "ksfo", "--cycle", "2609", "--offline", "--check"])
    assert (args.airport, args.cycle, args.offline, args.check) == ("KSFO", "2609", True, True)


def test_build_accepts_coverage() -> None:
    assert build_parser().parse_args(["build", "--airport", "ksfo", "--coverage"]).coverage is True
    assert build_parser().parse_args(["build", "--airport", "ksfo"]).coverage is False


class _ReachedTheJoinError(Exception):
    """Raised by the stubbed SID grouping, the first step of ``build`` after the pin check."""


@pytest.fixture
def build_without_sources(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Stub every download ``build`` makes before the pin check, and stop it at the step right after the check."""

    def refuse_verification(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("the pinned documents were verified")

    def stop(*_args: object, **_kwargs: object) -> None:
        raise _ReachedTheJoinError

    monkeypatch.setenv("CRAFT_GEN_CACHE", str(tmp_path))
    monkeypatch.setattr(cli, "_chart_inputs", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(cli, "_cifp_member", lambda *_args, **_kwargs: b"")
    monkeypatch.setattr(cli, "verify_sop_source", refuse_verification)
    monkeypatch.setattr(cli, "group_sids", stop)


@pytest.mark.usefixtures("build_without_sources")
def test_build_verifies_the_pins_without_skip_sop_verify() -> None:
    with pytest.raises(AssertionError, match="verified"):
        main(["build", "--airport", "KSFO", "--cycle", "2609"])


@pytest.mark.usefixtures("build_without_sources")
def test_skip_sop_verify_builds_without_checking_the_pins(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(_ReachedTheJoinError):
        main(["build", "--airport", "KSFO", "--cycle", "2609", "--skip-sop-verify"])
    assert capsys.readouterr().err.splitlines() == ["warning: --skip-sop-verify: the SOP and CPS-004 pins were not checked"]


@pytest.mark.usefixtures("build_without_sources")
def test_skip_sop_verify_contradicts_allow_sop_drift(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["build", "--airport", "KSFO", "--skip-sop-verify", "--allow-sop-drift"]) == 1
    assert capsys.readouterr().err.startswith("craft-gen build: --skip-sop-verify and --allow-sop-drift contradict each other")


def test_a_skipped_plan_is_named_under_its_sheet(capsys: pytest.CaptureFixture[str]) -> None:
    _print_sheet_summary("Amendment Practice 1A", [], (SkippedPlan(callsign="AAY218", destination="KPGI"),))
    lines = capsys.readouterr().out.splitlines()
    assert lines[1] == "  skipped AAY218: destination KPGI is not in generator/shared/destinations.yaml"


def test_normalize_icao_rejects_short_identifier() -> None:
    with pytest.raises(argparse.ArgumentTypeError):
        normalize_icao("SFO")


def test_faa_code() -> None:
    assert faa_code("KSFO") == "SFO"
    assert faa_code("PHNL") == "PHNL"
