# CLAUDE.md

IFR clearance trainer for KSFO (VATSIM ZOA). Two halves: a Python **generator** that emits `data/<icao>.json`
from FAA CIFP, FAA chart PDFs, and hand-transcribed SOP/TEC/LOA YAML, and a static Vite + TypeScript **web**
app whose rules engine grades clearances in the browser. Read `docs/ARCHITECTURE.md` before touching either
half; `docs/plans/MAIN.md` is the task index; `docs/ADDING_AN_AIRPORT.md` is the runbook for a new airport.

## Commands

```sh
# web (pnpm, Node 22+)
pnpm -C web install
pnpm -C web dev | build | preview
pnpm -C web lint | typecheck | test
pnpm -C web schema:export          # regenerate data/schema/*.json from web/src/data/schema.ts

# generator (uv, Python 3.13)
cd generator && uv sync
uv run ruff check && uv run ruff format --check && uv run ty check && uv run pytest -q
uv run craft-gen build --airport KSFO [--cycle 2609] [--offline] [--check]
uv run craft-gen verify-sop --airport KSFO
uv run craft-gen import-worksheets --airport KSFO

# hooks
prek install && prek run --all-files
```

## Rules of the repo

- **Rules are data, code is a matcher.** Every SOP, TEC, and LOA decision is a row in
  `generator/airports/<icao>/*.yaml` with `id`, `source`, `text`; the engine cites rows, never hard-codes
  them. A worksheet correction is a YAML edit plus `craft-gen build`, not an engine change. If a correction
  cannot be expressed as data, stop and add the new rule concept to the plan first.
- **`web/src/data/schema.ts` is the single source of truth** for the data shape. Change it, run
  `pnpm -C web schema:export`, then rebuild data. The schema sync test fails when the export is stale.
- **`data/*.json` is generated.** Never hand-edit; `craft-gen build --check` in CI diffs it.
- **Fixtures carry `status: settled | pending`.** `pending` records an open question and must not fail the
  suite; promote to `settled` only after the user confirms the expected clearance.
- **SIDs compare by family** (`TRUKN`), never by versioned id, because AIRAC cycles bump versions.
- **Hand-transcribed sources are pinned.** `sop.yaml` records the SOP PDF sha256 and sentinel strings;
  `verify-sop` fails when the document changes. Re-transcribe, then update the hash.
- **Network stays out of tests.** Generator tests run on checked-in text fixtures; anything that fetches is
  marked `@pytest.mark.network` and deselected by default.

## Footguns

- Windows host. Use `.tmp/` inside the repo for scratch, never `/tmp`.
- Chart PDF text from pypdf is a bag of lines in scrambled order; parse with regexes that tolerate a value
  on the line before or after its label.
- Radar-vector SIDs (SAN FRANCISCO FIVE) have no CIFP records at all; their facts come from
  `overrides.yaml`.
- The ZOA route tool is a Blazor app with no JSON API; TEC routes are transcribed, not scraped.
- Ask before committing.
