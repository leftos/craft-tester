# Plan index

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

- [ ] **Stop re-rendering the input panels.** `mount` in `ui/app.ts` replaces the whole page on every
  state change and `restoreFocus` puts the caret back afterwards; that workaround already produced the
  caret-jumping bug of 2026-09-17, and a free-text box (long value, selection, scroll, IME composition,
  dictation) would make every input a `restoreFocus` case. Render the answer form once per scenario and
  update only the results panel and the strips from state, so the inputs are never replaced; then
  `restoreFocus` and `focusedInput` go. No new dependency. Fall back to Preact or Solid for `ui/` only if
  that refactor needs a hand-rolled diff; the engine and scenario code are pure and stay as they are
  either way
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
  *longer* form. Also: the UI never shows an amendment's `reason`, only its citations, though `reason` is
  required on three amendment shapes in the schema (`ui/session.ts:79` shows it for unresolved items only)
- [ ] **Should the corrected strip follow the student's box when it was right?** Today `ui/session.ts:112`
  reads `drawn.result.corrected`, the engine's plan, always. Seed 83: a student who fixes the route box
  alone still scores 3 of 3, but the corrected strip shows the engine's type-side fix (`E75L/L` with the
  filed TRUKN2 route), which a student who fixed the route may find surprising. Raised at the 2026-09-15
  playtest and never answered
- [ ] **Route row alignment.** The route row's answer and new-value controls start further right than the
  other two rows'; a grid instead of a flex row would align them, at the cost of the narrow boxes. Left as
  a choice for the user 2026-09-16

## Wave 3 — Amendment engine reachability and citations (`web/src/scenario/amend.ts`, `web/src/rules/amend/`)

Two gaps where the engine is right but the drill cannot reach it. Gate: aviation + engine.

- [ ] **The `half` verdict tier is unreachable from a draw.** `scenario/amend.ts` has twelve fault kinds
  and none is arrival-related, so 4,000 KSFO amendment seeds produce no arrival swap (browser check
  2026-09-17) and the tier is exercised by fixtures and unit tests only. Add an `arrival_swap` fault kind
- [ ] **`builtExpectation` does not carry `dropped`.** `rules/amend/route.ts:930` cites `R-SID-STRUCTURE`
  off `expected.dropped`, but `builtExpectation` (:213) passes only `repair` through, so a route that is
  both built and structure-prefixed would drop tokens without citing the row that allows it. No fixture
  reaches it yet

## Wave 4 — Generator data defects (`generator/src/craft_generator/`, `generator/shared/`, `generator/airports/koak/`)

Findings recorded while KOAK landed, none acted on. Gate: generator.

- [ ] **Five altitude restrictions in `data/koak.json` carry `"fix": ""`** (`"between" 1400/2000`), so a
  restriction exists with nothing to hang it on. KSFO has none. Fix in the chart-text/restriction parser
- [ ] **`merge._check_approach_categories` can never fire**: `_fleet_entry` always writes
  `_approach_category(...)`, which raises when it cannot resolve, so the `missing` list is always empty and
  the guard at `merge.py:1092` is dead. Delete it, or move the check ahead of `_approach_category`
- [ ] **`A-ONE-WAY-AIRWAY` is cited nowhere**, so the reveal cannot say why a level stood on a one-way
  oceanic airway
- [ ] **`LoaData.sources` is joined but never emitted**
- [ ] **Never-routed TEC rows**: `TEC-KMRY-SFOE-J`, `TEC-KWVI-SFOE-J`, `TEC-KSJC-SFOE-J` at KOAK and
  `TEC-KLVK-SFOW-JT-01`, `TEC-KOAK-SFOE-TP` at KSFO; eight KOAK library rows are clean nowhere
- [ ] **TEC rows that name no fix** (`RH RV`, `OAK6 RV`, `H090 RV`)
- [ ] **`direction_runway_preference` maps family 10 to 10R** against the 10L prop default
- [ ] **Nothing checks that an airline-default row lists a class that airline flies**
- [ ] **The amendment worksheet parser counts five non-blank cells**, so an empty plan cell shifts every
  later row

## Wave 5 — Browser-check tooling (`web/scripts/browser-check.ts`)

Gate: tooling.

- [ ] **The preview port is hardcoded** (`const BASE = 'http://localhost:4173/craft-tester/'`, :24), so two
  previews cannot be checked at once. Make it an env var
- [ ] **An icon-only button lists as a blank entry**: the button mapper reads `textContent`, and an
  `iconButton` has only an SVG, so it prints empty. Fall back to `aria-label`

## Wave 6 — Airway structure for conventional rebuilds (`generator/src/craft_generator/cifp/`, then the engine)

Subplan: [airway-structure.md](./airway-structure.md). Gate: aviation + a data concept the user rules on.

- [ ] The RNAV element check leaves a non-RNAV plan with no conventional route in the data; the J and V
  airway structure would let the engine rebuild one. Surveyed 2026-09-17: parse the CIFP `ER` records the
  generator already downloads (ordered fixes plus high/low, conventional/RNAV, MEA/MAA); the vNAS
  `NavData.dat` carries only `id + fixes` and has 224 colliding ids (`J1`, `V6` resolve to foreign routes
  first-wins). No airway parsing exists in `cifp/` today — only the three-row hand-written
  `shared/airways.yaml`. **Data concept and the rebuild rule still to plan with the user before any engine
  change**; the subplan's three questions are open

## Wave 7 — Destination amendment box (schema, `rules/amend/`, `ui/`, importer, `shared/destinations.yaml`)

Gate: aviation + UI. The only rule concept KOAK left unbuilt.

- [ ] **New concept (user 2026-09-16): a fourth strip box for the destination.** AAY218 on Amendment
  Practice 1A files `KPGI` with `KGPI` as the correction; the strip has type, altitude and route boxes
  only. The user chose a fourth box over importing the plan as corrected. Needs: schema
  (`amendments[].box: 'destination'`, fixture variant), a destination check in `rules/amend/` (**decide
  with the user**: an unknown ICAO whose one-letter-transposed neighbour is in the library, or the sheet's
  answer only), the amendment UI box, the results view, and the importer's correction-cell reading. KGPI
  is in the CIFP cache but not among the 67 rows of `shared/destinations.yaml`, so it needs a data row too

## Wave 8 — KSFO worksheet settlement (`fixtures/ksfo/worksheets/`, `web/scripts/propose.ts`)

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
- [x] Stack review 2026-09-17: keep the Python-generator / TypeScript-web split. The generator is an
  offline ETL over fixed-width CIFP, scrambled chart PDFs, Google Docs text and an FAA spreadsheet, where
  pypdf, openpyxl and pyyaml are the shortest path; the web half must run as a static page, so the rules
  engine is TypeScript in the browser; the seam is the zod schema and its checked-in export, with no logic
  duplicated across it. The one finding was the UI render model, which is Wave 1. **The answer reopens
  only if** a backend appears (accounts, shared progress, one deployment serving many facilities) or
  dictation moves off the browser's Web Speech API
