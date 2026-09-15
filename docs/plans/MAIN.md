# Plan index

Entry point for anyone continuing this work. Detailed design, data facts, and rationale: [craft-trainer-v1.md](./craft-trainer-v1.md).

## Current focus

- [x] 1. Scaffold: git, README, CLAUDE.md, ARCHITECTURE skeleton, this index, prek hygiene hooks, dependabot
- [x] 2. Web scaffold: pnpm, Vite + TS (strict flags), oxlint/oxfmt, vitest, exact pins
- [x] 3. zod schema for `AirportData` + `Fixture`, schema export script, sync test, `data/airports.json` (schema needs the SOP YAML's newer fields added in step 9: noise window ids, `exitFixes`/`forcedTransition` conditions, no-DP heading rows, staffing fallbacks, runway-by-turn preference, labelled frequencies, fleet suffixes/airlines, per-runway crossing-restriction flag)
- [x] 4. Generator scaffold: uv project, ruff/ty, `craft-gen --help`, cached HTTP
- [x] 5. CIFP: cycle math, record slicing, SID grouping; 210 KSFO rows as fixture; hypothesis tests
- [x] 6. Charts: API list, PDF download, text extraction; 12 chart-text snapshots (d-TPP text puts a box's value on the line before its label; MOLEN9's transition is named MENDOCINO)
- [ ] 7. SOP transcription (`sop.yaml`, `overrides.yaml`, `routes.yaml`) + loader + hash/sentinel verify
- [ ] 8. Aircraft classes from vNAS
- [ ] 9. Merge + emit + integrity checks; first `data/ksfo.json`
- [ ] 10. Rules engine core + table tests + exhaustive enumeration test
- [ ] 11. Synthetic fixtures + fixture runner
- [ ] 12. `options`, `grade`, `speak` (`grade` and `speak` done; `options` pending; full-route reading repeats the vector fix for radar-vector routes, fix with `options`)
- [ ] 13. Scenario generator (seeded) (`rng` done; `generate` pending)
- [ ] 14. UI: strip, ATIS, CRAFT form, results, seed in URL hash
- [ ] 15. CI + GitHub Pages; finalize README, ARCHITECTURE, CLAUDE.md
- [ ] 16. `import-worksheets`: seven Google Docs → pending fixtures
- [ ] 17. Validation loop, clearance mode (one at a time with the user, then batch)
- [ ] 18. TEC routes, LOA rules, equipment suffixes, destination coordinates, fleet ceilings
- [ ] 19. Amendment engine
- [ ] 20. Amendment scenario generator + UI + mode switch
- [ ] 21. Validation loop, amendment mode

## Inputs to fold into the rules (user steer 2026-09-15)

- [x] Parse the ZOA CBT module `d14ccce0-8840-11e8-a6af-2a32edb55910` (S1-SFO-0 deck, Google Slides `1yqKhIdUYZlHxmA-mWC_UIX1A1jb7kuMJO3vu_ApTbV8`) into rule rows: done in `generator/airports/ksfo/sop.yaml` and `overrides.yaml` (altitude rows now `climb_via` when a top altitude is published; props → GAPP; SSTIK 1L-only, TRUKN 1R/28s; runway-by-turn preference; staffing fallbacks; no-SID rule)
- [x] Review the S1-SFO-T Major Ground exam results (module `25f8acdc-1afc-11ea-872b-2a32edb55910`): 24/25, the miss was a taxi-route question. Exam questions are not copied into this public repo; the clearance rules they test (28 RT → SSTIK must become WESLA; 28 SO → TRUKN must become SNTNA; SFOE → SSTIK/WESLA become SAHEY, SNTNA/TRUKN become CIITY; heavies may take 28L in 28/01 on request; SAN via the offshore SID) are covered by rule rows and go into synthetic fixtures in step 11

- [x] Operational notice (user, 2026-09-15): "SFO/OAK SEGUL/COAST SID: OFF — issue SSTIK#/WESLA#/CNDEL# YYUNG, CFG SFOW". Modelled as `notices[]` with a `sid_off` effect in `sop.yaml`; the engine skips assignment rows for an off SID so the SSTIK/WESLA YYUNG rows take over. Scenarios can show the notice on the ATIS panel and drill both states.
- [ ] OAK notices for the second-airport backlog: "OAK QUAKE SID: OFF — issue 270 HDG RV first fix for 12/10 jet departures, CFG OAKE"; "OAK SUNNE SID: OFF — issue 120 HDG RV first fix for jet 30 departures, CFG SFOW noise abatement"

## Blockers

None. Worksheets are public Google Docs (ids in the subplan); no browser needed to fetch them.

## Backlog

- [ ] Second airport (OAK or SJC) as a data-only addition to prove the boundary
- [x] Callsign telephony table for the spoken reveal (`routes.yaml` `telephony`; schema field `routeLibrary.telephony` added in step 9)
- [ ] Scheduled workflow that re-runs the generator each AIRAC cycle and opens a PR

## Open questions (settled by the validation loops, recorded as data toggles)

See "Open questions" in [craft-trainer-v1.md](./craft-trainer-v1.md#open-questions-to-settle-from-the-worksheets-encoded-as-data-toggles-not-code).
