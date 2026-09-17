# Plan index

<!-- plan-doc-hygiene: 2026-09-17 05281397349f4d2d1c10c5ef7817407b9e422d7e -->

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
I notice or that users find as they come up" — and queued free-text entry next.

## Wave 1 — Input model and free text (`web/src/ui/app.ts`, then a new input surface)

Queued next by the user 2026-09-17. Gate: UI.

- [ ] **v2: free-text clearance entry** as an **alternative to** the dropdowns (user 2026-09-17: "the
  dropdowns stay and the student chooses"), so students practise without dropdown hints. The student types
  (or dictates) the full spoken clearance; the grader normalises both sides (digits ↔ number words,
  "flight level three two zero" ↔ "FL320", punctuation, optional words such as "airport") and aligns the
  text against the CRAFT elements of `speakClearance` so each element is still graded green/red with its
  citation, plus a per-element diff showing what was said versus expected. Needs a tolerant matcher
  (per-element regex or token alignment), a decision on how strict wording is (accept "climb via the SID"?
  "then as filed" vs "direct"?), and the same seed/URL sharing as v1. Plan as a subplan before starting
  - [ ] **User decision owed before the matcher is written:** the acceptable-but-inefficient verdict is
    where two spoken-only readings belong once text is graded — "then as filed" after a bare exit fix, and
    a full route spelled out where the abbreviated form would do. Are they acceptable or wrong?

## Wave 2 — Amendment UI and the results view (`web/src/ui/{results,session,amendForm,amendPanels}.ts`, `styles.css`)

Three UI questions the engine already answers correctly; all three are presentation. Gate: UI.

- [ ] **An acceptable route box reads backwards for the navaid case.** `ui/results.ts:69` labels every
  `acceptable` verdict `shorter: …` and `:48` counts it "acceptable but inefficient", but where the box is
  acceptable because a radar-vector SID's airport navaid is missing or present, the proposal is the
  *longer* form. `Grade` (`rules/types.ts:193-199`) can already tell the two apart three ways: `element`
  (only `A.expect` and `BOX.route` ever carry `acceptable`, and only the expect clause is genuinely
  shorter), the `R-RV-NAVAID` citation that only the navaid case adds (`amend/grade.ts:230-237`), or a
  token count. `results.test.ts:52-68` and `:88-93` pin the current wording
- [ ] **The UI never shows an amendment's `reason`, only its citations**, though all three amendment shapes
  require it (`schema.ts:778, 801, 813`). Survey 2026-09-17 corrects this index: the earlier note that
  `ui/session.ts:79` shows it "for unresolved items only" was wrong — that line is `Unresolved.reason`
  (`rules/types.ts:158-162`), the engine's "I could not clear this seed" text, an unrelated type. An
  amendment's `reason` is shown nowhere at all
- [ ] **The corrected strip follows the student's boxes where those were right** (user 2026-09-17, choosing
  this over labelling the engine's plan or drawing both strips). Today `ui/session.ts:112` reads
  `drawn.result.corrected`, the engine's plan, always. Seed 83: a student who fixes the route box alone
  still scores 3 of 3, but the corrected strip shows the engine's type-side fix (`E75L/L` with the filed
  TRUKN2 route). Two things the survey says this needs, neither of which exists:
  - [ ] Nothing folds `BoxAnswer`s into a `Scenario`. They are free text; `apply` (`amend/engine.ts:82-87`)
    folds `ResolvedAmendment`s, which carry `proposedFeet`/`proposed`
  - [ ] **Open question for the user before this is briefed:** the graded clearance is resolved from the
    engine's corrected plan at session-build time (`ui/session.ts:112`), and `ARCHITECTURE.md:98-101`
    records why — "the engine's corrected plan, never the student's, so a wrong amendment does not compound
    into a wrong clearance". Drawing the strip from the student's boxes while grading against the engine's
    plan makes the strip and the CRAFT form disagree. Does the strip alone follow the student (display
    only, grading untouched), or does the resolve move too? The recorded rule covers grading, so
    display-only leaves it intact — but ARCHITECTURE.md still needs a line saying the strip is the
    exception
- [ ] **Route row alignment.** The route row's answer and new-value controls start further right than the
  other two rows'; a grid instead of a flex row would align them, at the cost of the narrow boxes. Left as
  a choice for the user 2026-09-16

## Wave 3 — Generator data defects (`generator/src/craft_generator/`, `generator/shared/`, `generator/airports/koak/`)

Findings recorded while KOAK landed. Gate: generator. Surveyed 2026-09-17; the survey corrected three
of them, noted inline. Three landed the same day and are in Landed below.

- [ ] **`A-ONE-WAY-AIRWAY`.** **Correction: the row does not exist** — it was never authored
  (`archive/koak-v3.md:584-593` says so outright), so this is not a missing citation on an existing row.
  The exemption itself works (`amend/altitude.ts:140-143, 246-251`) but drops the parity `Constraint`
  before it is built, and citations are taken only from broken constraints, so an exempted flight produces
  none. **Decided (user 2026-09-17):** author the row beside `A-PARITY` in
  `shared/phraseology_rules.yaml`, and attach it in `amend/grade.ts:305` for the altitude box whenever the
  route is on a one-way airway, so the reveal says why the level stood. Precedent for citing a row on a
  non-amendment verdict is `withNavaidRow` (`amend/grade.ts:231-237`); `altitude.test.ts:180-203` pins the
  current behaviour
