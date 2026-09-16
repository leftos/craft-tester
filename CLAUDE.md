# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

IFR clearance trainer for KSFO (VATSIM ZOA). Two halves: a Python **generator** that emits `data/<icao>.json`
from FAA CIFP, FAA chart PDFs, and hand-transcribed SOP/TEC/LOA YAML, and a static Vite + TypeScript **web**
app whose rules engine grades clearances in the browser. Read `docs/ARCHITECTURE.md` before touching either
half; `docs/plans/MAIN.md` is the task index; `docs/ADDING_AN_AIRPORT.md` is the runbook for a new airport.

## Commands

```sh
# web (pnpm, Node 22+)
pnpm -C web install
pnpm -C web dev | build | preview
pnpm -C web lint | fmt | fmt:check | typecheck | test
pnpm -C web test rules/engine                 # one test file (vitest path filter)
pnpm -C web test -t "climb via"               # tests whose name matches
pnpm -C web schema:export                     # regenerate data/schema/*.json from web/src/data/schema.ts
pnpm -C web propose <fixture-id> | --pending  # engine's clearance for a fixture, with citations

# generator (uv, Python 3.13)
cd generator && uv sync
uv run ruff check && uv run ruff format --check && uv run ty check && uv run pytest -q
uv run pytest -q tests/test_sid.py -k transitions   # one file / one test
uv run pytest -q -m network                          # the fetching tests, deselected by default
uv run craft-gen fetch-cifp --airport KSFO [--cycle 2609]
uv run craft-gen fetch-charts --airport KSFO
uv run craft-gen build --airport KSFO [--cycle 2609] [--offline] [--check]
uv run craft-gen verify-sop --airport KSFO
uv run craft-gen import-worksheets --airport KSFO [--check]

# hooks (same gates as CI)
prek install && prek run --all-files
```

Downloads cache under `generator/cache/` (gitignored) or `$CRAFT_GEN_CACHE`. CI runs the web and generator
gates, fails if `data/schema/` differs from a fresh `schema:export`, and runs `import-worksheets --check` with
network. CI does not run `craft-gen build`; `build --check` is a local step before committing data.

## Layout notes not in the architecture doc

- **Import aliases.** App and test code under `web/src/` import with `@/…` (web/src) and `@data/…` (data/),
  wired in both `vite.config.ts` and `tsconfig.json`. `web/scripts/*.ts` run under plain Node, so they use
  the package `#src/*` subpath import instead. Never use relative `../` paths across directories.
- **Fixtures.** `fixtures/<icao>/synthetic/` is hand-written; `fixtures/<icao>/worksheets/` is written by
  `import-worksheets`. `web/src/rules/fixtures.test.ts` runs every fixture and prints what the engine makes
  of each `pending` one.
- **Data depends on fixtures.** `craft-gen build` reads navaid names for every route filed in
  `fixtures/<icao>/**`, so re-run the build after an import.
- **Graded elements** are `R.route`, `A.phrase`, `A.expect`, `F`, and `RWY`. The procedure, the clearance
  limit and the squawk are resolved and spoken but not graded: a clean clearance is read exactly as
  filed, so clearance mode draws only plans whose route already carries the assigned SID.

## Rules of the repo

- **Rules are data, code is a matcher.** Every SOP, TEC, and LOA decision is a row in
  `generator/airports/<icao>/*.yaml` with `id`, `source`, `text`; the engine cites rows, never hard-codes
  them. A worksheet correction is a YAML edit plus `craft-gen build`, not an engine change. If a correction
  cannot be expressed as data, stop and add the new rule concept to the plan first.
- **No code keyed on KSFO.** Adding an airport is a YAML directory plus a line in `data/airports.json`;
  a code change needed for a new airport is a new rule concept and goes through the plan first.
- **`web/src/data/schema.ts` is the single source of truth** for the data shape. Change it, run
  `pnpm -C web schema:export`, then rebuild data. The schema sync test fails when the export is stale.
- **`data/*.json` is generated.** Never hand-edit; run `craft-gen build --check` to confirm it matches.
- **Fixtures carry `status: settled | pending`.** `pending` records an open question and must not fail the
  suite; promote to `settled` only after the user confirms the expected clearance.
- **SIDs compare by family** (`TRUKN`), never by versioned id, because AIRAC cycles bump versions.
- **Hand-transcribed sources are pinned.** `sop.yaml` records the SOP PDF sha256 and sentinel strings;
  `verify-sop` fails when the document changes. Re-transcribe, then update the hash.
- **Network stays out of tests.** Generator tests run on checked-in text fixtures; anything that fetches is
  marked `@pytest.mark.network` and deselected by default.
- **Procedures and fixes are spoken by name, never spelled.** The generator emits `fixSpoken` from CIFP
  navaid records; an unnamed navaid on checked data fails the build (one only a worksheet route files
  warns). A hand `fix_spoken` row in `overrides.yaml` wins.

## Footguns

- Windows host. Use `.tmp/` inside the repo for scratch, never `/tmp`.
- Chart PDF text from pypdf is a bag of lines in scrambled order; parse with regexes that tolerate a value
  on the line before or after its label.
- Radar-vector SIDs (SAN FRANCISCO FIVE) have no CIFP records at all; their facts come from
  `overrides.yaml`.
- The ZOA route tool is a Blazor app with no JSON API; TEC routes are transcribed, not scraped.
- The FAA code is the ICAO code without the leading `K`; the CLI derives it (`--airport KOAK` reads
  `generator/airports/koak/` and asks the charts API for `OAK`).
- Ask before committing.
