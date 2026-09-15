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
- [x] 9. Merge + emit + integrity checks; first `data/ksfo.json` (findings: 40 gate fixes have no route yet, incl. GOBBS and the SID base fixes; `climbViaEligible` must also count a published top altitude (SNTNA2); schema gained `airport.lat/lon`, `sids[].baseFix`, `scenario.activeNotices` for the engine — generator must emit the first two)
- [x] 10. Rules engine core + table tests + exhaustive enumeration test (5,304 of 5,376 combinations resolve; the 72 left are the non-DP runway-heading noise row, which v1 does not clear — the generator must avoid P non-RNAV off 01 at night). Validation questions raised: the late-night "NIITE# GOBBS" south row is dead data (NIITE4 has no south transition; the engine would have to amend the route, an amendment-mode concept); MOLEN9 is reachable only when MOLEN is filed as the exit fix since ENI is a north gate
- [ ] 11. Synthetic fixtures + fixture runner
- [ ] 12. `options`, `grade`, `speak` (`grade` and `speak` done; `options` pending; full-route reading repeats the vector fix for radar-vector routes, fix with `options`)
- [ ] 13. Scenario generator (seeded) (`rng` done; `generate` pending)
- [ ] 14. UI: strip, ATIS, CRAFT form, results, seed in URL hash
- [ ] 15. CI + GitHub Pages (workflows landed, pinned SHAs, actionlint + zizmor clean); finalize README, ARCHITECTURE, CLAUDE.md at the end
- [x] 16. `import-worksheets`: seven Google Docs → 70 pending fixtures (18 phraseology + 52 amendment) in `fixtures/ksfo/worksheets/`. Departure runway defaults to the config's first runway pending validation. Findings for the validation loop: UAL313 files `/Q` (not in FAA table 5-4-1, so treated as non-RNAV; likely a deliberate wrong box) and `BVLQ124` (sheet typo); four rows are truncated in the source (KAL65 ×2, NAX7068, VOI5909)
- [ ] 17. Validation loop, clearance mode (one at a time with the user, then batch)
- [x] 18. TEC routes, LOA rules, equipment suffixes, destination coordinates, fleet ceilings (`data/ksfo.json` now carries 49 TEC/ADR rows and 4 LOA rules; the build fails when a TEC row's leading DP is not published for the runway family it departs. `routes.yaml` gained KSAC/KOAK/KSJC for the TEC rows and KVNY/KSNA/KLGB because the ZOA–ZSE LA-basin LOA row names them; none of the six has a `routes` entry yet, so they cannot be drawn as scenarios. The build summary line does not count TEC/LOA rows)
- [ ] 19. Amendment engine
- [ ] 20. Amendment scenario generator + UI + mode switch
- [ ] 21. Validation loop, amendment mode

## Inputs to fold into the rules (user steer 2026-09-15)

- [x] Parse the ZOA CBT module `d14ccce0-8840-11e8-a6af-2a32edb55910` (S1-SFO-0 deck, Google Slides `1yqKhIdUYZlHxmA-mWC_UIX1A1jb7kuMJO3vu_ApTbV8`) into rule rows: done in `generator/airports/ksfo/sop.yaml` and `overrides.yaml` (altitude rows now `climb_via` when a top altitude is published; props → GAPP; SSTIK 1L-only, TRUKN 1R/28s; runway-by-turn preference; staffing fallbacks; no-SID rule)
- [x] Review the S1-SFO-T Major Ground exam results (module `25f8acdc-1afc-11ea-872b-2a32edb55910`): 24/25, the miss was a taxi-route question. Exam questions are not copied into this public repo; the clearance rules they test (28 RT → SSTIK must become WESLA; 28 SO → TRUKN must become SNTNA; SFOE → SSTIK/WESLA become SAHEY, SNTNA/TRUKN become CIITY; heavies may take 28L in 28/01 on request; SAN via the offshore SID) are covered by rule rows and go into synthetic fixtures in step 11

- [x] Operational notice (user, 2026-09-15): "SFO/OAK SEGUL/COAST SID: OFF — issue SSTIK#/WESLA#/CNDEL# YYUNG, CFG SFOW". Modelled as `notices[]` with a `sid_off` effect in `sop.yaml`; the engine skips assignment rows for an off SID so the SSTIK/WESLA YYUNG rows take over. Scenarios can show the notice on the ATIS panel and drill both states.
- [x] User steer 2026-09-15: only TEC routes are obligatory, and only for destinations inside contiguous NCT. Area E CA (the Sacramento sectors: SMF, SAC, MYV, OVE) is contiguous; Area E NV, also called Area R (Reno and satellites), is separated from the rest of NCT by Oakland Center airspace and gets no TEC route. AAR/ADR routes are advisory. Encoded as `tecRoutes[].kind: tec | adr`; amendment mode must flag a missing TEC route only for `kind: tec` rows and only when the destination is `nct: true` (KRNO and the Area R satellites stay `nct: false`)
- [ ] OAK notices for the second-airport backlog: "OAK QUAKE SID: OFF — issue 270 HDG RV first fix for 12/10 jet departures, CFG OAKE"; "OAK SUNNE SID: OFF — issue 120 HDG RV first fix for jet 30 departures, CFG SFOW noise abatement"

## Blockers

None. Worksheets are public Google Docs (ids in the subplan); no browser needed to fetch them.

## Backlog

- [ ] Second airport (OAK or SJC) as a data-only addition to prove the boundary
- [x] Callsign telephony table for the spoken reveal (`routes.yaml` `telephony`; schema field `routeLibrary.telephony` added in step 9)
- [ ] Scheduled workflow that re-runs the generator each AIRAC cycle and opens a PR

## Open questions (settled by the validation loops, recorded as data toggles)

See "Open questions" in [craft-trainer-v1.md](./craft-trainer-v1.md#open-questions-to-settle-from-the-worksheets-encoded-as-data-toggles-not-code).