- [ ] **`LoaData.sources` is joined but never emitted** (`sop/load.py:1617-1633, 1796`); nothing in
  `merge.py` reads it and `schema.ts` has no field for it. **Decided (user 2026-09-17): delete the dead
  field**, with `joined_loa_sources` and its three assertions in `test_tec_loa_load.py`. The transcribed
  `effective`/`url` go with it; the rows' own `source` prose already names the letters
- [ ] **A TEC route overrides the SOP assignment** — **new rule concept, user 2026-09-17**, given as the
  ruling on the five never-routed TEC rows. **This is an engine change, not a generator fix, so it needs a
  subplan before any code** (repo rule: a correction that cannot be expressed as data adds a rule concept
  to the plan first). Today `issuable` (`rules/amend/tec.ts:55-67`) re-runs `resolveClearance` on the row's
  own route and demands the SOP actually issue the departure the row begins on; under the ruling the TEC
  row wins instead. That alone routes the three KOAK SFOE jet rows (`TEC-KMRY-SFOE-J`, `TEC-KWVI-SFOE-J`,
  `TEC-KSJC-SFOE-J`), which begin `OAK#` while the SOP assigns KATFH#/SKYL# southbound. **Two of the five
  are not fixed by it and still need a ruling:**
  - [ ] `TEC-KLVK-SFOW-JT-01` is shadowed, not unissuable: `TEC-KLVK-SFOW-JT` has `runway_families: []`, so
    it matches every SFOW J/T including the 01s and `find` (`amend/tec.ts:92-99`) takes it first. The
    override does not change which row is found. Needs either a specificity order (most-keyed row wins) or
    a runway family on the looser row. Separately its exit fix ALTAM is in no KSFO gate
    (`ksfo/sop.yaml:164`), though the override may make that moot
  - [ ] `TEC-KOAK-SFOE-TP` is the bare `GAPP#` and names no fix, so `parseFiledRoute`
    (`rules/route.ts:200-202`) rejects it however the row is chosen
  - [ ] Also worth doing whatever is decided: drop the `initialAltitudeFeet` filter at
    `tecAltitudes.test.ts:203`, which today hides three of the five from the unroutable-rows report
- [ ] **TEC rows that name no fix.** **Correction: `RH RV`, `OAK6 RV` and `H090 RV` are not in the repo** —
  they were deliberately left out of `koak/tec.yaml:112-113` and the decision is recorded at
  `archive/koak-v3.md:395`. What is left is a guard: nothing stops such a row being transcribed, and
  `_check_fix_spoken` would fail on `RV` while silently teaching the speaker to read `RH` as "Arsha NDB",
  a real navaid. Add `_check_tec_route_tail` beside `_check_tec_heads`, failing a row whose route names no
  fix after its head — the sentence `rules/route.ts:200-202` already enforces at runtime, moved to build
  time
- [ ] **Nothing checks that an airline-default row lists a class that airline flies.** Extend
  `_check_runway_defaults` (`merge.py:869-890`), the only place the runway rows and the fleet are joined —
  `sop/load.py` validates `sop.yaml` before `routes.yaml` loads, which is why `_check_runway_airlines` can
  only check uniqueness. PCM/`[T]` is consistent today, so this is a guard, not a fix
- [ ] **The amendment worksheet parser counts five non-blank cells**, so an empty plan cell shifts every
  later row. `_cells` (`worksheets.py:260-261`) drops empty lines, so an empty cell disappears rather than
  becoming an empty string, and `parse_amendment_sheet` slices positionally (`:341-364`). One to four
  blanks raise, but the message blames the last row — the wrong end of the sheet; **any multiple of five
  blanks parses silently wrong** and writes corrupt fixtures under callsign-derived filenames. No
  checked-in fixture exercises it

## Wave 4 — Airway structure for conventional rebuilds (`generator/src/craft_generator/cifp/`, then the engine)

Subplan: [airway-structure.md](./airway-structure.md). Gate: aviation + a data concept the user rules on.

- [ ] The RNAV element check leaves a non-RNAV plan with no conventional route in the data; the J and V
  airway structure would let the engine rebuild one. Surveyed 2026-09-17: parse the CIFP `ER` records the
  generator already downloads (ordered fixes plus high/low, conventional/RNAV, MEA/MAA); the vNAS
  `NavData.dat` carries only `id + fixes` and has 224 colliding ids (`J1`, `V6` resolve to foreign routes
  first-wins). No airway parsing exists in `cifp/` today — only the three-row hand-written
  `shared/airways.yaml`. **Data concept and the rebuild rule still to plan with the user before any engine
  change**; the subplan's three questions are open

## Wave 5 — Destination amendment box (schema, `rules/amend/`, `ui/`, importer, `shared/destinations.yaml`)

