"""Checks that a transcribed SOP still matches the document it was transcribed from.

``sop.yaml`` pins its source twice: by the sha256 of the PDF, which catches any change at all, and
by sentinel strings copied out of the transcribed sections, which say whether those sections are
still there after a change. ``craft-gen verify-sop`` reports both, and fails the build on either, so
a re-issued SOP is re-read by a human rather than silently kept.

pypdf breaks the text layer wherever the printed layout wraps, so a sentence of the SOP arrives as
two or three lines. Sentinels are therefore matched against the whole document text with every run
of whitespace collapsed to a single space, never line by line.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from craft_generator.chart_text import extract_text
from craft_generator.http import fetch_bytes, sha256_hex
from craft_generator.sop.model import SopSource

_WHITESPACE = re.compile(r"\s+")
_CACHE_NAME_LENGTH = 12


@dataclass(frozen=True, slots=True)
class SopVerification:
    """The outcome of checking one SOP document against its transcription."""

    url: str
    expected_sha256: str
    actual_sha256: str
    hash_matches: bool
    missing_sentinels: tuple[str, ...]

    @property
    def ok(self) -> bool:
        """Whether the document is byte-identical and every sentinel is still present."""
        return self.hash_matches and not self.missing_sentinels


def normalize_whitespace(text: str) -> str:
    """Return ``text`` with every run of whitespace collapsed to one space, stripped.

    Args:
        text: Any text, typically several lines of a PDF joined together.

    Returns:
        The text as a single space-separated line.
    """
    return _WHITESPACE.sub(" ", text).strip()


def missing_sentinels(lines: Sequence[str], sentinels: Sequence[str]) -> tuple[str, ...]:
    """Return the sentinels that do not appear in the text of a document.

    Both sides are whitespace-normalised first, so a sentinel matches across the line breaks pypdf
    introduces at the printed line width.

    Args:
        lines: The document text, e.g. as returned by
            :func:`craft_generator.chart_text.extract_text`.
        sentinels: The strings ``sop.yaml`` expects to find.

    Returns:
        The absent sentinels, in the order they were given.
    """
    haystack = normalize_whitespace(" ".join(lines))
    return tuple(sentinel for sentinel in sentinels if normalize_whitespace(sentinel) not in haystack)


def sop_cache_path(cache: Path, source: SopSource) -> Path:
    """Return the cache file one SOP PDF is downloaded to.

    The name is the leading digits of the sha256 ``sop.yaml`` expects, so a re-transcription against
    a new document downloads afresh instead of reading the superseded PDF.

    Args:
        cache: Download cache directory, normally :func:`craft_generator.http.cache_dir`.
        source: The pinned source from ``sop.yaml``.

    Returns:
        The path of the cached PDF.
    """
    return cache / "sop" / f"{source.sha256[:_CACHE_NAME_LENGTH]}.pdf"


def verify_sop_source(source: SopSource, cache: Path, *, force: bool = False) -> SopVerification:
    """Download a SOP PDF and check its hash and sentinels against the transcription.

    Args:
        source: The pinned source from ``sop.yaml``.
        cache: Download cache directory, normally :func:`craft_generator.http.cache_dir`.
        force: Re-download even when the cache already holds the PDF.

    Returns:
        The hash comparison and the sentinels the document no longer carries.

    Raises:
        RuntimeError: The download failed.
    """
    pdf = fetch_bytes(source.url, sop_cache_path(cache, source), force=force)
    actual = sha256_hex(pdf)
    return SopVerification(
        url=source.url,
        expected_sha256=source.sha256,
        actual_sha256=actual,
        hash_matches=actual == source.sha256,
        missing_sentinels=missing_sentinels(extract_text(pdf), source.sentinels),
    )
