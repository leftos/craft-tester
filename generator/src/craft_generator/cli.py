"""Command line entry point for ``craft-gen``."""

import argparse
import io
import json
import sys
import zipfile
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from craft_generator.aircraft_classes import classes_for_fleet, fetch_aircraft_specs, specs_cache_path
from craft_generator.chart_text import extract_text, parse_chart_facts
from craft_generator.charts_api import (
    charts_api_url,
    charts_cache_path,
    cycle_id_from_url,
    fetch_chart_pdf,
    fetch_departure_charts,
    parse_departure_charts,
    pdf_cache_path,
)
from craft_generator.cifp.airports import parse_airport_records
from craft_generator.cifp.cycle import CIFP_MEMBER, cifp_url, cycle_id_for, effective_date_for, effective_date_for_cycle
from craft_generator.cifp.navaids import parse_navaids
from craft_generator.cifp.records import parse_records
from craft_generator.cifp.sid import group_sids
from craft_generator.cifp.stars import parse_star_ids
from craft_generator.emit import WriteResult, data_path, dump, fixture_schema_path, schema_path, validate, write_or_check
from craft_generator.http import cache_dir, fetch_bytes, sha256_hex
from craft_generator.merge import BuildInputs, ChartInput, Document, Provenance, build_airport
from craft_generator.sop.load import (
    EQUIPMENT_SUFFIXES_FILE,
    PHRASEOLOGY_RULES_FILE,
    ROUTE_CONNECTIONS_FILE,
    SOP_FILE,
    WORKSHEETS_FILE,
    airport_dir,
    load_airport,
    load_equipment_suffixes,
    load_phraseology_rules,
    load_route_connections,
    load_sop,
    load_worksheets,
    shared_dir,
)
from craft_generator.sop.model import Overrides, SopSource
from craft_generator.sop.verify import sop_cache_path, verify_sop_source
from craft_generator.worksheets import (
    Fixture,
    SettledFixture,
    designator_classes,
    designator_wtcs,
    fetch_worksheet_text,
    fixture_dir,
    settled_fixture_at,
    sheet_fixtures,
)

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_NOT_IMPLEMENTED = 2

KEPT_SETTLED = "kept (settled)"
IMPORT_STATUSES = ("unchanged", "written", KEPT_SETTLED, "differs")

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
        if name in {"build", "import-worksheets"}:
            sub.add_argument("--check", action="store_true", help="fail instead of writing when the output differs from the committed file")
        if name == "import-worksheets":
            sub.add_argument(
                "--overwrite-settled",
                action="store_true",
                help="rewrite a settled fixture whose scenario changed as a fresh pending document, throwing its validation away",
            )
        if name in {"build", "verify-sop"}:
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


def _chart_inputs(airport_faa: str, cache: Path, *, force: bool = False) -> dict[str, ChartInput]:
    """Fetch every departure chart of an airport and read the facts off its text layer.

    Args:
        airport_faa: FAA airport identifier, e.g. ``SFO``.
        cache: Download cache directory.
        force: Re-download even when the cache holds the response and the PDFs.

    Returns:
        One entry per departure procedure, keyed by chart name, in charts API order.
    """
    charts = fetch_departure_charts(airport_faa, cache, force=force)
    inputs: dict[str, ChartInput] = {}
    for chart in charts:
        pdf = fetch_chart_pdf(chart, cache, cycle_id_from_url(chart.pdf_url), force=force)
        inputs[chart.chart_name] = ChartInput(facts=parse_chart_facts(extract_text(pdf), chart.chart_name), pdf_url=chart.pdf_url)
    return inputs


def fixture_filed_routes(airport: str) -> tuple[str, ...]:
    """Return the filed route of every checked-in fixture of an airport.

    Worksheet and synthetic fixtures alike sit under ``fixtures/<icao>/``, and their routes name
    navaids the airport data itself never mentions, which the spoken clearance still has to read.

    Args:
        airport: Four-letter ICAO identifier, e.g. ``KSFO``.

    Returns:
        One filed route per fixture, in path order.
    """
    directory = fixture_dir(airport).parent
    return tuple(json.loads(path.read_text(encoding="utf-8"))["scenario"]["filedRoute"] for path in sorted(directory.rglob("*.json")))


