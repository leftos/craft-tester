# Plan index

<!-- plan-doc-hygiene: 2026-09-28 2618514 -->

Entry point for anyone continuing this work. **Open items only.** When an item lands, delete its line; `git log` is the record of what shipped. Open work is grouped into waves: one release-sized bundle sharing owning files, so one implementer reads those files once and one review gate covers the bundle.

Design, data facts and rationale live in [ARCHITECTURE.md](../ARCHITECTURE.md) ("Why it is built this way" and "Amendment mode") and [ADDING_AN_AIRPORT.md](../ADDING_AN_AIRPORT.md) ("Lessons from KOAK").

**State.** Both airports are live. KOAK is closed at 51 of 51 fixtures settled. KSFO stands at 67 of 100 settled, with **33 pending, all amendment plans** (19 of its 52 amendment fixtures settled; all 18 phraseology fixtures settled). The user paused that loop 2026-09-16 — "I can point out any mistakes I notice or that users find as they come up".

## Wave 1 — Airway structure for conventional rebuilds (`generator/src/craft_generator/cifp/`, then the engine)

Subplan: [airway-structure.md](./airway-structure.md). Gate: aviation + a data concept the user rules on.

- [ ] **Rebuild a conventional route for a non-RNAV plan that files RNAV elements** (slice C of the subplan). The airway structure ships in `airways` (`cifp/airways.py`, depth-2 widening); the engine still answers with the type box alone. Ruled: library route first, then a V/J path; type raise and rebuilt route as an alternative pair; three settled KOAK fixtures go back to the user once it lands. Open questions for the brief are in the subplan

## Wave 2 — Destination amendment box (schema, `rules/amend/`, `ui/`, importer, `shared/destinations.yaml`)

Gate: aviation + UI. The only rule concept KOAK left unbuilt.

- [ ] **A fourth strip box for the destination.** AAY218 on **Oakland** Amendment Practice 1A files
  `KPGI` (`ORRCA FMG J7 REO J537 MLP V536 FIKAB`; FIKAB is an approach fix of KGPI); the importer skips it
  today because `KPGI` is no destination row, and the sheets carry no correction cells. Mapped: about 10
  source sites hard-code three boxes (`schema.ts` ×3, `rules/amend/grade.ts`, `engine.ts`, `rules/types.ts`,
  `ui/state.ts`, `ui/solved.ts`, `ui/labels.ts`, `ui/amendForm.ts`, `scenario/generate.ts`,
  `scenario/amend.ts`); `applyAmendment` and `withCorrectedBox` fall through to type/route for an unknown box.
  **Ruled**: the check reads a cited typo table (a data row per known typo, `KPGI → KGPI`), never a
  transposition search; the drill draws no destination faults; an unknown destination with no table row
  stays unresolved as today; the row cites 7110.65 2-2-6 ("flight plan and control information is correct
  and up-to-date"). Settled from the code: box order type, destination, altitude, route, with the engine
  correcting the destination before judging altitude and route; exact-ICAO verdict; the fourth key
  optional in saved attempts; the importer gets a `worksheets.yaml` ruling that keeps the printed `KPGI`;
  a `KGPI` row in `shared/destinations.yaml` (Glacier Park International, short Kalispell, ZLC) and in
  KOAK's `routes.yaml` `destinations:`. Waits for test sets to land (`ui/state.ts`, `ui/solved.ts`, `ui/app.ts`)

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

## Wave 4 — What-if variants (`web/src/ui/`, `web/src/styles.css`, `scenario/filter.ts`, `scenario/amend.ts`)

Subplan: [what-if-variants.md](./what-if-variants.md). Gate: UI + browser check. From a ZOA instructor's playtest feedback.

- [ ] **What-if variants**: after results, "as a prop", "as /G" and similar variants re-open the strip with that one change in amendment mode; linkable through `v=`

## Singles

- [ ] **Dictation for free-text entry.** Browser speech recognition (Chrome and Edge only, not Firefox) feeding the free-text box, with feature detection. The user left it out of the first cut on 2026-09-17
- [ ] **Enable "Allow GitHub Actions to create and approve pull requests"** in the repo settings (`can_approve_pull_request_reviews` is false); until then the AIRAC workflow fails at `gh pr create`. Needs the user's go-ahead: it is a repository setting

## Cleanup

- [ ] `tools/gate.ps1` now requires `-Slot heavy|light` (heavy when the command fans out across cores, light when it keeps one or two threads busy; see `~/.claude/CLAUDE.md`). Nothing here calls the gate yet; confirm that, and give any call added later a kind. The choice was made from outside this repo's agents; the pool sizes belong to the machine-wide gate in `~/.claude/tools/gate/`.
- [ ] CLAUDE.md's browser-check example `s=1,a=KOAK,d=KLVK … "select:4=(no prefix)" "fill:0=…"` does not match its hash: `select:4` is the "fix or airway" row, `(no prefix)` sits in the "shape" row, and the page has no text input for `fill:0`. Pick a hash and indices that do what the example says
- [ ] Bump `astral-sh/setup-uv` from v10.1.0 to v10.2.0 (`c18668ad3cf93ea998bef934396af7bb5c839dc7`) in `ci.yml`, `pages.yml` and `airac.yml` together
- [ ] `check:browser`'s `click:` cannot press a bare `<summary>`, so `click:Filters` times out (the Test popover got `role="button"` to work around it); give `web/scripts/browser-check.ts` a way to press a summary by its text
- [ ] Phone: after a test set ends while the toolbar is marked hidden, `--pin-top` stays unset until the next scroll, so the strip pins under a toolbar that has slid away (`hideToolbarOnScroll`, `web/src/ui/app.ts`)
- [ ] Enter in the typing box on a test set's one-screen amendment strip calls submit while a box is still open; the state refuses it and nothing shows. Make Enter follow the Submit button's disabled state
- [ ] `docs/architecture.md` against the user-level architecture entry point (`~/.claude/docs/templates/ARCHITECTURE.md`): add a Task Index table at the top that points into the Change recipes, a Layers section (generator, web, fixtures and what each may reference), Integration Footguns and Test locations.
