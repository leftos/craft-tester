# Amendment mode (step 20)

The mode half: draw an unclean plan, let the student amend the strip, grade the boxes, then read the
clearance for the amended plan. Builds on the engine in [amendment-engine.md](./amendment-engine.md).

## User decisions 2026-09-15

1. **A session is amend, then read.** After the boxes are graded, the same scenario continues into
   the CRAFT form for the corrected plan (the engine's, not the student's, so a wrong amendment does
   not compound). In that form C and T are given rows, the procedure row is an editable, graded
   dropdown, and the rest is graded as in clean mode.
2. **Already-correct plans are part of the drill**: knowing that nothing is wrong is half the skill.
   "Correct as filed" is an explicit answer per box, and amending a correct box is a miss.
3. **The route box holds the whole route, SID token first**, as filed on VATSIM; the student corrects
   it there (stale version, missing SID, TEC route). The form's procedure row is pre-filled from the
   corrected box and stays editable.
4. **RNAV clash (non-RNAV suffix filing an RNAV SID): either box fixes it, both accepted.** A type
   fix alone or a route fix alone is a full answer; fixing both is a miss on the second. Same-value
   duplicate type proposals collapse into one amendment.
5. **Fault injection draws up to two faults, 20% none.** Every fault is detectable by construction:
   the injected plan must resolve to exactly the intended boxes, else the draw is retried. A draw
   never amends more than two boxes, so the RNAV clash (a two-box fault) is always drawn alone.
6. **SWA2021 to Portland stays unresolved** until step 21 supplies the LOA routing; the engine does
   not guess a fix from the LOA row.

## Shapes

- `Amendment` gains `alternativeTo?: 'type' | 'altitude' | 'route'`: this amendment and the one for
  that box are two ways to fix the same fault; either alone is a full answer. The engine sets it on
  the RNAV-clash pair (type ↔ route). Fixtures record it.
- `ResolvedClearance.expect.value` gains `amended: boolean`; `ExpectedClearance.expect` gains
  `amended?: boolean`. `resolveAmendedClearance(original, corrected, airport)` in `amend/engine.ts`
  runs `resolveClearance(corrected)` and, when the altitude box was amended, replaces the expect
  clause with `{ feet: corrected.filedAltitude, minutes, amended: true }` cited from a new
  `phraseology_rules` row `A-EXPECT-AMENDED` ("EXPECT AMENDED (altitude) (minutes) MINUTES AFTER
  DEPARTURE", ZOA CRAFT Phraseology reference; overrides the chart-note drop). `speak.ts` reads
  "expect amended flight level two seven zero one zero minutes after departure". The form's expect
  choices stay `ten_minutes | three_minutes | none`; their labels say "expect amended …" when the
  scenario's altitude was amended, and grading compares minutes as now.
- `BoxAnswer = { kind: 'as_filed' } | { kind: 'amended'; value: string }` per box; `BoxGrade =
  { box, ok, expectedLabel, actualLabel, citations }`. Matching normalises: uppercase, whitespace
  collapsed, route compared as tokens; altitude accepts `32000`, `32,000`, `FL320` and `320` (three
  digits → hundreds of feet); type compared as `DESIGNATOR/SUFFIX`.
- URL hash gains `m=amend`; the solved store keys on mode as well as seed.

## Steps (briefs; A in the gen worktree, B–D sequential after it)

- [x] A. (landed 2026-09-15; `parseAltitude` reads three digits as hundreds and four or five as
  feet, anything else is not an altitude; in a pair with one box fixed, any amendment to the other
  box is a miss, labelled "correct as filed (the other box already fixes this)"; `gradeBoxes` takes
  the last amendment raised for a box, which is the one `corrected` applied; `toExpectedAmendments`
  keeps `alternativeTo`) Engine follow-ups: `alternativeTo` on the RNAV pair, duplicate type proposals collapsed
  (reasons joined), `resolveAmendedClearance`, `expect.amended` in the clearance and fixture shapes,
  `A-EXPECT-AMENDED` row, `speak.ts` rendering, `gradeBoxes(answers, result)` in `amend/grade.ts`
  with the either/or rule and the normalisers. Proving: `pnpm -C web test amend` plus the generator
  gate and `build --check` for the new row.
- [x] B. (landed 2026-09-15; over 1,000 seeds 1.29 attempts per draw, 16% correct as filed;
  fault shares stale/other/no SID 19/19/16%, parity 19%, non-RVSM in band 14%, above ceiling 20%,
  wrong TEC route 2%, missing/unknown suffix 3/3%, RNAV clash 2%; the rare four are rare because
  the data has few NCT routes and few non-RNAV SIDs. **Finding for the user:** every NCT
  destination's route-library tail differs from the transcribed TEC route (KSMF files `TRUKN CCR
  CCR2`, TEC says `TRUKN# TRUKN FEVTA FEVTA1`) and some library altitudes exceed the TEC cap, so
  those plans read as clean in clearance mode but always take a route amendment here; the nine
  library rows should probably carry the TEC route) `scenario/amend.ts`: `generateAmendmentScenario(rng, airport, filter)` draws a clean plan
  with `generateScenario`, then injects 0/1/2 faults from: stale SID version, another published SID
  of the field, no SID, wrong route for a TEC destination (only when the library has one), parity
  flip (+1,000), non-RVSM suffix inside the band, altitude above the type ceiling, missing suffix,
  unknown suffix. Retries until `resolveAmendments` is ok and reports exactly the injected boxes
  (zero for none). Tests over 1,000 seeds: mix shares, every draw resolvable, no draw with more than
  two boxes.
- [x] C1. (landed 2026-09-15; `submitDisabled(picks, procedure)` exported from `craftForm.ts`
  because vitest runs without a DOM; `state.ts` and `solved.ts` share types in a type-only cycle,
  worth moving `Attempt` out if a third module joins) The model half: `Mode` and `m=amend` in
  `scenario/filter.ts`; `state.ts` gains `mode`, `boxes`/`boxesSubmitted`, `procedure` in the picks,
  `AmendmentPicks`, `withMode`/`withBox`/`withBoxesSubmitted`; `solved.ts` stores an `Attempt`
  keyed on mode (clearance keys and values unchanged); `gradeProcedure` in `rules/grade.ts` (by
  family, chart-name labels); `craftGroups(…, procedure: 'given' | 'picked')`; `app.ts` threads
  the mode with no visible change.
- [ ] C2. (after B and C1) UI: mode switch in the header (`Clean clearance` / `Amend and clear`);
  `buildScenario` draws with `generateAmendmentScenario` and `resolveAmendedClearance` in amendment
  mode; amendment view = strip with three answer controls (as filed / amend to + input), submit, box
  verdicts; then the corrected strip, the ATIS and the CRAFT form with the picked procedure row and
  given C and T; combined results (box verdicts as `BOX.*` grades, then `R.sid` and the five) with
  one score line; spoiler and retry as in clean mode; phone width.
- [ ] D. Browser playtest (Claude in Chrome against `pnpm -C web preview`): a no-fault draw answered
  "as filed" everywhere scores full; a stale-SID draw; an RNAV-clash draw answered on one box only;
  hash reload; then the observations go to the user.
