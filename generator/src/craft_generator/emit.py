"""Schema validation, stable JSON text and the ``--check`` diff.

The emitted file is the contract between the two halves of the repo, so it is validated against
``data/schema/airport.schema.json`` - the export of the zod schema the web app reads - before it is
written, and every validation error of the whole document is reported at once with its JSON path,
because fixing one field at a time through a build that takes a minute is the slow way to find out
that four fields are wrong.

The text is ``json.dumps`` with sorted keys, a two-space indent and no ASCII escaping, plus a final
newline, so the same document always produces the same bytes and a diff of ``data/<icao>.json``
between two AIRAC cycles shows only what changed in the data. Files are written with line-feed line
endings on every platform; without that, a build on Windows would rewrite every line of the file.
"""

import difflib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from jsonschema import Draft202012Validator

WriteStatus = Literal["written", "unchanged", "differs"]

SCHEMA_FILE = "airport.schema.json"


@dataclass(frozen=True, slots=True)
class WriteResult:
    """What :func:`write_or_check` did, and the diff when the file is out of date."""

    path: Path
    status: WriteStatus
    diff: str


def repo_root() -> Path:
    """Return the repository root, resolved from this package's location on disk."""
    return Path(__file__).resolve().parents[3]


def schema_path() -> Path:
    """Return the checked-in JSON Schema an emitted airport document is validated against."""
    return repo_root() / "data" / "schema" / SCHEMA_FILE


def data_path(icao: str) -> Path:
    """Return the file one airport's document is written to, e.g. ``data/ksfo.json``.

    Args:
        icao: Four-letter ICAO identifier; case is ignored.

    Returns:
        The path under ``data/``.
    """
    return repo_root() / "data" / f"{icao.lower()}.json"


def _json_path(parts: Sequence[object]) -> str:
    path = "$"
    for part in parts:
        path += f"[{part}]" if isinstance(part, int) else f".{part}"
    return path


def validate(document: Mapping[str, Any], schema: Path) -> None:
    """Check a document against a JSON Schema, reporting every error at once.

    Args:
        document: The document to validate.
        schema: Path to the JSON Schema file, normally :func:`schema_path`.

    Raises:
        ValueError: The document does not satisfy the schema; the message lists one line per error
            with its JSON path.
        OSError: The schema file is missing.
    """
    validator = Draft202012Validator(json.loads(schema.read_text(encoding="utf-8")))
    errors = sorted(validator.iter_errors(dict(document)), key=lambda error: list(error.absolute_path))
    if not errors:
        return
    lines = [f"  {_json_path(list(error.absolute_path))}: {error.message}" for error in errors]
    raise ValueError(f"the generated document does not match {schema.name} ({len(errors)} error(s)):\n" + "\n".join(lines))


def dump(document: Mapping[str, Any]) -> str:
    """Return the stable JSON text of a document, keys sorted and one trailing newline."""
    return json.dumps(dict(document), sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def write_or_check(path: Path, text: str, *, check: bool) -> WriteResult:
    """Write generated text, or report how the file on disk differs from it.

    Args:
        path: The file to write or compare.
        text: The generated text.
        check: Compare only, never write.

    Returns:
        ``unchanged`` when the file already holds ``text``, ``written`` when it was written, and
        ``differs`` (with a unified diff) when ``check`` is set and the file is out of date.
    """
    current = path.read_text(encoding="utf-8", newline="") if path.exists() else None
    if current == text:
        return WriteResult(path, "unchanged", "")
    if check:
        diff = difflib.unified_diff(
            (current or "").splitlines(keepends=True),
            text.splitlines(keepends=True),
            fromfile=f"{path} (committed)",
            tofile=f"{path} (generated)",
        )
        return WriteResult(path, "differs", "".join(diff))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    return WriteResult(path, "written", "")
