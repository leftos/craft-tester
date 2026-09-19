# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

IFR clearance trainer for KSFO and KOAK (VATSIM ZOA). Two halves: a Python **generator** that emits `data/<icao>.json`
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
pnpm -C web exec playwright install chromium  # once per machine, for the browser check
pnpm -C web check:browser <name> s=1,a=KOAK,d=KLVK phone|desktop ["select:4=(no prefix)" "fill:0=…" "press:Enter" "click:Submit clearance"]

# generator (uv, Python 3.13)
cd generator && uv sync
uv run ruff check && uv run ruff format --check && uv run ty check && uv run pytest -q
uv run pytest -q tests/test_sid.py -k transitions   # one file / one test
uv run pytest -q -m network                          # the fetching tests, deselected by default
uv run craft-gen fetch-cifp --airport KSFO [--cycle 2609]
uv run craft-gen fetch-charts --airport KSFO
uv run craft-gen fetch-aircraft-characteristics [--from aircraft_data.xlsx]   # FAA table -> generator/shared/, no --airport
uv run craft-gen build --airport KSFO [--cycle 2609] [--offline] [--check] [--coverage]   # --coverage: gate fixes no library route leaves at
uv run craft-gen verify-sop --airport KSFO
uv run craft-gen import-worksheets --airport KSFO [--check]

# hooks (same gates as CI)
prek install && prek run --all-files
```

Downloads cache under `generator/cache/` (gitignored) or `$CRAFT_GEN_CACHE`. CI runs the web and generator
gates, fails if `data/schema/` differs from a fresh `schema:export`, and runs `import-worksheets --check` with
network. CI does not run `craft-gen build`; `build --check` is a local step before committing data.

**Browser checks run under Playwright, not the Claude in Chrome extension** (user decision 2026-09-16), so the
viewport is forced: `phone` is 390px wide, `desktop` 1280px. Build, run `pnpm -C web preview` in another shell,
then `check:browser`, which opens the hash (written with commas between its parts, since a literal `&` does not
survive pnpm on Windows), runs the actions (`fill:<n>` counts text inputs and textareas together, in page order;
`press:Enter` presses a key on whatever has focus; `check:full route` ticks the checkbox of that label;
`scroll:600` scrolls the page down to that offset), and writes the
page text, selects, buttons, console errors, whether the page scrolls sideways, a full-page screenshot and a `-view`
screenshot of the viewport alone to `.tmp/browser-check/`. Only the `-view` shot shows what stays pinned after a
scroll; the printed `stripTop` is the flight-plan panel's top edge in the viewport, `0` while it is pinned. The hash carries the airport in
its `a=<ICAO>` part (every link the app writes has one; a missing or unknown one opens the first airport of the
index) and takes an undocumented `d=<ICAO>` part that forces the drawn destination in both modes
(`s=4,a=KOAK,d=KSMF,m=amend`; `i=text` opens the typing box, `r=full` opens it held to the full route), so a destination is checked directly instead of drawing until the RNG lands on
it; it is never shown in the UI or remembered. `CRAFT_PREVIEW_URL` points the run at another preview
(`pnpm -C web preview --port 4174` plus `CRAFT_PREVIEW_URL=http://localhost:4174/craft-tester/`), so two builds
can be checked side by side. A button with no text lists by its `aria-label`, which is how the icon buttons read.

## References cached outside git

