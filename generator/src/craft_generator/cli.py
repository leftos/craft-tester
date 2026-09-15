"""Command line entry point for ``craft-gen``."""

import argparse
import io
import sys
import zipfile
from collections.abc import Callable, Sequence
from datetime import date

from craft_generator.charts_api import cycle_id_from_url, fetch_chart_pdf, fetch_departure_charts, pdf_cache_path
from craft_generator.cifp.cycle import CIFP_MEMBER, cifp_url, cycle_id_for, effective_date_for, effective_date_for_cycle
from craft_generator.http import cache_dir, fetch_bytes, sha256_hex

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_NOT_IMPLEMENTED = 2

_SUBCOMMANDS: dict[str, str] = {
    "build": "build data/<icao>.json from CIFP, charts and the airport YAML",
    "verify-sop": "download the SOP PDF and check its sha256 and sentinel strings",
    "import-worksheets": "fetch the trainer worksheets and write pending fixtures",
    "fetch-cifp": "download and unpack the FAA CIFP for an AIRAC cycle",
    "fetch-charts": "download the departure-procedure chart PDFs for an airport",
}


def normalize_icao(value: str) -> str:
    """Return ``value`` as a four-letter upper-case ICAO identifier.

    Args:
        value: Airport identifier as typed on the command line.

    Returns:
        The upper-cased identifier.

    Raises:
        argparse.ArgumentTypeError: The identifier is not four letters.
    """
    icao = value.strip().upper()
    if len(icao) != 4 or not icao.isalpha():
        raise argparse.ArgumentTypeError(f"--airport takes a four-letter ICAO identifier such as KSFO, got {value!r}")
    return icao


def faa_code(icao: str) -> str:
    """Return the FAA identifier for an ICAO identifier.

    Contiguous-US identifiers are the FAA code with a ``K`` prefix (``KSFO`` -> ``SFO``); anything
    else is returned unchanged.

    Args:
        icao: Four-letter ICAO identifier.

    Returns:
        The identifier the FAA and the ZOA charts API use.
    """
    if len(icao) == 4 and icao.startswith("K"):
        return icao[1:]
    return icao


def build_parser() -> argparse.ArgumentParser:
    """Return the ``craft-gen`` argument parser with every subcommand attached."""
    parser = argparse.ArgumentParser(prog="craft-gen", description="Generate CRAFT clearance trainer data from public FAA and ZOA sources.")
    subparsers = parser.add_subparsers(dest="command", required=True, metavar="COMMAND")
    for name, help_text in _SUBCOMMANDS.items():
        sub = subparsers.add_parser(name, help=help_text, description=help_text)
        sub.add_argument("--airport", required=True, type=normalize_icao, metavar="ICAO", help="airport ICAO identifier, e.g. KSFO")
        sub.add_argument("--force", action="store_true", help="re-download even when the cache already holds the file")
        if name in {"build", "fetch-cifp"}:
            sub.add_argument("--cycle", metavar="YYNN", help="AIRAC cycle id, e.g. 2609; defaults to the cycle effective today")
        if name == "build":
            sub.add_argument("--offline", action="store_true", help="use only the download cache, never the network")
            sub.add_argument("--check", action="store_true", help="fail instead of writing when the output differs from the committed file")
    return parser


def _not_implemented(command: str) -> int:
    print(f"craft-gen {command}: not implemented yet")
    return EXIT_NOT_IMPLEMENTED


def fetch_cifp(airport: str, cycle: str | None, *, force: bool = False) -> int:
    """Download the CIFP zip for one AIRAC cycle and unpack the navigation database from it.

    Args:
        airport: Airport the data is wanted for; reported so the output names its subject.
        cycle: AIRAC cycle id such as ``2609``, or ``None`` for the cycle effective today.
        force: Re-download and re-extract even when the cache already holds the files.

    Returns:
        The process exit status.
    """
    effective = effective_date_for_cycle(cycle) if cycle else effective_date_for(date.today())
    cycle_id = cycle_id_for(effective)
    cache = cache_dir()
    url = cifp_url(effective)
    archive = fetch_bytes(url, cache / "cifp" / f"CIFP_{effective:%y%m%d}.zip", force=force)
    member = cache / "cifp" / cycle_id / CIFP_MEMBER
    if force or not member.exists():
        member.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(archive)) as zip_file:
            member.write_bytes(zip_file.read(CIFP_MEMBER))
    print(f"{airport}: AIRAC {cycle_id} effective {effective.isoformat()}")
    print(f"  {url} ({len(archive)} bytes, sha256 {sha256_hex(archive)})")
    print(f"  {member} ({member.stat().st_size} bytes)")
    return EXIT_OK


def fetch_charts(airport: str, *, force: bool = False) -> int:
    """Download every departure-procedure chart PDF an airport publishes.

    Args:
        airport: Four-letter ICAO identifier, e.g. ``KSFO``.
        force: Re-download even when the cache already holds the files.

    Returns:
        The process exit status.
    """
    cache = cache_dir()
    charts = fetch_departure_charts(faa_code(airport), cache, force=force)
    print(f"{airport}: {len(charts)} departure procedures")
    for chart in charts:
        cycle_id = cycle_id_from_url(chart.pdf_url)
        pdf = fetch_chart_pdf(chart, cache, cycle_id, force=force)
        print(f"  {chart.chart_name} -> {pdf_cache_path(cache, cycle_id, chart)} ({len(pdf)} bytes)")
    return EXIT_OK


def _run(args: argparse.Namespace) -> int:
    handlers: dict[str, Callable[[], int]] = {
        "fetch-cifp": lambda: fetch_cifp(args.airport, args.cycle, force=args.force),
        "fetch-charts": lambda: fetch_charts(args.airport, force=args.force),
    }
    handler = handlers.get(args.command)
    return handler() if handler is not None else _not_implemented(str(args.command))


def main(argv: Sequence[str] | None = None) -> int:
    """Run ``craft-gen``.

    Args:
        argv: Command line arguments without the program name; ``sys.argv[1:]`` when omitted.

    Returns:
        The process exit status.
    """
    args = build_parser().parse_args(argv)
    try:
        return _run(args)
    except (RuntimeError, ValueError, OSError, zipfile.BadZipFile) as exc:
        print(f"craft-gen {args.command}: {exc}", file=sys.stderr)
        return EXIT_ERROR
