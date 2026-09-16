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
   the injected plan must resolve to exactly the intended boxes, else the draw is retried.
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
- [ ] B. `scenario/amend.ts`: `generateAmendmentScenario(rng, airport, filter)` draws a clean plan
  with `generateScenario`, then injects 0/1/2 faults from: stale SID version, another published SID
  of the field, no SID, wrong route for a TEC destination (only when the library has one), parity
  flip (+1,000), non-RVSM suffix inside the band, altitude above the type ceiling, missing suffix,
  unknown suffix. Retries until `resolveAmendments` is ok and reports exactly the injected boxes
  (zero for none). Tests over 1,000 seeds: mix shares, every draw resolvable, no draw with more than
  two boxes.
- [ ] C. UI: mode switch in the header (`Clean clearance` / `Amend and clear`) carried in the hash;
  amendment view = strip with three answer controls (as filed / amend to + input), submit, box
  verdicts; then the CRAFT form for the corrected plan with the editable procedure row and given C
  and T; combined results and a combined score line; spoiler and retry as in clean mode; phone width.
- [ ] D. Browser playtest (Claude in Chrome against `pnpm -C web preview`): a no-fault draw answered
  "as filed" everywhere scores full; a stale-SID draw; an RNAV-clash draw answered on one box only;
  hash reload; then the observations go to the user.
