"""Cached HTTP GET over the standard library.

Every byte the generator downloads goes through :func:`fetch_bytes`, which keeps a copy under
:func:`cache_dir` so a rebuild (and ``craft-gen build --offline``) never repeats a download.
"""

import hashlib
import os
import urllib.error
import urllib.request
from pathlib import Path

USER_AGENT = "craft-generator/0.1 (+https://github.com/leftos/craft-tester)"
CACHE_ENV_VAR = "CRAFT_GEN_CACHE"
_TIMEOUT_SECONDS = 120


def cache_dir() -> Path:
    """Return the download cache directory.

    Uses ``$CRAFT_GEN_CACHE`` when set, otherwise ``generator/cache`` resolved from this package's
    location on disk.

    Returns:
        The cache directory. It is not created by this call.
    """
    override = os.environ.get(CACHE_ENV_VAR)
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[2] / "cache"


def sha256_hex(data: bytes) -> str:
    """Return the lowercase hex sha256 digest of ``data``."""
    return hashlib.sha256(data).hexdigest()


def fetch_bytes(url: str, cache_path: Path, *, force: bool = False) -> bytes:
    """Return the body of ``url``, reading ``cache_path`` when it already holds a copy.

    Args:
        url: Absolute http(s) URL to fetch.
        cache_path: File the body is cached in. Parent directories are created as needed.
        force: Download even when ``cache_path`` exists, replacing it.

    Returns:
        The response body.

    Raises:
        RuntimeError: The download failed; the message carries the URL and the underlying reason.
    """
    if cache_path.exists() and not force:
        return cache_path.read_bytes()
    data = _download(url)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_bytes(data)
    return data


def _download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:
            body: bytes = response.read()
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"GET {url} failed with HTTP {exc.code} {exc.reason}; check the AIRAC cycle or the chart name") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"GET {url} failed: {exc.reason}; check network access or pass --offline to use the cache") from exc
    return body
