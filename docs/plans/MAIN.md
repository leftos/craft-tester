# Plan index

<!-- plan-doc-hygiene: 2026-09-18 1c4837d -->

Entry point for anyone continuing this work. **Open items in full, one line per landed step.** When an
item lands, replace it here with one line and move its record to `archive/`. Open work is grouped into
waves: one release-sized bundle sharing owning files, so one implementer reads those files once and one
review gate covers the bundle.

Records: [archive/2026-09-18-plan-record.md](./archive/2026-09-18-plan-record.md) (2026-09-17 → 2026-09-18:
free text, the TEC override, tester feedback, typed names),
[archive/2026-09-17-plan-record.md](./archive/2026-09-17-plan-record.md) (everything landed
2026-09-16 → 2026-09-17, with the corrections the hygiene pass found) and
[archive/2026-09-16-plan-record.md](./archive/2026-09-16-plan-record.md) (everything before it). Design,
data facts and rationale now live in [ARCHITECTURE.md](../ARCHITECTURE.md) ("Why it is built this way"
and "Amendment mode") and [ADDING_AN_AIRPORT.md](../ADDING_AN_AIRPORT.md) ("Lessons from KOAK"); the
finished subplans behind them are in `archive/`.

**State 2026-09-18.** Both airports are live. Tester feedback from AJ Norell (typed spelling, what a red
row says, the pinned strip) landed the same day and left nothing open; the user's own typed-answer reports
(names, case, joined numbers, spelt identifiers) landed after it, and AJ's full-route-clearance mode
landed the same day as a header checkbox. The generator-data wave closed 2026-09-18 with the TEC
override ([archive/tec-override.md](./archive/tec-override.md)). KOAK is closed at 51 of 51 fixtures
settled. KSFO stands at 67 of 100 settled, with **33 pending, all amendment plans** (19 of its 52 amendment fixtures settled;
all 18 phraseology fixtures settled). The user paused that loop 2026-09-16 — "I can point out any mistakes
I notice or that users find as they come up". Free-text entry landed 2026-09-17. AJ's two reports of
2026-09-19 (a route longer than the strip, "nine" against "three" and "five") landed the same day, as did
the afternoon's two (a navaid without its facility word, a SID code typed as a word).

## Wave 1 — Airway structure for conventional rebuilds (`generator/src/craft_generator/cifp/`, then the engine)

Subplan: [airway-structure.md](./airway-structure.md). Gate: aviation + a data concept the user rules on.

- [ ] The RNAV element check leaves a non-RNAV plan with no conventional route in the data; the J and V
  airway structure would let the engine rebuild one. Surveyed 2026-09-17: parse the CIFP `ER` records the
  generator already downloads (ordered fixes plus high/low, conventional/RNAV, MEA/MAA); the vNAS
  `NavData.dat` carries only `id + fixes` and has 224 colliding ids (`J1`, `V6` resolve to foreign routes
  first-wins). No airway parsing exists in `cifp/` today — only the three-row hand-written
  `shared/airways.yaml`. **Data concept and the rebuild rule still to plan with the user before any engine
  change**; the subplan's three questions are open

## Wave 2 — Destination amendment box (schema, `rules/amend/`, `ui/`, importer, `shared/destinations.yaml`)

Gate: aviation + UI. The only rule concept KOAK left unbuilt.

- [ ] **New concept (user 2026-09-16): a fourth strip box for the destination.** AAY218 on Amendment
  Practice 1A files `KPGI` with `KGPI` as the correction; the strip has type, altitude and route boxes
  only. The user chose a fourth box over importing the plan as corrected. Needs: schema
  (`amendments[].box: 'destination'`, fixture variant), a destination check in `rules/amend/` (**decide
  with the user**: an unknown ICAO whose one-letter-transposed neighbour is in the library, or the sheet's
  answer only), the amendment UI box, the results view, and the importer's correction-cell reading. KGPI
  is in the CIFP cache but not among the 68 rows of `shared/destinations.yaml`, so it needs a data row too

## Wave 3 — KSFO worksheet settlement (`fixtures/ksfo/worksheets/`, `web/scripts/propose.ts`)

Paused by user steer 2026-09-16; resume with `pnpm -C web propose --pending`. Gate: aviation, one fixture
at a time with the user. Settling a fixture is a YAML edit plus `craft-gen build`, never an engine edit.

