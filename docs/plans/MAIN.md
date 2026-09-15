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
- [x] 11. Synthetic fixtures + fixture runner (27 fixtures in `fixtures/ksfo/synthetic/`, 25 settled; `fixtures.test.ts` prints what the engine makes of every pending plan: 66 of 70 worksheet plans resolve)
- [x] 12. `options`, `grade`, `speak` (full-route reading repeats the vector fix for radar-vector routes; the expect clause runs straight into the altitude, "flight level three five zero one zero minutes": polish in step 14)
- [x] 13. Scenario generator (seeded): `generateScenario` / `drawScenario`; 7 redraws in 1,000 seeds, all the non-RNAV-prop noise row. Follow-up: `CONFIG_WEIGHTS` in `generate.ts` names KSFO config ids; move the training weight to `runwayConfigs[].trainingWeight` in `sop.yaml` so no code is keyed on KSFO
- [ ] 14. UI: strip, ATIS, CRAFT form, results, seed in URL hash
- [ ] 15. CI + GitHub Pages (workflows landed, pinned SHAs, actionlint + zizmor clean); finalize README, ARCHITECTURE, CLAUDE.md at the end
- [x] 16. `import-worksheets`: seven Google Docs → 70 pending fixtures (18 phraseology + 52 amendment) in `fixtures/ksfo/worksheets/`. Departure runway defaults to the config's first runway pending validation. Findings for the validation loop: UAL313 files `/Q` (not in FAA table 5-4-1, so treated as non-RNAV; likely a deliberate wrong box) and `BVLQ124` (sheet typo); four rows are truncated in the source (KAL65 ×2, NAX7068, VOI5909)
- [ ] 17. Validation loop, clearance mode (one at a time with the user, then batch). `pnpm -C web propose <id>` and `--pending` landed. Questions for the user, from the synthetic fixtures and the worksheet table:
  - [x] A. User decision 2026-09-15, SOP 2-2 a wins over the CBT: northbound GAPP# is runway 28 only, SFO# is runway 01 only, and every northbound row is P/T/J. Drop the CBT row `SFOW-N-GAPP-PROPS`; widen TRUKN/SNTNA rows to P/T/J (still RNAV-gated). Props and turboprops off the 01s filed GAPP7 OAK/SGD get SFO# radar vectors (the TEC table agrees: `SFO# OAK V6 SAC` off 01, `GAPP# OAK V6 SAC` off 28) (dispatched)
  - [x] B. User decision 2026-09-15: SOP wins, GAPP# off the 28s. SNTNA# is not an option for "SFO4 RBL" because RBL is not a SNTNA2 transition; issuing it would need a route amendment, which is amendment mode. The Phraseology 3 sheet ("routes correct") files SFO4 for this heavy; raise with the trainer if the loop shows the sheet meant SFO# (dispatched)
  - [x] C. User decision 2026-09-15: drop the expect clause when the filed altitude equals the assigned one: `phraseology.expect_altitude: only_when_interim_below_filed`. The engine's first reading of that mode dropped the clause on every plain "climb via SID" (no interim to compare); corrected so a plain climb-via compares the filed altitude with the SID's published top altitude (TRUKN2 FL190, filed FL320 → clause kept) (dispatched)
  - [ ] `speak.ts` full-route reading spells a filed SID token letter by letter and calls it an arrival ("golf alpha papa papa Seven arrival" for GAPP7); strip the filed SID token from the full-route reading as `parseFiledRoute` does, and read a real STAR token as "(name) arrival" only when it ends the route
  - [ ] Filed altitude below a SID's published top altitude (TBM9 filed 11,000 on TRUKN2, top FL190): a plain "climb via SID" would climb it past what it filed, so the engine now issues "climb via SID except maintain (filed)" per 7110.65 4-3-2 c 4, with no expect clause (landed in `c89f636`; confirm with the user in the loop)
  - [ ] SFO5 off the 01s: the override says the 01 side has a crossing restriction (SFO 6 DME at or above 3,000), so the engine says "climb via SID except maintain"; the 28 side has none, so "maintain". Confirm with the user on the first worksheet example
  - [x] Worksheet import picks the departure runway from `direction_runway_preference` by the filed exit fix's gate (23 northbound 28/01 plans moved 01L → 01R; UAL320 now resolves to TRUKN2 DEDHD transition, climb via SID)
  - [x] `worksheets.yaml` `type_aliases: {A32N: A20N}` applied on import (2 plans)
  - [ ] `ws-amendment-practice-1a-lxj351` / `-1c-lxj351` are unresolved: the route "GAPP7 EHF LHS V459 SLI V23 OCN" exits at EHF (Bakersfield), which is in no gate. Add EHF to `gates.south` after the SOP-wins data change lands, then 70 of 70 worksheet plans resolve
  - [ ] `when.forcedTransition` (NIITE# GOBBS row) is in the schema and data but no engine module reads it; late-night southbound jets fall through to SSTIK#
  - [ ] `fixtures.test.ts` and the exhaustive test import `@data/ksfo.json` directly; loop over `data/airports.json` before the second airport
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

- [x] User steer 2026-09-15: write `docs/ADDING_AN_AIRPORT.md`, a runbook of every step taken to build the KSFO data so a dev or agent can repeat it for another airport (update it whenever a loader gains a field or a step changes)

## Blockers

None. Worksheets are public Google Docs (ids in the subplan); no browser needed to fetch them.

## Backlog

- [ ] Second airport (OAK or SJC) as a data-only addition to prove the boundary
- [x] Callsign telephony table for the spoken reveal (`routes.yaml` `telephony`; schema field `routeLibrary.telephony` added in step 9)
- [ ] Scheduled workflow that re-runs the generator each AIRAC cycle and opens a PR

## Open questions (settled by the validation loops, recorded as data toggles)

See "Open questions" in [craft-trainer-v1.md](./craft-trainer-v1.md#open-questions-to-settle-from-the-worksheets-encoded-as-data-toggles-not-code).
