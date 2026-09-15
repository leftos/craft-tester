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
from craft_generator.sop.load import SOP_FILE, airport_dir, load_sop
from craft_generator.sop.verify import verify_sop_source

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
        if name == "verify-sop":
            sub.add_argument("--allow-sop-drift", action="store_true", help="report a changed sha256 as a warning while every sentinel still matches")
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


def verify_sop(airport: str, *, allow_drift: bool = False, force: bool = False) -> int:
    """Check the SOP PDF an airport's transcription is pinned to, printing one verdict per check.

    Args:
        airport: Four-letter ICAO identifier, e.g. ``KSFO``.
        allow_drift: Report a changed sha256 as a warning instead of a failure, as long as every
            sentinel is still present.
        force: Re-download even when the cache already holds the PDF.

    Returns:
        The process exit status: non-zero when the document changed or a sentinel went missing.
    """
    source = load_sop(airport_dir(airport) / SOP_FILE).source
    result = verify_sop_source(source, cache_dir(), force=force)
    print(f"{airport}: {source.title} version {source.version}, transcribed {source.transcribed_at.isoformat()}")
    print(f"  {source.url}")
    failed = False
    actual, expected = result.actual_sha256, result.expected_sha256
    if result.hash_matches:
        print(f"  ok    sha256 {actual}")
    elif allow_drift and not result.missing_sentinels:
        print(f"  warn  sha256 is {actual}, sop.yaml pins {expected}; allowed by --allow-sop-drift, every sentinel still matches")
    else:
        print(f"  FAIL  sha256 is {actual}, sop.yaml pins {expected}; re-read the SOP, then update sha256 and transcribed_at")
        failed = True
    for sentinel in source.sentinels:
        if sentinel in result.missing_sentinels:
            print(f'  FAIL  sentinel is gone: "{sentinel}"; re-transcribe the section it came from, then update the sentinel')
            failed = True
        else:
            print(f'  ok    sentinel "{sentinel}"')
    return EXIT_ERROR if failed else EXIT_OK


def _run(args: argparse.Namespace) -> int:
    handlers: dict[str, Callable[[], int]] = {
        "fetch-cifp": lambda: fetch_cifp(args.airport, args.cycle, force=args.force),
        "fetch-charts": lambda: fetch_charts(args.airport, force=args.force),
        "verify-sop": lambda: verify_sop(args.airport, allow_drift=args.allow_sop_drift, force=args.force),
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
