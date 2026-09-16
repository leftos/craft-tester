# CRAFT Clearance Trainer

A browser game for VATSIM Oakland ARTCC (ZOA) trainees practising IFR departure clearances at KSFO.
Play it at <https://leftos.github.io/craft-tester/>, deployed from `main` by GitHub Pages.

For simulation use only. Not for real-world navigation or ATC.

## What it does

Two modes, switched in the header:

- **Clean clearance.** A flight strip and the ATIS (runway configuration, local time, notices) for a
  plan that is correct as filed. You build the spoken CRAFT clearance from dropdowns: the route shape
  and exit fix, the altitude phrase and value, the expect clause, the departure frequency and the
  runway to expect. Submit once; each element is graded green, orange (acceptable, but longer than it
  needs to be) or red, with the SOP, TEC, LOA or FAA JO 7110.65 rule that decided it, and the
  clearance is then read back the way a controller would say it.
- **Amend and clear.** The strip has something wrong: a stale, wrong or missing SID, a dropped
  transition, a missing or unknown equipment suffix, a non-RNAV suffix on an RNAV procedure, an
  altitude with the wrong parity or above the RVSM band, a TEC destination filed off its route. You
  answer each box as "correct as filed" or amend it, the boxes are graded, and you then clear the
  corrected plan, this time picking the procedure too.

Scenarios are seeded: the link in the header reproduces a draw, and the time-of-day and
runway-configuration filters ride in it.

## Layout

| path | what |
|---|---|
| `web/` | Vite + TypeScript static app. The rules engine (`web/src/rules/`) grades in the browser; `web/scripts/` holds the fixture proposer, the schema export and the Playwright browser check. |
| `generator/` | Python (uv) generator that turns FAA CIFP, FAA chart PDFs and hand-transcribed ZOA SOP, TEC and LOA tables into `data/<icao>.json`. `generator/airports/<icao>/` is one airport's hand-authored input; `generator/shared/` is what every airport inherits (the FAA suffix table, the national CRAFT phraseology rows, the ZOA route-building connections). |
| `data/` | Generated airport data the app loads, plus the JSON Schemas exported from the zod definitions. Never hand-edited. |
| `fixtures/` | Expected clearances: `worksheets/` imported from the ZOA training worksheets, `synthetic/` hand-written edge cases. Every settled fixture runs as a test. |
| `docs/` | [Architecture](docs/ARCHITECTURE.md), the [runbook for adding an airport](docs/ADDING_AN_AIRPORT.md) and the plans; start at [`docs/plans/MAIN.md`](docs/plans/MAIN.md). |

## Develop

```sh
# web (pnpm, Node 22+)
pnpm -C web install
pnpm -C web dev                      # http://localhost:5173/craft-tester/
pnpm -C web lint && pnpm -C web fmt:check && pnpm -C web typecheck && pnpm -C web test
pnpm -C web propose <fixture-id>     # the engine's clearance for a fixture, with the rules it cites

# generator (uv, Python 3.13)
cd generator && uv sync
uv run ruff check && uv run ruff format --check && uv run ty check && uv run pytest -q
uv run craft-gen build --airport KSFO --check    # data/ksfo.json matches the sources
```

Install the git hooks once with `prek install`; `prek run` runs the same gates as CI. CI runs the web
and generator gates, checks that the schema export is committed and that the worksheet fixtures are
up to date; the Pages workflow builds and deploys `web/dist` on every push to `main`. `craft-gen
build` is a local step, because the generated data is committed.

## Correcting a rule

Rules are data. Every SOP, TEC and LOA decision is a row in `generator/airports/<icao>/*.yaml` with an
id, a source and its text, and the engine cites rows rather than hard-coding them. A phraseology
correction is a YAML edit, `craft-gen build`, and a fixture recording the confirmed clearance. See
`CLAUDE.md` for the rules of the repo and `docs/ADDING_AN_AIRPORT.md` for the whole pipeline.