Gate: aviation + UI. The only rule concept KOAK left unbuilt.

- [ ] **New concept (user 2026-09-16): a fourth strip box for the destination.** AAY218 on Amendment
  Practice 1A files `KPGI` with `KGPI` as the correction; the strip has type, altitude and route boxes
  only. The user chose a fourth box over importing the plan as corrected. Needs: schema
  (`amendments[].box: 'destination'`, fixture variant), a destination check in `rules/amend/` (**decide
  with the user**: an unknown ICAO whose one-letter-transposed neighbour is in the library, or the sheet's
  answer only), the amendment UI box, the results view, and the importer's correction-cell reading. KGPI
  is in the CIFP cache but not among the 67 rows of `shared/destinations.yaml`, so it needs a data row too

## Wave 6 — KSFO worksheet settlement (`fixtures/ksfo/worksheets/`, `web/scripts/propose.ts`)

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
- [ ] **Two playtest observations awaiting a ruling** (2026-09-16, still true): the standing
  `SFO-SEGUL-OFF` notice is `default_active: true` and notices are cancelled only 20% of draws
  (`NOTICES_OFF_CHANCE`), so it is in force on 80% of scenarios — is that too often? And the generator's
  on-request draw does not require a 28-only filed SID the way the importer does
  (`onRequestRunway` keys on class and flight kind only), so seed `f` puts a heavy UPS A306 filing
  `TRUKN CCR CCR2` on 28L in 28/01 with the remark `REQ RWY 28`, and the engine issues GAPP7 radar vectors
  TRUKN at 3,000 because TRUKN is no SNTNA2 transition
- [ ] **The read-aloud voice fix awaits the user's retest on the live site** (landed `9f291d7`, proven with
  a Playwright probe of real Firefox; nothing in the repo is gated on it)

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
- [x] The answer form is built once per phase and synced in place, so a keystroke or a pick no longer
  destroys the control it came from; `focusedInput`/`restoreFocus` are gone and `viewKey`/`phaseOf` decide
  rebuild-or-sync. No UI framework was needed — the forms hold no dynamic lists. `happy-dom` (dev only)
  gives `ui/app.ts`, `ui/dom.ts` and `ui/amendPanels.ts` their first tests, which assert node identity
  across a keystroke — 2026-09-17
- [x] A CIFP `VD` leg is an initial climb, not a crossing restriction, so no SID emits a restriction with
  an empty fix and the `rules/route.ts` filter that worked around five of them is gone; COAST9 and NUEVO8
  take `climb_via_eligible` to hold the "CVS x 10,000" the SOP clears them with. `CD` is the same shape and
  deliberately absent — see CLAUDE.md Footguns — 2026-09-17
- [x] KOAK's `direction_runway_preference` maps family 10 to 10L, the north-field runway its P/T class
  default already names, rather than PAC VALLEY's 10R — 2026-09-17 (user ruling)
- [x] `merge._check_approach_categories` deleted: `_approach_category` writes the key unconditionally and
  raises first, so the guard could never fire — 2026-09-17
- [x] A built route that reads past the departure's own structure cites `R-SID-STRUCTURE`, and the reason
  names the SID whose structure it is — 2026-09-17. Threading `dropped` was not enough: `procedureOutcome`
  returns `builtAmendment` first, which cited the row nowhere. Two KSFO departures answer PORTE to SUSEY,
  so `parseFiledRoute` carries every SID that justifies a drop and the clause names the procedure the box
  proposes where that one is among them, else the SID that does carry it
- [x] The `half` verdict tier stays fixture-only — closed by the user 2026-09-17 after an `arrival_swap`
  fault kind would not draw. **Why, so nobody re-opens it blind:** every eligible library route files
  inside the RVSM band (KSFO's four at 31,000-41,000, KOAK's seven at 29,000-35,000) and the suffix the
  fault writes (`/U`) is not RVSM-approved, so the altitude box is raised too and `sameBoxes` discards the
  draw. A drawn swap needs library routes outside the band that neither airport has. The cheaper mechanism
  if it ever returns: `arrivalTrigger` fires on `filed.arrival.rnav !== ctx.rnavCapable` in **both**
  directions, so filing a conventional arrival for an RNAV flight swaps the arrival with no suffix strip.
  Two survey errors corrected against the source: `rnav_clash` is `['type','route']`, not type-box-only,
  and the common-arrivals sheet lists nine destinations, not eight
- [x] Stack review 2026-09-17: keep the Python-generator / TypeScript-web split. The generator is an
  offline ETL over fixed-width CIFP, scrambled chart PDFs, Google Docs text and an FAA spreadsheet, where
  pypdf, openpyxl and pyyaml are the shortest path; the web half must run as a static page, so the rules
  engine is TypeScript in the browser; the seam is the zod schema and its checked-in export, with no logic
  duplicated across it. The one finding was the UI render model, which is Wave 1. **The answer reopens
  only if** a backend appears (accounts, shared progress, one deployment serving many facilities) or
  dictation moves off the browser's Web Speech API
