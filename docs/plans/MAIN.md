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

**State 2026-09-18.** Both airports are live. Tester feedback from AJ Norell (typed spelling, what a red
row says, the pinned strip) landed the same day and left nothing open. The generator-data wave closed 2026-09-18 with the TEC
override ([archive/tec-override.md](./archive/tec-override.md)). KOAK is closed at 51 of 51 fixtures
settled. KSFO stands at 67 of 100 settled, with **33 pending, all amendment plans** (19 of its 52 amendment fixtures settled;
all 18 phraseology fixtures settled). The user paused that loop 2026-09-16 — "I can point out any mistakes
I notice or that users find as they come up". Free-text entry landed 2026-09-17.

## Current — Typed names (user, 2026-09-18, from a KOAK → KSMF typed clearance)

- [ ] **Airport spoken names.** "cleared to sacramento metro airport" graded acceptable with `metro` as an
  extra word against `expected: cleared to Sacramento airport`. The user points at how
  `C:\Users\Leftos\source\repos\vatsim_control_recs\` (VCR) names airports as the source to pull from
  - Surveyed 2026-09-18: VCR's `data/airport_names.csv` holds display names (`Sacramento Intl`,
    `Las Vegas - Harry Reid`) built from FAA NASR `ARPT_NAME` through spaCy; the same FAA name is in the
    CIFP `PA` record the generator already caches (columns 94–123, `SACRAMENTO INTL`). Neither has "Metro"
  - **User rulings 2026-09-18:** (1) the other names a student may say are hand rows in
    `shared/destinations.yaml` (`also:`), not an import; (2) any listed name is fully correct, with no
    "extra words" remark; (3) the engine speaks the **official** name ("cleared to Sacramento
    International airport"), and the short name becomes an alias; (4) the full FAA name always, also
    where it is a dedication or a compound (Harry Reid International, Oakland San Francisco Bay);
    (5) **the amendment reasons keep the short name** — the full names moved the reason text of 15 settled
    fixtures, so each row carries an explicit `short:` (the old `spoken`), the reasons read it, and no
    settled reason moves. A typed clearance may say `spoken`, `short` or any `also` name
  - Landed so far: `also` through schema, generator and both data files (uncommitted, branch
    `typed-names`). Left: `short` the same way and into the reason builders (`rules/amend/altitude.ts`
    and any other site composing prose from `destination.spoken`); then the grader's name axis, where
    "Sacramento airport" ties the official reading on matches and must still win as the name itself
- [ ] **A typed departure is accepted by its code, as the dropdown offers it.** "nimi6 departure" was graded a
  miss against `Nimitz Six departure` (`missed: "Nimitz" · not in the reading: "nimi"`); a student who picks
  from the dropdown picks `NIMI6`, so the typed box must take it too
  - **User steer, same day: typed text is compared case-insensitively, everywhere.** "We can't be failing
    people based on the capitalization of words." Today `normalise.ts` expands an identifier through the
    lexicon only when typed in capitals (`CAPITALISED_IDENTIFIER`), so `NIMI6` reads "Nimitz Six" and
    `nimi6` reads "nimi 6". The capitals rule goes: `nimi6`, `sac`, `ksmf` expand as `NIMI6`, `SAC`, `KSMF`
    do. The one thing to keep safe is a typed word that is both a lexicon key and a word of the reading
  - **Second report, same day (KOAK → KMCC):** "cleared to kmcc oak6 depature" put `kmcc oak` on C as
    words not in the reading and left R.sid with "6 depature", `missed: "Oakland"`. Same cause: neither
    lower-case code expanded, so both fell in the gap after "cleared to". Check this exact text once the
    case rule lands: `oak6` must land on R.sid as "Oakland Six"; C then misses only the word "airport",
    which S-FILLER already rules a miss (7110.65 4-3-2: the word "airport" must follow the name)

- [ ] **A number typed part in figures, part in words is one number** (user report, same day): "sqawk 00 six
  two" read `wrong value: said "00 six two", expected "zero zero six two"`. Cause: in `normalise.ts` a run
  that opens on figures takes the figures alone (`figuresRunLength`), so `00` and `six two` are two number
  tokens and neither is `0062`. The split is deliberate and must stay — "expect 10000 one zero minutes"
  is two numbers — so the join belongs in `gradeText`, driven by the reading: adjacent typed number
  tokens whose values concatenate to a number the reading says are read as that one number

- [ ] **A navaid spelt phonetically** (user report, same day): "radar vectors sierra alpha uniform direct"
  against `radar vectors Sausalito VOR, direct` read `missed: "Sausalito VOR" · not in the reading: "sierra
  alpha uniform"`. The matcher does not see that the three words spell `SAU`. The repo rule is that fixes
  are spoken by name, never spelt, so the tier is a ruling to take to the user (right, acceptable with its
  own remark, or wrong but named as "spelt, say the name"); either way the normaliser has to read a run of
  phonetic-alphabet words that spells a lexicon key as that identifier
  - **User rulings 2026-09-18:** fully correct, no remark — 7110.65 2-5-2 a 1 gives "the name or phonetic
    alphabet equivalent (location identifier) of a NAVAID when using it in a routing" as equals ("V6
    Victor Whiskey Victor (Waterville) V45 Jackson"); and the same for a five-letter fix spelt letter by
    letter, which goes beyond the paragraph on the user's say. `R-NAVAID`'s text gains the alternative
    (YAML + build). Design: in `normalise.ts` a run of two or more phonetic-alphabet words is read
    longest-first as a lexicon key (then expanded like the typed identifier), else a run of exactly five
    as the fix's word; "victor"/"tango" before a number stay the airway word. Goes out after the grader
    step, which holds the tree

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
  is in the CIFP cache but not among the 67 rows of `shared/destinations.yaml`, so it needs a data row too

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

