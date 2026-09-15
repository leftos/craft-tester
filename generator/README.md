# craft-generator

Offline data generator for the CRAFT clearance trainer. Reads FAA CIFP, FAA chart PDFs and the
hand-transcribed SOP/TEC/LOA YAML under `airports/<icao>/`, and emits `data/<icao>.json`.

```sh
uv sync
uv run ruff check && uv run ruff format --check && uv run ty check && uv run pytest -q
uv run craft-gen --help
```

Downloads are cached under `generator/cache/` (gitignored); set `CRAFT_GEN_CACHE` to move the cache.
Tests never touch the network: anything that fetches is marked `network` and deselected by default.
