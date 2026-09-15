import io
from datetime import date
from pathlib import Path

import pytest
from pypdf import PdfWriter

from craft_generator.http import cache_dir, sha256_hex
from craft_generator.sop.model import AirportInputs, SopSource
from craft_generator.sop.verify import missing_sentinels, normalize_whitespace, sop_cache_path, verify_sop_source

SENTINEL = "SNTNA# shall be used instead of TRUKN# off Runways 28 while in 28/01 configuration"


def blank_pdf() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def source_for(sha256: str, sentinels: tuple[str, ...] = ()) -> SopSource:
    return SopSource(
        title="Test SOP",
        version="1.0",
        url="https://example.invalid/sop.pdf",
        sha256=sha256,
        transcribed_at=date(2026, 9, 15),
        sentinels=sentinels,
    )


def cached(cache: Path, source: SopSource, pdf: bytes) -> None:
    """Place ``pdf`` where :func:`verify_sop_source` looks, so the check never reaches the network."""
    path = sop_cache_path(cache, source)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(pdf)


def test_normalize_whitespace_collapses_runs() -> None:
    assert normalize_whitespace("  a\nb \t c  ") == "a b c"


def test_every_sentinel_is_present_in_the_transcribed_pages(sop_text_lines: list[str], ksfo_inputs: AirportInputs) -> None:
    assert missing_sentinels(sop_text_lines, ksfo_inputs.sop.source.sentinels) == ()


def test_a_fabricated_sentinel_is_reported_missing(sop_text_lines: list[str], ksfo_inputs: AirportInputs) -> None:
    fabricated = "SNTNA# shall be used instead of GAPP# off Runways 19"
    sentinels = (*ksfo_inputs.sop.source.sentinels, fabricated)
    assert missing_sentinels(sop_text_lines, sentinels) == (fabricated,)


def test_a_sentinel_wrapped_across_lines_still_matches() -> None:
    wrapped = [
        "Richmond 28 SNTNA#",
        "* SNTNA# shall be used instead of TRUKN# off",
        "   Runways 28 while in 28/01    configuration",
        "2-4 Noise Abatement",
    ]
    assert missing_sentinels(wrapped, (SENTINEL,)) == ()


def test_a_sentinel_broken_by_a_word_does_not_match() -> None:
    wrapped = ["* SNTNA# shall be used instead of TRUKN# off", "Runways 28 while in the 28/01 configuration"]
    assert missing_sentinels(wrapped, (SENTINEL,)) == (SENTINEL,)


def test_sop_cache_path_is_named_after_the_expected_hash(tmp_path: Path) -> None:
    source = source_for("1e2b90c75d274b836929963fe353c5ef4a5dc592cd6fa005bf7fa3e77318e008")
    assert sop_cache_path(tmp_path, source) == tmp_path / "sop" / "1e2b90c75d27.pdf"


def test_a_matching_hash_is_reported_as_matching(tmp_path: Path) -> None:
    pdf = blank_pdf()
    source = source_for(sha256_hex(pdf), ("Version 1.11",))
    cached(tmp_path, source, pdf)
    result = verify_sop_source(source, tmp_path)
    assert result.hash_matches is True
    assert result.actual_sha256 == sha256_hex(pdf)
    assert result.missing_sentinels == ("Version 1.11",)
    assert result.ok is False


def test_a_changed_document_is_reported_as_a_hash_mismatch(tmp_path: Path) -> None:
    pdf = blank_pdf()
    source = source_for("0" * 64)
    cached(tmp_path, source, pdf)
    result = verify_sop_source(source, tmp_path)
    assert result.hash_matches is False
    assert result.actual_sha256 == sha256_hex(pdf)
    assert result.expected_sha256 == "0" * 64
    assert result.ok is False


@pytest.mark.network
def test_live_sop_still_matches_its_transcription(ksfo_inputs: AirportInputs) -> None:
    result = verify_sop_source(ksfo_inputs.sop.source, cache_dir())
    assert result.missing_sentinels == ()
    assert result.ok is True
