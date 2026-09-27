import io
from dataclasses import replace
from datetime import date
from pathlib import Path

import pytest
from pypdf import PdfWriter

from craft_generator.cli import _verify_pins_for_build, verify_sop
from craft_generator.http import CACHE_ENV_VAR, cache_dir, sha256_hex
from craft_generator.sop.load import AIRCRAFT_TYPES_FILE, SOP_FILE, airport_dir, load_aircraft_types, load_sop, shared_dir
from craft_generator.sop.model import AirportInputs, SopSource, SpecialHandling
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


def special_handling_of(inputs: AirportInputs) -> SpecialHandling:
    handling = inputs.special_handling
    assert handling is not None, "generator/shared/aircraft_types.yaml carries no special_handling block"
    return handling


def with_a_passing_airport_sop(inputs: AirportInputs, cache: Path) -> AirportInputs:
    """Pin the airport SOP to a blank PDF placed in ``cache``, so only the shared pin can fail."""
    pdf = blank_pdf()
    source = source_for(sha256_hex(pdf))
    cached(cache, source, pdf)
    return replace(inputs, sop=replace(inputs.sop, source=source))


def test_the_build_fails_when_the_shared_cps004_document_lost_a_sentinel(tmp_path: Path, ksfo_inputs: AirportInputs) -> None:
    inputs = with_a_passing_airport_sop(ksfo_inputs, tmp_path)
    cached(tmp_path, special_handling_of(inputs).source, blank_pdf())
    with pytest.raises(ValueError, match=r"ZOA CPS-004 .* no longer carries \['Version 1\.2', .*update generator/shared/aircraft_types\.yaml"):
        _verify_pins_for_build(inputs, tmp_path)


def test_the_build_fails_when_the_shared_cps004_document_changed(tmp_path: Path, ksfo_inputs: AirportInputs) -> None:
    inputs = with_a_passing_airport_sop(ksfo_inputs, tmp_path)
    handling = special_handling_of(inputs)
    unsentineled = replace(handling, source=replace(handling.source, sentinels=()))
    inputs = replace(inputs, special_handling=unsentineled)
    cached(tmp_path, unsentineled.source, blank_pdf())
    with pytest.raises(ValueError, match=r"generator/shared/aircraft_types\.yaml pins 8be0f0acc742a7ca"):
        _verify_pins_for_build(inputs, tmp_path)
    _verify_pins_for_build(inputs, tmp_path, allow_drift=True)


def test_verify_sop_reports_the_shared_cps004_pin(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    monkeypatch.setenv(CACHE_ENV_VAR, str(tmp_path))
    special_handling = load_aircraft_types(shared_dir() / AIRCRAFT_TYPES_FILE).special_handling
    assert special_handling is not None
    cached(tmp_path, special_handling.source, blank_pdf())
    cached(tmp_path, load_sop(airport_dir("KSFO") / SOP_FILE).source, blank_pdf())
    assert verify_sop("KSFO") == 1
    out = capsys.readouterr().out
    shared = out[out.index("shared: ZOA CPS-004 ATCT Policies and Procedures version 1.2") :]
    assert "FAIL  sha256 is" in shared
    assert "generator/shared/aircraft_types.yaml pins 8be0f0acc742a7ca199c73480cd1036600955bba759a321390a40d79a20698a7" in shared
    assert 'FAIL  sentinel is gone: "DH8D J - Jet Capable of jet-like performance"' in shared


@pytest.mark.network
def test_live_sop_still_matches_its_transcription(ksfo_inputs: AirportInputs) -> None:
    result = verify_sop_source(ksfo_inputs.sop.source, cache_dir())
    assert result.missing_sentinels == ()
    assert result.ok is True
