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
| `cifp/` | AIRAC cycle math, ARINC 424 SID record slicing, grouping into runways/transitions/restrictions/kind |
| `sop/` | YAML models, loader with cross-reference validation, SOP PDF hash + sentinel verification |
| `aircraft_classes.py` | vNAS `AircraftSpecs.json` EngineType → P/T/J |
| `merge.py` | joins all sources, applies `overrides.yaml`, runs integrity checks |
| `emit.py` | schema validation, stable JSON, `--check` diff |
| `worksheets.py` | Google Docs text export → fixture files with `status: pending` |

Hand-authored inputs per airport live in `generator/airports/<icao>/`: `sop.yaml`, `overrides.yaml`,
`routes.yaml`, `tec.yaml`, `loa.yaml`. Adding an airport is adding that directory and a line in
`data/airports.json`; the step-by-step runbook is [ADDING_AN_AIRPORT.md](./ADDING_AN_AIRPORT.md).

## Web (`web/src/`)

| directory | job |
|---|---|
| `data/` | zod schema, loader |
| `rules/` | clearance engine: classify → parse route → select SID → phrase route → resolve altitude → frequency; `options`, `grade`, `speak` |
| `rules/amend/` | amendment engine: route, altitude, type checks producing `Amendment[]` |
| `scenario/` | seeded PRNG, clearance-scenario generator, fault-injecting amendment generator |
| `ui/` | strip, ATIS panel, CRAFT form, amendment form, results |

Every engine output element carries `RuleCitation[]` pointing at the data rows that decided it; the results
view shows them.

## Fixture lifecycle

1. `craft-gen import-worksheets` writes worksheet plans to `fixtures/<icao>/worksheets/` as `pending`
   with no `expected`.
2. `pnpm -C web propose <id>` prints the engine's clearance with citations.
3. The user confirms or corrects; a correction is a YAML edit plus `craft-gen build`.
4. The fixture gains `expected` and becomes `settled`. Settled fixtures fail the suite when they break.

## Conventions

- Rules are data; the engine is a matcher. See `CLAUDE.md`.
- SIDs compare by family, not versioned id.
- Nothing in tests touches the network.