def _cifp_member(cache: Path, effective: date, cycle_id: str, *, force: bool = False) -> bytes:
    member = cache / "cifp" / cycle_id / CIFP_MEMBER
    if member.exists() and not force:
        return member.read_bytes()
    archive = fetch_bytes(cifp_url(effective), cache / "cifp" / f"CIFP_{effective:%y%m%d}.zip", force=force)
    member.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(archive)) as zip_file:
        member.write_bytes(zip_file.read(CIFP_MEMBER))
    return member.read_bytes()


def _missing_cache_files(cache: Path, airport_faa: str, cycle_id: str, source: SopSource) -> list[Path]:
    charts_json = charts_cache_path(cache, airport_faa)
    missing = [
        path
        for path in (charts_json, cache / "cifp" / cycle_id / CIFP_MEMBER, specs_cache_path(cache), sop_cache_path(cache, source))
        if not path.exists()
    ]
    if charts_json.exists():
        for chart in parse_departure_charts(charts_json.read_bytes(), airport_faa):
            pdf = pdf_cache_path(cache, cycle_id_from_url(chart.pdf_url), chart)
            if not pdf.exists():
                missing.append(pdf)
    return sorted(missing)


def _require_cached(cache: Path, airport_faa: str, cycle_id: str, source: SopSource) -> None:
    missing = _missing_cache_files(cache, airport_faa, cycle_id, source)
    if missing:
        listed = "\n".join(f"  {path}" for path in missing)
        raise RuntimeError(
            f"--offline needs {len(missing)} file(s) the download cache does not hold:\n{listed}\n"
            "run the build once without --offline to download them"
        )


def _verify_sop_for_build(source: SopSource, cache: Path, *, force: bool = False, allow_drift: bool = False) -> None:
    result = verify_sop_source(source, cache, force=force)
    if result.missing_sentinels:
        raise ValueError(
            f"the SOP at {source.url} no longer carries {list(result.missing_sentinels)}; "
            "re-transcribe the sections they came from, then update sop.yaml"
        )
    if result.hash_matches:
        return
    if not allow_drift:
        raise ValueError(
            f"the SOP at {source.url} has sha256 {result.actual_sha256}, sop.yaml pins {result.expected_sha256}; "
            "re-read the document, then update sha256 and transcribed_at, or pass --allow-sop-drift"
        )
    print(
        f"warning: the SOP has sha256 {result.actual_sha256}, sop.yaml pins {result.expected_sha256}; every sentinel still matches", file=sys.stderr
    )


def _print_build_summary(airport: str, cycle_id: str, effective: date, document: Document, result: WriteResult) -> None:
    counts = (
        f"{len(document['sids'])} SIDs, {len(document['assignmentRules'])} assignment rules, {len(document['altitudeRules'])} altitude rules, "
        f"{len(document['notices'])} notices, {len(document['equipmentSuffixes'])} equipment suffixes, "
        f"{len(document['routeLibrary']['routes'])} routes, {len(document['fixSpoken'])} navaid names"
    )
    print(f"{airport}: AIRAC {cycle_id} effective {effective.isoformat()}, {counts}")
    print(f"  {result.path}: {result.status}")
    if result.diff:
        print(result.diff, end="")


