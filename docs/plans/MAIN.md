# Plan index

<!-- plan-doc-hygiene: 2026-09-17 fd05a17 -->

Entry point for anyone continuing this work. **Open items in full, one line per landed step.** When an
item lands, replace it here with one line and move its record to `archive/`. Open work is grouped into
waves: one release-sized bundle sharing owning files, so one implementer reads those files once and one
review gate covers the bundle.

Records: [archive/2026-09-17-plan-record.md](./archive/2026-09-17-plan-record.md) (everything landed
2026-09-16 → 2026-09-17, with the corrections the hygiene pass found) and
[archive/2026-09-16-plan-record.md](./archive/2026-09-16-plan-record.md) (everything before it). Design,
data facts and rationale now live in [ARCHITECTURE.md](../ARCHITECTURE.md) ("Why it is built this way"
and "Amendment mode") and [ADDING_AN_AIRPORT.md](../ADDING_AN_AIRPORT.md) ("Lessons from KOAK"); the
finished subplans behind them are in `archive/`.

**State 2026-09-17.** Both airports are live. KOAK is closed at 51 of 51 fixtures settled. KSFO stands at
67 of 100 settled, with **33 pending, all amendment plans** (19 of its 52 amendment fixtures settled;
all 18 phraseology fixtures settled). The user paused that loop 2026-09-16 — "I can point out any mistakes
I notice or that users find as they come up". Free-text entry landed 2026-09-17.

## Wave 1 — Generator data defects (`generator/src/craft_generator/`, `generator/shared/`, `generator/airports/koak/`)

Findings recorded while KOAK landed. Gate: generator. Surveyed 2026-09-17; the survey corrected three
of them, noted inline. Four landed the same day and are in Landed below.

- [ ] **A TEC route overrides the SOP assignment**: subplan [tec-override.md](./tec-override.md). All
  rulings are in (user 2026-09-17, and 2026-09-18 for its scope). The override is blanket: "The only time
  the TEC route can't override is if the SID it suggests literally cannot be used with the only available
  runways". Equipment, noise-abatement headings and notices still win, and the draw picks a runway the TEC
  SID is flown from. The measurement found 71 rows losing flights, not five. **Next: brief 1** (the engine
  override), whose fixture report goes to the user before brief 2 (the runway draw and the on-request fix)
- [ ] **TEC rows that name no fix.** **Correction: `RH RV`, `OAK6 RV` and `H090 RV` are not in the repo** —
  they were deliberately left out of `koak/tec.yaml:112-113` and the decision is recorded at
  `archive/koak-v3.md:395`. What is left is a guard: nothing stops such a row being transcribed, and
  `_check_fix_spoken` would fail on `RV` while silently teaching the speaker to read `RH` as "Arsha NDB",
  a real navaid. **Attempted 2026-09-17 and stopped — the guard is harder than this line had it:**
  - **A shape test does not catch the rows that motivate it.** `RV` matches `_NAVAID_TOKEN`
    (`[A-Z]{2,3}`, `merge.py:123`), so `RH RV`, `OAK6 RV` and `H090 RV` all *pass* "is there a fix after
    the head". Only "nothing after the head" and "only airways after the head" fail. Catching them needs a
    vocabulary of non-fix markers (`RV`, and `RH`, which is the very navaid the trap is about), and
    "rules are data" makes its home a decision too: a frozenset in `merge.py` or a row in shared YAML
  - **The narrow version fires on live data.** `TEC-KOAK-SFOE-TP` (`ksfo/tec.yaml:72`) is the bare
    `GAPP#`, a head with nothing after it, so KSFO would stop building. **Ruled 2026-09-18**
    ([tec-override.md](./tec-override.md) ruling 3): that row reads `GAPP7 SFO`, so a bare radar-vector
    SID head is a legal row and the guard must accept it. The guard waits for the override to land

## Wave 2 — Airway structure for conventional rebuilds (`generator/src/craft_generator/cifp/`, then the engine)

Subplan: [airway-structure.md](./airway-structure.md). Gate: aviation + a data concept the user rules on.

- [ ] The RNAV element check leaves a non-RNAV plan with no conventional route in the data; the J and V
  airway structure would let the engine rebuild one. Surveyed 2026-09-17: parse the CIFP `ER` records the
  generator already downloads (ordered fixes plus high/low, conventional/RNAV, MEA/MAA); the vNAS
  `NavData.dat` carries only `id + fixes` and has 224 colliding ids (`J1`, `V6` resolve to foreign routes
  first-wins). No airway parsing exists in `cifp/` today — only the three-row hand-written
  `shared/airways.yaml`. **Data concept and the rebuild rule still to plan with the user before any engine
  change**; the subplan's three questions are open

## Wave 3 — Destination amendment box (schema, `rules/amend/`, `ui/`, importer, `shared/destinations.yaml`)

Gate: aviation + UI. The only rule concept KOAK left unbuilt.

- [ ] **New concept (user 2026-09-16): a fourth strip box for the destination.** AAY218 on Amendment
  Practice 1A files `KPGI` with `KGPI` as the correction; the strip has type, altitude and route boxes
  only. The user chose a fourth box over importing the plan as corrected. Needs: schema
  (`amendments[].box: 'destination'`, fixture variant), a destination check in `rules/amend/` (**decide
  with the user**: an unknown ICAO whose one-letter-transposed neighbour is in the library, or the sheet's
  answer only), the amendment UI box, the results view, and the importer's correction-cell reading. KGPI
  is in the CIFP cache but not among the 67 rows of `shared/destinations.yaml`, so it needs a data row too

## Wave 4 — KSFO worksheet settlement (`fixtures/ksfo/worksheets/`, `web/scripts/propose.ts`)

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
  `cifp/cycle.py`
- [ ] **Playtest observation awaiting a ruling** (2026-09-16, still true): the standing `SFO-SEGUL-OFF`
  notice is `default_active: true` and notices are cancelled only 20% of draws (`NOTICES_OFF_CHANCE`), so it
  is in force on 80% of scenarios. Is that too often? (The second observation, the on-request draw, was
  ruled 2026-09-18 and ships in [tec-override.md](./tec-override.md) brief 2, ruling 7.)
- [ ] **Dictation for free-text entry.** Browser speech recognition (Chrome and Edge only, not Firefox)
  feeding the free-text box, with feature detection. The user left it out of the first cut on 2026-09-17
  ([archive/free-text.md](./archive/free-text.md) decision 9)

## Landed

One line per step; the full record and the user decisions behind each are in the two archive freezes.

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
  id (16 rows at landing, 26 today) — 2026-09-16
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
- [x] v2: free-text clearance entry — the student types the whole clearance as an alternative to the
  dropdowns, graded element by element with what was said, filler marked; the header's "answer" switch is
  remembered; both modes — 2026-09-17 ([archive/free-text.md](./archive/free-text.md), ARCHITECTURE.md
  "Free-text grading")
- [x] Amendment results: the score line counts the strip ("flight plan checks / amendments") and the
  clearance ("CRAFT clearance elements") apart; a route box missing the airport navaid reads `preferred:`
  and `acceptable (airport navaid)`; each box verdict reads its amendment's `why:`; the amend form's rows
  share a grid — 2026-09-17
- [x] The corrected strip and the CRAFT clearance follow the student's plan: every box graded correct as
  written, every other box as the engine corrected it (`studentPlan`, `clearedPlan`) — 2026-09-17
- [x] Cleanups: `selectControl` sets its value after its options; `clearedPlan` caches per view and answers — `59fe3dc`