- [ ] **33 pending KSFO amendment fixtures** — 9 in Practice 1C (`lxj351`, `n172sp`, `n238jp`, `skw2345`,
  `swa126`, `swa1859`, `swa1883`, `swa1984`, `xoj715`), 11 in Practice 2 (`aay1002`, `fdx3859`, `fdx3875`,
  `jsx203`, `n858ee`, `nax7068`, `qxe2415`, `swa1922`, `swa2021`, `swa556`, `swa888`), 13 in Practice 3
  (`eja115`, `n222t`, `n346g`, `n436ms`, `n471ry`, `n739ml`, `n918ar`, `nks510`, `pxt415`, `swa1254`,
  `swa1585`, `twy313`, `voi5909`). Four are proposed but unconfirmed in 1C: LXJ351 as filed, N172SP TEC
  full route, N238JP SNTNA2 + FL310, SKW2345 `GAPP7 CCR CCR2`. Several are KSFO twins of KOAK rulings
  already settled (FDX3875 oceanic parity; JSX203 and N858EE move the same way as their twins)
  - [ ] **SWA2021 is unresolved, not merely pending**: its KPDX `DEDHD LMT OCITY#` route left the library
    because the Portland LOA never allowed it, and nothing filed reaches MACHU. Needs a ruling, not a
    proposal

## Singles

- [ ] **Scheduled workflow that re-runs the generator each AIRAC cycle and opens a PR.** Nothing scheduled
  exists (`.github/workflows/` holds `ci.yml` and `pages.yml` only); the cycle math is in
  `cifp/cycle.py`. Mapped 2026-09-18: `build` fetches everything it needs through the cache and takes one
  `--airport` at a time (loop over `data/airports.json`); its output is byte-stable, so a PR diff is the
  cycle's real changes; actions are pinned by full sha with `persist-credentials: false`. **Two decisions
  for the user before a brief**: the repo has no PR-opening pattern (no workflow holds
  `pull-requests: write`; pick the token and the action), and `build` verifies the SOP PDF, which
  ADDING_AN_AIRPORT.md says is placed in the cache by hand, so an unattended runner may not be able to
  build. Also undecided: `build` without `--cycle` takes the cycle containing today, which can 404 on
  the effective date if the FAA publishes late
- [ ] **ADDING_AN_AIRPORT.md says CI runs `craft-gen build --check`; it does not** (`ci.yml` runs only
  `import-worksheets --check` over the network). Correct the runbook, or add the step once the AIRAC
  workflow settles how CI reaches the cache
- [ ] **Playtest observation awaiting a ruling** (2026-09-16, still true): the standing `SFO-SEGUL-OFF`
  notice is `default_active: true` and notices are cancelled only 20% of draws (`NOTICES_OFF_CHANCE`), so it
  is in force on 80% of scenarios. Is that too often? (The second observation, the on-request draw, was
  ruled 2026-09-18 and landed with the TEC override, [archive/tec-override.md](./archive/tec-override.md) ruling 7.)
- [ ] **Dictation for free-text entry.** Browser speech recognition (Chrome and Edge only, not Firefox)
  feeding the free-text box, with feature detection. The user left it out of the first cut on 2026-09-17
  ([archive/free-text.md](./archive/free-text.md) decision 9)

## Landed

One line per step; the full record and the user decisions behind each are in the archive freezes.

- [x] 1–13. Scaffolds, schema, CIFP, charts, SOP transcription, aircraft classes, merge/emit, rules engine,
  synthetic fixtures, `options`/`grade`/`speak`, seeded scenario generator — by 2026-09-15
- [x] 14. UI: strip, ATIS, CRAFT form, results, seed in URL hash — 2026-09-15, steered through 2026-09-16
- [x] 15. CI + GitHub Pages, docs finalized — 2026-09-16; Pages at <https://leftos.github.io/craft-tester/>
- [x] 16. `import-worksheets`: seven Google Docs → 70 pending fixtures (18 phraseology + 52 amendment)
- [x] 17. Validation loop, clearance mode: all 18 KSFO phraseology plans settled — 2026-09-15
- [x] 18. TEC routes, LOA rules, equipment suffixes, destination coordinates (the fleet service ceiling
  that shipped with it was removed again by the SWA1984 ruling)