`docs/refs/` is gitignored and holds FAA JO 7110.65, the AIM and AC 90-66B for paragraph lookups. Read
them from `docs/refs/7110.65/` and `docs/refs/aim/`: one markdown file per section (`chap04_sec03.md` is
7110.65 4-3, Departure Procedures; `aim/chap05_sec03.md` is AIM 5-3, En Route Procedures) with `INDEX.md`
listing every paragraph title, converted from the FAA's HTML versions and shared with
`X:\dev\yaat\.claude\reference\faa\` (copy its `7110.65`, `aim` and `ac-90-66b` directories to refresh).
Never web-search a 7110.65 or AIM paragraph; `rg -n "4-3-2" docs/refs/7110.65/` or
`rg -n "5-3-4" docs/refs/aim/` finds it. Next to it sit the dated full-order PDF
(`7110.65BB.pdf`, Basic with changes 1–3, effective 2026-07-09) and its pypdf text dump for a
page-numbered citation. Fetch those once per machine:

```powershell
Invoke-WebRequest -Uri 'https://www.faa.gov/documentLibrary/media/Order/7110.65BB_Bsc_w_Chg_1_2_and_3_dtd_7-9-26_Final.pdf' -OutFile docs\refs\7110.65BB.pdf
cd generator; uv run python -c "from pypdf import PdfReader; r=PdfReader('../docs/refs/7110.65BB.pdf'); open('../docs/refs/7110.65BB.txt','w',encoding='utf-8').write(''.join(f'\n===== page {i} =====\n'+(p.extract_text() or '') for i,p in enumerate(r.pages,1)))"
```

The current edition and its URL are listed at https://www.faa.gov/air_traffic/publications (Orders
table); the HTML version is at https://www.faa.gov/air_traffic/publications/atpubs/atc_html/.

## Layout notes not in the architecture doc

- **Import aliases.** App and test code under `web/src/` import with `@/…` (web/src) and `@data/…` (data/),
  wired in both `vite.config.ts` and `tsconfig.json`. `web/scripts/*.ts` run under plain Node, so they use
  the package `#src/*` subpath import instead. Never use relative `../` paths across directories.
- **Tests run in Node.** A test that needs a DOM opts in per file with a `// @vitest-environment happy-dom`
  docblock on line 1 — `web/src/ui/app.test.ts` and the `*.dom.test.ts` files today. There is no
  global test environment, so `strip.ts`'s `typeof document === 'undefined'` fallbacks stay exercised by the
  other files.
- **Fixtures.** `fixtures/<icao>/synthetic/` is hand-written; `fixtures/<icao>/worksheets/` is written by
  `import-worksheets`. `web/src/rules/fixtures.test.ts` runs every fixture and prints what the engine makes
  of each `pending` one. It is also the **only** guard on amendment reason wording — the unit tests assert
  citations and boxes, not prose — so run `pnpm -C web test rules/fixtures` after any change to a reason
  string, before the full suite. A settled fixture's reason is text the user confirmed; if one moves, that
  is a ruling to take to them, not an expectation to update.
- **Data depends on fixtures.** `craft-gen build` reads navaid names for every route filed in
  `fixtures/<icao>/**`, so re-run the build after an import.
- **Graded elements** are `R.route`, `A.phrase`, `A.expect`, `F`, and `RWY`, plus the three strip boxes
  and the procedure pick (`R.sid`) in amendment mode. In clearance mode the procedure, the clearance
  limit and the squawk are resolved and spoken but not graded: a clean clearance is read exactly as
  filed, so clearance mode draws only plans whose route already carries the assigned SID (or no
  procedure token at all, for a flight the SOP sends off on the runway heading).

## Rules of the repo

- **Rules are data, code is a matcher.** Every SOP, TEC, and LOA decision is a row in
  `generator/airports/<icao>/*.yaml` with `id`, `source`, `text`; the engine cites rows, never hard-codes
  them. National CRAFT phraseology (FAA JO 7110.65) lives once in `generator/shared/phraseology_rules.yaml`
  and every airport inherits it; an airport's `sop.yaml` overrides a row by id. The ZOA route-building
  connections (`generator/shared/route_connections.yaml`) are shared the same way. A worksheet correction is a
  YAML edit plus `craft-gen build`, not an engine change. If a correction cannot be expressed as data,
  stop and add the new rule concept to the plan first.
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
  warns). A navaid the CIFP does not carry (decommissioned, or foreign) is named once in
  `generator/shared/navaid_names.yaml`, and a hand `fix_spoken` row in `overrides.yaml` wins over both.

## Footguns

- Windows host. Use `.tmp/` inside the repo for scratch, never `/tmp`.
- Chart PDF text from pypdf is a bag of lines in scrambled order; parse with regexes that tolerate a value
  on the line before or after its label.
- Radar-vector SIDs (SAN FRANCISCO FIVE) have no CIFP records at all; their facts come from
  `overrides.yaml`.
- A CIFP altitude leg on an initial-climb path terminator is not a crossing restriction and carries no fix;
  `INITIAL_CLIMB_TERMINATORS` (`cifp/sid.py`) lists the ones seen so far (`VA CA VI CI FM VM VD`). `CD` is
  the same shape and deliberately absent because no current row exercises it — a new airport whose SIDs use
  it will emit restrictions with an empty fix until it is added. A SID left with no restriction at all may
  need `climb_via_eligible` in `overrides.yaml` to hold the phraseology the SOP clears it with.
- The ZOA route tool is a Blazor app with no JSON API; TEC routes are transcribed, not scraped.
- The FAA code is the ICAO code without the leading `K`; the CLI derives it (`--airport KOAK` reads
  `generator/airports/koak/` and asks the charts API for `OAK`).
- Ask before committing.
