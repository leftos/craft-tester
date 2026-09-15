# CRAFT Clearance Trainer

A small browser game for VATSIM Oakland ARTCC (ZOA) trainees practicing IFR departure clearances at
KSFO. Each scenario shows a flight strip and the active runway configuration; you build the spoken CRAFT
clearance from dropdowns (or, in amendment mode, spot and fix the wrong box on the strip), submit once, and
see each element graded with the SOP or 7110.65 rule that decided it.

For simulation use only. Not for real-world navigation or ATC.

## Layout

| path | what |
|---|---|
| `web/` | Vite + TypeScript static app. The rules engine lives in `web/src/rules/` and grades in the browser. |
| `generator/` | Python (uv) generator that turns FAA CIFP, FAA chart PDFs, and hand-transcribed ZOA SOP tables into `data/<icao>.json`. |
| `data/` | Checked-in airport data consumed by the app, plus the JSON Schemas exported from the zod definitions. |
| `fixtures/` | Expected clearances for trainer worksheet plans and synthetic edge cases. Run as tests. |
| `docs/` | Architecture and plans. Start at `docs/plans/MAIN.md`. |

## Develop

```sh
# web
pnpm -C web install
pnpm -C web dev

# generator
cd generator && uv sync
uv run craft-gen build --airport KSFO --check
```

Pre-commit hooks: `prek install` once, then `prek run` before committing.