def build(airport: str, cycle: str | None, *, offline: bool = False, check: bool = False, force: bool = False, allow_sop_drift: bool = False) -> int:
    """Join every source into ``data/<icao>.json``, validated against the schema.

    Args:
        airport: Four-letter ICAO identifier, e.g. ``KSFO``.
        cycle: AIRAC cycle id such as ``2609``, or ``None`` for the cycle effective today.
        offline: Use only files the download cache already holds.
        check: Compare against the committed file instead of writing it.
        force: Re-download every source.
        allow_sop_drift: Accept a changed SOP sha256 as long as every sentinel still matches.

    Returns:
        The process exit status: non-zero when ``check`` finds the committed file out of date.
    """
    if offline and force:
        raise ValueError("--offline and --force contradict each other: --force re-downloads every source, --offline forbids the network")
    effective = effective_date_for_cycle(cycle) if cycle else effective_date_for(date.today())
    cycle_id = cycle_id_for(effective)
    cache = cache_dir()
    airport_faa = faa_code(airport)
    inputs = load_airport(airport_dir(airport))
    if offline:
        _require_cached(cache, airport_faa, cycle_id, inputs.sop.source)
    charts = _chart_inputs(airport_faa, cache, force=force)
    member = _cifp_member(cache, effective, cycle_id, force=force)
    lines = member.decode("ascii").splitlines()
    legs, runway_records = parse_records(lines, airport)
    runways = tuple(record.designator for record in runway_records)
    _verify_sop_for_build(inputs.sop.source, cache, force=force, allow_drift=allow_sop_drift)
    document = build_airport(
        BuildInputs(
            airport=inputs,
            sids=group_sids(legs, runways),
            runways=runways,
            navaids=parse_navaids(lines),
            charts=charts,
            aircraft_classes=classes_for_fleet(fetch_aircraft_specs(cache, force=force), inputs.routes.fleet),
            airport_records=parse_airport_records(lines),
            destination_stars=parse_star_ids(lines),
            equipment_suffixes=load_equipment_suffixes(shared_dir() / EQUIPMENT_SUFFIXES_FILE),
            phraseology_rules=load_phraseology_rules(shared_dir() / PHRASEOLOGY_RULES_FILE),
            route_connections=load_route_connections(shared_dir() / ROUTE_CONNECTIONS_FILE),
            fixture_routes=fixture_filed_routes(airport),
            provenance=Provenance(
                cycle=cycle_id,
                effective=effective,
                cifp_sha256=sha256_hex(member),
                charts_api_url=charts_api_url(airport_faa),
            ),
        )
    )
    validate(document, schema_path())
    result = write_or_check(data_path(airport), dump(document), check=check)
    _print_build_summary(airport, cycle_id, effective, document, result)
    return EXIT_ERROR if result.status == "differs" else EXIT_OK


def published_sid_runways(airport: str, overrides: Overrides) -> dict[str, tuple[str, ...]]:
    """Return the runways every procedure of an airport is published for, keyed by CIFP id.

    ``overrides.yaml`` states the runways of the procedures whose chart the generator cannot read,
    and wins where it states them; the rest come from the built airport document, which is where the
    CIFP runway records land. A document that has not been built yet leaves the overrides to answer
    alone, with a warning, because a procedure whose runways nothing states asks for no runway.

    Args:
        airport: Four-letter ICAO identifier, e.g. ``KSFO``.
        overrides: The ``overrides.yaml`` of that airport.

    Returns:
        The published runways of each procedure, e.g. ``WESLA5`` to ``("28L", "28R")``.
    """
    published = {override.cifp_id: override.runways for override in overrides.sids.values() if override.runways}
    path = data_path(airport)
    if not path.exists():
        print(
            f"warning: {path} has not been built, so only overrides.yaml says which runways a procedure is published for; "
            "run craft-gen build first if a plan should be read as requesting a runway",
            file=sys.stderr,
        )
        return published
    document = json.loads(path.read_text(encoding="utf-8"))
    for sid in document["sids"]:
        published.setdefault(sid["id"], tuple(sid["runways"]))
    return published


@dataclass(frozen=True, slots=True)
class _FixtureOutcome:
    """What the import did with one fixture file, and the settled fixture it refused to overwrite."""

    path: Path
    status: str
    diff: str
    refused: SettledFixture | None


def _settled_diff(settled: SettledFixture) -> str:
    return f"    settled fixture {settled.id} would change scenario field(s) {', '.join(settled.changed_fields)}\n"


def _fixture_result(path: Path, fixture: Fixture, *, check: bool, overwrite_settled: bool) -> _FixtureOutcome:
    validate(fixture, fixture_schema_path())
    settled = settled_fixture_at(path, fixture, overwrite_settled=overwrite_settled)
    if settled is None:
        result: WriteResult = write_or_check(path, dump(fixture), check=check)
        return _FixtureOutcome(result.path, result.status, result.diff, None)
    if not settled.changed_fields:
        return _FixtureOutcome(path, KEPT_SETTLED, "", None)
    if check:
        return _FixtureOutcome(path, "differs", _settled_diff(settled), None)
    return _FixtureOutcome(path, KEPT_SETTLED, "", settled)


