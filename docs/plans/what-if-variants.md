# What-if variants

From a ZOA instructor's playtest feedback. The index line is in [MAIN.md](./MAIN.md) Wave 4.

The What-if chips fill the empty `div.what-if` slot after the result actions in `web/src/ui/results.ts` (the page mockup, [page-redesign-mockup.html](./page-redesign-mockup.html), shows them under the results). A test set shows no results until it ends, so the row never appears mid-set.


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