- [x] 19. Amendment engine — 2026-09-15; design promoted to ARCHITECTURE.md "Amendment mode"
- [x] 20. Amendment scenario generator, amendment UI, mode switch — 2026-09-15
- [x] Heading departures, `R-HEADING`, and the "via" that introduces a heading — 2026-09-16
- [x] The type box is corrected first and the other boxes are judged on that plan — 2026-09-16
- [x] "Climb via SID except maintain" for a filed altitude below a SID's published top — `c89f636`
- [x] SFO5's 01-side crossing restriction, so the 01s read "except maintain" and the 28s "maintain"
- [x] `when.forcedTransition` (the NIITE# GOBBS noise row), honoured as a route amendment — 2026-09-16
- [x] CIFP continuation-record guard in the navaid and airport parsers — `0677d5c`
- [x] "Then as filed" only where the amended route keeps a trailing substring of the filed one
  (`R-THEN-AS-FILED`) — 2026-09-16
- [x] "(Altitude) will be your final" in place of the expect clause, and the longer amended reading graded
  acceptable beside it (`A-FINAL`) — 2026-09-16
- [x] A controller does not apply an aircraft's service ceiling — `bd295a7`
- [x] Route building before the vector-SID fallback, over a shared connection table — 2026-09-16
- [x] CRAFT phraseology rows are national, not per-airport: `shared/phraseology_rules.yaml`, overridden by
  id (16 rows at landing, 38 on 2026-09-19) — 2026-09-16
- [x] Arrival swap: a flight is routed onto an arrival its equipment can fly, per the LOA and the ZOA
  common-arrivals sheet, with the `half` verdict for the box that misses only the arrival — 2026-09-17
- [x] Equipment suffixes: TBL 2-3-10 citations, `/H` and `/O` as navigation-unknown, `T-MODE-C` and the
  `no_mode_c` fault (every VATSIM aircraft simulates Mode C), and the SOP table order outranking the filed
  family in route building — 2026-09-17
- [x] The scenario link carries the airport (`a=<ICAO>`) — `856b4b8`
- [x] Amendment form inputs: the caret no longer jumps to the end, and the NEW VALUE box starts holding the
  filed value — `856b4b8`
- [x] The flight plan is drawn as a vStrips-style flight strip, with the FAA CWT letter as the wake prefix
  — `4c7232c`, `d189b6a`
- [x] Read-aloud picks a voice that actually speaks in Firefox on Windows — `9f291d7`
- [x] A read-aloud icon button on each spoken-clearance box — `b1ef6e9`
- [x] A comma after an airway before the fix it leads to, for pacing — `a3ba7b6`
- [x] RNAV airways and RNAV waypoints need the suffix that flies them (`R-RNAV-AIRWAY`,
  `R-RNAV-WAYPOINT`, the `rnav_element` fault) — `d06779a`, `9147f8b`
- [x] A one-way oceanic airway is exempt from odd/even parity — `cd341df`
- [x] A radar-vector SID carries the airport navaid in the filed route, and a missing one is a warning
  rather than a scored error (`R-RV-NAVAID`) — `e5f0f99`
- [x] The two KOAK notices (QUAKE and SUNNE off, with their substitute headings) — `3ee592d`
- [x] Reading a filed route the pilot typed badly: read past the structure the SID already flies over
  (`R-SID-STRUCTURE`), and drop an element that names nothing, connecting the gap (`R-ROUTE-TOKEN`) —
  `3117367`, `5a86e63`
- [x] v3: KOAK as the second airport — closed 2026-09-17 at 51 of 51 fixtures settled; the rule concepts
  it introduced are in ADDING_AN_AIRPORT.md "Lessons from KOAK"
- [x] Browser-check tooling: `CRAFT_PREVIEW_URL` picks the preview, so two builds can be checked at once, and
  a button with no text lists by its `aria-label` — 2026-09-17
- [x] The strip's revision number is left-aligned under the callsign — 2026-09-17
- [x] The answer form is built once per phase and synced in place (render model in ARCHITECTURE.md) — `761fa10`
- [x] An airline-default runway row must list a class that airline flies (`_check_runway_defaults`) — `fdf310f`
- [x] `LoaData.sources` deleted; the LOA letter URLs are a comment in `shared/loa_rules.yaml` — `fdf310f`
- [x] An empty amendment-worksheet cell names its row and column instead of shifting the sheet — `a2fdec4`
- [x] A CIFP `VD` leg is an initial climb; COAST9 and NUEVO8 take `climb_via_eligible` — `4ed6aaa`
- [x] KOAK's family 10 maps to 10L (user ruling) — `4ed6aaa`
- [x] `merge._check_approach_categories` deleted (could never fire) — `4ed6aaa`
- [x] A built route that reads past the departure's structure cites `R-SID-STRUCTURE` and names the SID — `f855c1a`, `22d3b6e`
- [x] The `half` verdict stays fixture-only (user, 2026-09-17; why in ARCHITECTURE.md) — `7ffacd0`
- [x] `A-ONE-WAY-AIRWAY`: a one-way airway is read against TBL 4-5-1's one-way row in place of parity — `303bbdd`
- [x] Cleanup: shared `navaid_names.yaml`, `build --coverage` report, one FL410 constant, dead test gone — `0f5cc02`, `b80a614`
- [x] Stack review: keep the Python-generator / TypeScript-web split (ARCHITECTURE.md says when it reopens) — 2026-09-17
- [x] v2: free-text clearance entry, graded element by element, in both modes — 2026-09-17 ([archive/free-text.md](./archive/free-text.md))
- [x] Amendment results: the split score line, `preferred:` and `acceptable (airport navaid)`, each verdict's `why:`, the amend grid — 2026-09-17
- [x] The corrected strip and the CRAFT clearance follow the student's plan (`studentPlan`, `clearedPlan`) — 2026-09-17
- [x] Cleanups: `selectControl` sets its value after its options; `clearedPlan` caches per view and answers — `59fe3dc`
- [x] Worksheet corrections (`corrections:` in `worksheets.yaml`); N436MS files its TEC route — `4135d64`
- [x] A TEC route overrides the SOP's departure (rulings 1–12, `RWY-TEC`) — `5e46ff8`, `e7333d2`, `e7b6245` ([archive/tec-override.md](./archive/tec-override.md))
- [x] Radar vectors direct and `RH`/`RV`/`Hnnn` in TEC routes; the TEC row grammar in the build — `210fad9`
- [x] Tester feedback, AJ Norell: near-miss spelling (`S-SPELLING`), missed words marked, the strip pinned, `scroll:<px>` — `93d164f`
- [x] A typed clearance without its expect clause keeps its F (the alignment tie-break) — `8fdd6f0`
- [x] A results row says what was wrong; the remark labels are matcher constants, not YAML rows — `ae2218d`
- [x] Typed names: any case, full/short/also field names, joined numbers, `R-RV-AIRWAY`, spelt fixes — `b3d2405`, `17c68b7`, `7763420`, `4cc29fe` ([archive/typed-names.md](./archive/typed-names.md))
- [x] Cleanup after typed names: the joined-airway label says "airway"; an unread field goes — `25ff3d7`
- [x] Full route clearance mode (AJ Norell and the user): a typed-answer checkbox in both modes, `R-FRC`, `FRC` on the strip, `r=full` — `458fe43` ([archive/full-route-clearance.md](./archive/full-route-clearance.md))
- [x] The joined airway is spoken bare, "radar vectors to join Victor six": the word "airway" reversed the same day (7110.65 2-6-4, 4-4-1 a, 2-5-1 a) — `0de5e2d`
- [x] Tester feedback, AJ Norell, 2026-09-19: a strip that trimmed its route behind `***` prints the whole filed route on an `RTE` line under the paper, in both modes (the user chose it over a taller strip, an always-on line and a tap to expand) — `811e66a`
- [x] Tester feedback, AJ Norell, 2026-09-19: "nine" for the digit is acceptable, not a miss, the row still saying to say niner (user ruling, against TBL 2-4-1 listing NIN-ER beside TREE and FIFE; `S-NINER`) — `6019db8`
- [x] Tester feedback, 2026-09-19: a route navaid said without its facility word is acceptable, not a miss
  (user ruling on "VOR should not be required … not the clearance limit"; 7110.65 2-5-2 a 2;
  `R-FACILITY-WORD-OMITTED`), and a SID's family code typed as a word reads as its name ("gapp seven" is
  "Gap Seven") — `46ae72b`
- [x] Score line: "inefficient" (a reading longer than it needed to be) and "acceptable" (no longer:
  "nine", a facility word left out) counted apart; inefficient is also acceptable (user steer 2026-09-19)
  — `b795f3c`
- [x] A word said in a left-out facility word's place is a miss, not acceptable (user ruling 2026-09-19)
