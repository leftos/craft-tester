# Architecture

Two halves joined by one data contract.

```
FAA CIFP ─┐
FAA chart PDFs ─┤  generator/ (Python)  ──►  data/<icao>.json  ──►  web/ (TypeScript, static)
ZOA SOP/TEC/LOA YAML ─┘        validates against          ▲              rules engine grades in-browser
vNAS aircraft specs ─┘   data/schema/*.json  ◄── exported from web/src/data/schema.ts
```

## Data contract

`web/src/data/schema.ts` (zod) defines `AirportData` and `Fixture`. `pnpm -C web schema:export` writes
`data/schema/airport.schema.json` and `data/schema/fixture.schema.json`; the generator validates every emitted
file against them. A vitest sync test fails when the checked-in export drifts from the zod source.

Sections of `AirportData` (see the schema for fields): `airport`, `provenance`, `runwayConfigs`,
`departureSectors`, `frequencies`, `gates`, `sids`, `assignmentRules`, `noiseWindows`, `altitudeRules`,
`phraseology`, `phraseologyRules`, `equipmentSuffixes`, `tecRoutes`, `loaRules`, `aircraftClasses`,
`routeLibrary`.

## Generator (`generator/src/craft_generator/`)

| module | job |
|---|---|
| `cli.py` | `craft-gen` subcommands: `build`, `verify-sop`, `import-worksheets` |
| `http.py` | cached GET (stdlib urllib), sha256 |
| `charts_api.py`, `chart_text.py` | ZOA charts API → DP list; pypdf text → top altitude, transitions, departure frequencies |
| `cifp/` | AIRAC cycle math; ARINC 424 fixed-width slicing of SID legs and runways (`records.py`), STAR ids (`stars.py`), VHF/NDB navaids (`navaids.py`) and airport reference points (`airports.py`); grouping into runways/transitions/restrictions/kind (`sid.py`). Hand-rolled on purpose: audited 2026-09-16 against `cifparse` 2.0.9's width tables and `zoa-reference-cli` with zero column drift, and neither package fits as a dependency (GPL-3.0 and no tests; no runway/navaid-name coverage). The checked-in text fixtures under `tests/fixtures/cifp/` are the regression net for every column |
| `sop/` | YAML models, loader with cross-reference validation, SOP PDF hash + sentinel verification |
| `aircraft_classes.py` | vNAS `AircraftSpecs.json` EngineType → P/T/J |
| `merge.py` | joins all sources, applies `overrides.yaml`, runs integrity checks |
| `emit.py` | schema validation, stable JSON, `--check` diff |
| `worksheets.py` | Google Docs text export → fixture files with `status: pending` |

Hand-authored inputs per airport live in `generator/airports/<icao>/`: `sop.yaml`, `overrides.yaml`,
`routes.yaml`, `tec.yaml`, `loa.yaml`. Inputs every airport inherits live in `generator/shared/`:
`equipment_suffixes.yaml` (the FAA suffix table), `phraseology_rules.yaml` (the national CRAFT rule
rows, which an airport's `sop.yaml` overrides by id; `merge.py` joins them, shared rows first) and
`route_connections.yaml` (the ZOA route-building cheat sheet, one row per "fix connects onward to fix"
arrow, emitted as citable `routeConnections` rows). Adding an
airport is adding that directory and a line in `data/airports.json`; the step-by-step runbook is
[ADDING_AN_AIRPORT.md](./ADDING_AN_AIRPORT.md).

## Web (`web/src/`)

| directory | job |
|---|---|
| `data/` | zod schema, loader |
| `rules/` | clearance engine: classify → parse route → select SID → phrase route → resolve altitude → frequency → explain runway; `options`, `grade`, `speak`. `rules/amend/` checks the three strip boxes; its `build.ts` route-builds before the vector-SID fallback (a filed SID whose transition connects onward to the filed route over `routeConnections`, or a row's forced transition) |
| `scenario/` | seeded PRNG, clearance-scenario generator (configurations drawn by `runwayConfigs[].trainingWeight`), time-of-day and runway-configuration filters |
| `ui/` | strip, ATIS panel, CRAFT form, results, solved-scenario store (`solved.ts`, localStorage, best effort) |

Every engine output element carries `RuleCitation[]` pointing at the data rows that decided it; the results
view shows them. The graded elements are `R.route`, `A.phrase`, `A.expect`, `F` and `RWY`, the
departure runway: the scenario fixes the runway and the engine explains it (the configuration row plus the
`RWY-*` mechanism row), so the ATIS can advertise the runways in normal use and the student must pick the
parallel. The procedure, the clearance limit and the squawk are resolved but not graded. A verdict is
`correct`, `wrong`, or `acceptable`: a reading the rules allow that says more than it needs to, counted
as correct in the score line but shown in its own colour. The engine reports the longer reading it
allows as `redundantExpect` beside the clause it speaks: the expect clause a SID chart already publishes
(accepted at the chart's delay, citing `A-EXPECT-REDUNDANT`), and the amended clause beside a "will be
your final" reading (accepted at the delay that clause would carry, citing `A-FINAL`). The expect clause
itself has three readings (`ExpectClause.kind`): `filed` ("expect (filed altitude) N minutes after
departure"), `amended` after the altitude box was amended, and `final` ("(altitude) will be your final",
row `A-FINAL`) where the amended clearance speaks the altitude it climbs the flight straight to. A clean
clearance is read exactly as filed, so clearance mode draws only plans whose route already carries the
assigned SID; a missing, stale or wrong SID is amendment-mode material. An assignment row with no SID
(`sidFamily: null`, `nonDpHeading: runway heading`) clears the flight on the runway heading: the
procedure element is the heading (`Procedure.kind === 'heading'`, spoken "via fly runway heading",
row `R-HEADING`), the route element takes the airport's `noSid` shape on the first filed fix or the
airway shape on an airway, clearance mode draws the plan with no procedure token, and amendment mode
amends a filed SID down to the tail and offers the heading as the last procedure option. The spoken
transmission ends "expect runway (designator)".

## Fixture lifecycle

1. `craft-gen import-worksheets` writes worksheet plans to `fixtures/<icao>/worksheets/` as `pending`
   with no `expected`; `mode` (`clearance` or `amendment`) comes from the sheet kind and says which
   engine the runner exercises.
2. `pnpm -C web propose <id>` prints the engine's clearance with citations.
3. The user confirms or corrects; a correction is a YAML edit plus `craft-gen build`.
4. The fixture gains `expected` and becomes `settled`. Settled fixtures fail the suite when they break.

## Conventions

- Rules are data; the engine is a matcher. See `CLAUDE.md`.
- SIDs compare by family, not versioned id.
- Nothing in tests touches the network.