- [ ] **A full route clearance mode** (AJ Norell, 2026-09-18; the user agreed: "I should have a proper full
  route clearance mode"). Today the full route is only a by-product: an amended route is read in full when
  the amendment needs it, the dropdown results show both readings, and a typed full route on a clean plan
  grades acceptable, not right (`R-FULL-ROUTE`, remark "the route read in full — the shorter reading is
  enough"). A mode where the full route IS the expected reading needs planning with the user before any
  code: what triggers it (a header switch like `m=amend`, or a drawn pilot request / FRC remark on the
  strip), whether it applies to both clearance and amendment mode, how `R-FULL-ROUTE` and
  `R-THEN-AS-FILED-END` grade inside it ("then as filed" becomes the miss), which 7110.65 4-3-2 paragraph
  the new row cites, and what the dropdown form offers for the route

- [ ] **Scheduled workflow that re-runs the generator each AIRAC cycle and opens a PR.** Nothing scheduled
  exists (`.github/workflows/` holds `ci.yml` and `pages.yml` only); the cycle math is in
  `cifp/cycle.py`
- [ ] **Playtest observation awaiting a ruling** (2026-09-16, still true): the standing `SFO-SEGUL-OFF`
  notice is `default_active: true` and notices are cancelled only 20% of draws (`NOTICES_OFF_CHANCE`), so it
  is in force on 80% of scenarios. Is that too often? (The second observation, the on-request draw, was
  ruled 2026-09-18 and landed with the TEC override, [archive/tec-override.md](./archive/tec-override.md) ruling 7.)
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
- [x] Worksheet corrections (`corrections:` in `worksheets.yaml`); N436MS files its TEC route — `4135d64`
- [x] A TEC route overrides the SOP's departure (user rulings 1–12): the row choice from data, the sector
  per DP (SOP 2-2 a), noise and notices still winning, the draw and the importer moving a flight to its TEC
  SID's runway (`RWY-TEC`), on-request draws matching the importer, and `--overwrite-settled` downgrading
  only changed fixtures — `5e46ff8`, `e7333d2`, `e7b6245`
  ([archive/tec-override.md](./archive/tec-override.md), ARCHITECTURE.md "TEC routes")
- [x] Radar vectors direct and `RH`/`RV`/`Hnnn` in TEC routes: KOAK's `RH RV` rows to KSFO and its Hayward
  rows, SFO and HWD as north-gate stand-ins (Richmond), and a TEC row grammar in the build that replaces the
  "rows that name no fix" guard — `210fad9`
- [x] Tester feedback, AJ Norell: a near-miss spelling is the word (`S-SPELLING`: one edit for five to
  eight letters, two beyond, none below; a real word of the reading, the lexicon or a row is read as typed;
  numbers stay exact), a typed row's `expected:` marks the words never said, the flight-plan panel is pinned
  at every width, and `check:browser` takes `scroll:<px>` with a viewport shot — `93d164f`
- [x] A typed clearance without its expect clause keeps its F: among the alignments with the most matches
  the one with the most adjacent matches wins, so "Departure frequency" stays whole instead of lending
  "Departure" to "…after departure" (found while checking AJ's feedback; failing tests first) — `8fdd6f0`
- [x] A results row says what was wrong (user steer on AJ's feedback): a typed row marks wrong, misplaced and
  near-miss words in `you said:` and names the kind of miss in a remark line; a dropdown row marks the words
  that differ between the pick and the clearance; strip boxes unchanged. The remark labels are matcher
  constants, not YAML rows (they name what the matcher saw; the deciding rule is still cited) — `ae2218d`
