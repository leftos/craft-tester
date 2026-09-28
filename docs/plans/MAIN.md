# Plan index

<!-- plan-doc-hygiene: 2026-09-28 2618514 -->

Entry point for anyone continuing this work. **Open items only.** When an item lands, delete its line; `git log` is the record of what shipped. Open work is grouped into waves: one release-sized bundle sharing owning files, so one implementer reads those files once and one review gate covers the bundle.

Design, data facts and rationale live in [ARCHITECTURE.md](../ARCHITECTURE.md) ("Why it is built this way" and "Amendment mode") and [ADDING_AN_AIRPORT.md](../ADDING_AN_AIRPORT.md) ("Lessons from KOAK").

**State.** Both airports are live. KOAK is closed at 51 of 51 fixtures settled. KSFO stands at 67 of 100 settled, with **33 pending, all amendment plans** (19 of its 52 amendment fixtures settled; all 18 phraseology fixtures settled). The user paused that loop 2026-09-16 — "I can point out any mistakes I notice or that users find as they come up".

## Wave 1 — Airway structure for conventional rebuilds (`generator/src/craft_generator/cifp/`, then the engine)

Subplan: [airway-structure.md](./airway-structure.md). Gate: aviation + a data concept the user rules on.

- [ ] The RNAV element check leaves a non-RNAV plan with no conventional route in the data; the J and V
  airway structure would let the engine rebuild one. Surveyed 2026-09-17: parse the CIFP `ER` records the
  generator already downloads (ordered fixes plus high/low, conventional/RNAV, MEA/MAA); the vNAS
  `NavData.dat` carries only `id + fixes` and has 224 colliding ids (`J1`, `V6` resolve to foreign routes
  first-wins). No airway parsing exists in `cifp/` today — only the three-row hand-written
  `shared/airways.yaml`. The user ruled on the subplan's three questions (library route first, then a V/J
  path; ship only the airways the Bay files; accepted among alternatives); ready to brief the `ER` parser

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

## Wave 4 — Test sets and what-if variants (`web/src/ui/`, `web/src/styles.css`, `scenario/filter.ts`, `scenario/amend.ts`)

Subplan: [test-and-variants.md](./test-and-variants.md). Gate: UI + browser check. From a ZOA instructor's playtest feedback.

- [ ] **Test sets**: N strips on a clock, grades hidden until the set ends, then one summary; linkable through `x=` in the hash
- [ ] **What-if variants**: after results, "as a prop", "as /G" and similar variants re-open the strip with that one change in amendment mode; linkable through `v=`

## Singles

- [ ] **Parity floor above the surface**: the engine's parity floor is 3,000 ft MSL (`PARITY_FLOOR_FEET`, `rules/amend/altitude.ts`) where TBL 4-5-1 says 3,000 ft above the surface; that is the same at SFO and OAK but not at a high-elevation airport. Ruled: the floor is the departure field's CIFP elevation plus 3,000, rounded up to the next thousand
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
- [ ] **Playtest observation awaiting a ruling** (2026-09-16, still true): the standing `SFO-SEGUL-OFF` notice is `default_active: true` and notices are cancelled only 20% of draws (`NOTICES_OFF_CHANCE`), so it is in force on 80% of scenarios. Is that too often?
- [ ] **Dictation for free-text entry.** Browser speech recognition (Chrome and Edge only, not Firefox) feeding the free-text box, with feature detection. The user left it out of the first cut on 2026-09-17
- [ ] **Rule briefs contradict the settled fixtures or themselves** (friction `d5:craft-tester:2026-W38`, from the
  transcript miner: in W38 14 dispatches came back underspecified, 10 ended without a report and 8 were blocked;
  the gaps read "the brief contradicts itself on the maximum number of amended boxes", "decision 4 contradicts
  three settled worksheet fixtures", "the number-run rules do not say how several readings combine", "the
  structure predicate drops a leading token in 8 settled fixtures"). Before a brief on `rules/` or `scenario/`
  names an expected box, citation or draw, run `pnpm -C web propose` over the settled fixtures it touches and
  quote the output into the brief; a rule concept with combination semantics (number runs, amended-box count,
  composition order) gets its worked examples and non-examples written into the rule row's `text` or the rules
  section of `docs/ARCHITECTURE.md` before it is briefed
- [ ] **Implementers read 28–33 files before their first edit** (friction `d2` ×5, ~$51, worktree runs): hot spots `web/src/rules/amend/route.ts`, `web/src/data/schema.ts`, `web/scripts/propose.ts`, `generator/src/craft_generator/cli.py`, `craft_generator/sop/load.py`. `docs/ARCHITECTURE.md` already names them, so first check whether those briefs cited it; then give ARCHITECTURE.md a task index ("add an amendment rule", "add a schema field", "add a generator subcommand", "load a new SOP section") naming the files in order, for briefs to cite
