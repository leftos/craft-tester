import argparse

import pytest

from craft_generator.cli import build_parser, faa_code, main, normalize_icao


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


def test_normalize_icao_rejects_short_identifier() -> None:
    with pytest.raises(argparse.ArgumentTypeError):
        normalize_icao("SFO")


def test_faa_code() -> None:
    assert faa_code("KSFO") == "SFO"
    assert faa_code("PHNL") == "PHNL"