def _counts_line(counts: Counter[str]) -> str:
    return ", ".join(f"{counts[status]} {status}" for status in IMPORT_STATUSES if counts[status])


def _print_sheet_summary(title: str, results: Sequence[_FixtureOutcome]) -> None:
    counts = Counter(result.status for result in results)
    print(f"  {title}: {len(results)} plan(s), " + _counts_line(counts))
    for result in results:
        if result.status == "differs":
            print(f"    {result.path}: differs")
            print(result.diff, end="")


def _settled_refusal_line(refused: Sequence[SettledFixture]) -> str:
    listed = ", ".join(f"{settled.id} ({', '.join(settled.changed_fields)})" for settled in refused)
    return (
        f"import-worksheets: {len(refused)} settled fixture(s) would change scenario and were left alone: {listed}; "
        "re-validate them with the user, or pass --overwrite-settled to downgrade them to pending"
    )


def import_worksheets(airport: str, *, check: bool = False, force: bool = False, overwrite_settled: bool = False) -> int:
    """Fetch the trainer worksheets of an airport and write one pending fixture per flight plan.

    A fixture the user has settled is never overwritten: one whose scenario the import would leave
    as it is counts as ``kept (settled)``, and one whose scenario would change is left on disk and
    named in the exit status, so no validated clearance is lost to a re-import.

    Args:
        airport: Four-letter ICAO identifier, e.g. ``KSFO``.
        check: Compare against the committed fixtures instead of writing them.
        force: Re-download every worksheet and the aircraft specs.
        overwrite_settled: Rewrite a settled fixture whose scenario changed as a fresh pending
            document, throwing its validation away.

    Returns:
        The process exit status: non-zero when ``check`` finds a committed fixture out of date, or a
        settled fixture would change and was left alone.
    """
    directory = airport_dir(airport)
    config = load_worksheets(directory / WORKSHEETS_FILE)
    inputs = load_airport(directory)
    cache = cache_dir()
    specs = fetch_aircraft_specs(cache, force=force)
    classes = designator_classes(specs, config.type_aliases)
    wake_categories = designator_wtcs(specs, config.type_aliases)
    sid_runways = published_sid_runways(airport, inputs.overrides)
    counts: Counter[str] = Counter()
    refused: list[SettledFixture] = []
    print(f"{airport}: {len(config.worksheets)} worksheet(s) -> {fixture_dir(airport)}")
    for worksheet in config.worksheets:
        text = fetch_worksheet_text(worksheet, cache, force=force)
        fixtures = sheet_fixtures(
            worksheet,
            text,
            icao=airport,
            sop=inputs.sop,
            type_aliases=config.type_aliases,
            aircraft_classes=classes,
            wake_categories=wake_categories,
            cargo_airlines=inputs.routes.cargo_airlines,
            sid_runways=sid_runways,
        )
        results = [_fixture_result(path, fixture, check=check, overwrite_settled=overwrite_settled) for path, fixture in fixtures.items()]
        for result in results:
            if result.refused is not None:
                refused.append(result.refused)
        counts.update(result.status for result in results)
        _print_sheet_summary(worksheet.title, results)
    print(f"  {counts.total()} plan(s): " + _counts_line(counts))
    if refused:
        print(_settled_refusal_line(refused))
    return EXIT_ERROR if counts["differs"] or refused else EXIT_OK


def _run(args: argparse.Namespace) -> int:
    handlers: dict[str, Callable[[], int]] = {
        "build": lambda: build(
            args.airport, args.cycle, offline=args.offline, check=args.check, force=args.force, allow_sop_drift=args.allow_sop_drift
        ),
        "import-worksheets": lambda: import_worksheets(args.airport, check=args.check, force=args.force, overwrite_settled=args.overwrite_settled),
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
