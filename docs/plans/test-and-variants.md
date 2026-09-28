# Test sets and what-if variants

From a ZOA instructor's playtest feedback. Index lines are in [MAIN.md](./MAIN.md) Wave 4.

The page redesign ([page-redesign.md](./page-redesign.md)) lays out where both go:
- The Test button sits in the toolbar beside New strip (`renderToolbar` in `web/src/ui/app.ts`). While a set runs, a dark test bar replaces the toolbar: "Strip 4 of 10", progress squares, the clock and End test (mockup `#test` state).
- The What-if chips fill the empty `div.what-if` slot after the result actions in `web/src/ui/results.ts`.
- `scoreLine` / `sessionScoreLine` keep their string output so the set summary can reuse them.

Build the two one after the other, since both touch `app.ts`, `scenario/filter.ts` (hash), `ui/state.ts` and `ui/solved.ts`.

## Test sets

- **Starting one:** a "Test" control next to "New scenario". The student picks a count (5/10/20) and minutes (10/20/30, or untimed), using the current airport, mode, input and filters.
- **Seeds:** a set seed derives N strip seeds (`seedFromString(setSeed + i)`, `scenario/rng.ts:84`). The hash carries `x=<setSeed>.<n>.<minutes>.<index>`, so a set can be shared and reloaded.
- **Taking it:** submitting a strip saves the attempt (the existing `ui/solved.ts` store) and moves to the next strip without showing grades. The countdown shows on top. When time runs out, the unsubmitted strips count as unanswered.
- **Summary view:** one row per strip with `scoreLine`, a total, the time used, and a link that opens each strip in the existing revisit/results view.
- **Persistence:**
  - Set progress (start time, index) lives in localStorage under `craft-tester:set:<setSeed>`, wrapped like `solved.ts`.
  - Reloading resumes the set.
  - The clock is wall-clock from the stored start, so a reload doesn't reset it.
- **Code:**
  - New `web/src/ui/testSet.ts`: state, seeds and summary rendering.
  - `AppState` gets an optional `set` phase (`ui/state.ts:69`, `phaseOf` :603).
  - Hash parse/write in `scenario/filter.ts`.
  - Wiring in `ui/app.ts` (`onNewScenario` :527 and the submit handlers).
- **Tests:** unit tests for seed derivation, time-up and resume. A DOM test for "grades hidden until end" and the summary. A browser check on phone and desktop.

## What-if variants

- **Where:** after results, in either mode, a "What if…" row offers variants:
  - "as a prop / turboprop / jet": a fleet type of that class.
  - "as /G": or another suffix that changes RNAV status.
  - "as non-RVSM": if `amend.ts` has that fault kind.
- **Building a variant:** `variantScenario(base, kind, airport)` in `web/src/scenario/amend.ts`. It takes the clean scenario from `buildScenario` (`ui/session.ts:257`) and applies the one change by spreading the `Scenario` object.
  - The aircraft is picked with a seeded RNG from the fleet types of that class.
  - The filed route is left as filed, so the change is what needs amending.
  - The result then runs through the amendment engine as a normal amendment scenario.
  - It reuses the fault machinery at `amend.ts:13-47` where a kind already exists (`missing_suffix`, `rnav_clash`, `non_rvsm_in_band`).
- **Which variants show:** only those where the amendment engine gives a definite answer and the change differs from the base. A variant that leaves the plan legal still shows, as a "no amendment needed" strip, since that is a valid lesson.
- **Hash:** `v=<kind>` with `m=amend`, so the variant can be linked and saved under its own `solved.ts` key (add `:v=<kind>`).
- **Tests:**
  - Unit: each variant kind changes exactly one field and yields the amendment the engine proposes.
  - Hash round-trip.
  - A browser check that the "What if…" row opens the variant.
