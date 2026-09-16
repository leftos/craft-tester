# Amendment engine (step 19)

The engine half of amendment mode: given a filed plan, say which strip boxes (type, altitude, route)
a clearance delivery controller must amend, what to, and why, citing data rows. No UI in this step
(step 20) and no validation of the 52 worksheet plans (step 21); this step ends with the fixture runner
printing what the engine makes of each of them.

Design source: [craft-trainer-v1.md, "Amendment mode"](./craft-trainer-v1.md#amendment-mode-websrcrulesamend).

## User decisions 2026-09-15

1. **Equipment suffix is a scenario field.** `Scenario.equipmentSuffix` is required and nullable
   (`"/L"`, or `null` when the pilot filed none, which is itself a type fault). `rnavCapable` is
   dropped; the clearance engine derives RNAV capability from `equipmentSuffixes` (unknown suffix such
   as `/Q` reads as non-RNAV). Every fixture carries it; settled fixtures keep their `expected`.
2. **A plan filed with no SID is a route fault**: the proposed route prepends the SID the clearance
   engine issues. The clearance-mode generator still draws no-SID plans as normal.
3. **The proposed altitude is the highest legal altitude at or below the filed one**, legal meaning it
   satisfies every constraint at once: parity (91.179 or the LOA rotation), the RVSM band for a
   non-RVSM suffix, the TEC cap, an LOA `max`. (The type service ceiling was a constraint until
   2026-09-16, when the user ruled that a controller does not apply aircraft performance; removed.)
4. **One route rule**: the route box must read `<assigned SID, current version> <filed tail>`, or the
   TEC route for an NCT destination (`kind: tec` rows only). That subsumes stale version, wrong
   configuration, another airport's SID, an off-notice SID and a non-RNAV filing an RNAV SID. A filed
   SID the engine would also pick is not a fault. LOA `kind: route` rows add a check on the tail.

## Shapes

- `Scenario.equipmentSuffix: string | null` (regex `^/[A-Z]$`), replaces `rnavCapable`.
  `GeneratedScenario.suffix` moves into the scenario.
- `Fixture.mode: 'clearance' | 'amendment'`, required: the runner needs it to know which engine to run
  on a pending fixture that has no `expected` yet. Importer sets it from the worksheet `kind`;
  synthetic fixtures are `clearance`.
- `Amendment` becomes a discriminated union on `box`: `{ box: 'route', proposed: string, reason }`,
  `{ box: 'altitude', proposedFeet: number, reason }`, `{ box: 'type', proposed: string, reason }`
  (`proposed` for type is the designator plus suffix, `B752/L`). Engine-side `ResolvedAmendment` adds
  `citations: RuleCitation[]`; `toExpectedAmendments` strips them, like `toExpectedClearance`.
- `AmendmentResult = { ok: true; amendments: ResolvedAmendment[] } | { ok: false; unresolved: Unresolved[] }`
  with `ClearanceElement` widened by `'BOX.type' | 'BOX.altitude' | 'BOX.route'`. Zero amendments means
  the plan is correct as filed, which is a first-class outcome (user steer 2026-09-15: amendment
  practice includes already-correct plans, because knowing when nothing is wrong is half the skill).
  A fixture settles with `expected: { amendments: [] }` for such a plan, and the runner treats an empty
  list as an expectation to match, never as "no expectation yet".
- `airport.magneticVariation: number` (degrees, east positive), from the CIFP `PA` row columns
  `[51:56]` (`E0140` on the KSFO row = 14.0°E). The parity check uses the magnetic initial great-circle
  course from the airport to the destination's `lat`/`lon`.

## Checks (`web/src/rules/amend/`)

- **route.ts**: run `resolveClearance`; unresolved blocks the route box. Expected head = the selected
  SID's `id`. Proposed = `${sid.id} ${tail}` where the tail is the filed route without its leading SID
  token; for a destination with `nct: true`, a `kind: tec` row matching plan, runway family and class
  replaces the whole route (`TRUKN# TRUKN FEVTA FEVTA1` with `#` resolved to the current version). Fault
  when proposed differs from filed. Citations: assignment row, notices, TEC row. LOA `kind: route` rows
  for the destination: the filed tail must contain one of `tokens`; when it does not and no proposal can
  be built, the route box is **unresolved** with the row's text, so the fixture stays pending for step 21.
- **altitude.ts** (with **course.ts**): constraints from the matching TEC row's `altitudeCapFeet`, the RVSM band FL290–FL410 when the
  suffix's `rvsm` is false (an unknown or null suffix counts as non-RVSM), parity by course (0–179 odd,
  180–359 even; above FL410 the 4,000-ft series FL450/490 odd and FL430/470 even) or the LOA
  `parity_rotated` row matching `artcc` or `destinations`, and LOA `max`. Fault when the filed altitude
  breaks any; one amendment, `proposedFeet` the highest legal altitude at or below filed, reason
  naming every broken constraint, citations the rows (7110.65/91.179 parity as a `phraseology_rules`
  row `A-PARITY`, RVSM as `A-RVSM`, each with source text, added to `sop.yaml`).
- **type.ts**: suffix null or not in `equipmentSuffixes` → fault, proposed = designator plus the fleet
  row's first suffix; type not in the fleet → unresolved. Assigned SID `rnavRequired` while the
  suffix is non-RNAV cannot happen (selection already avoided it), so the ambiguity the design names
  shows up as the route amendment proposing the non-RNAV SID; the type check additionally reports
  "an RNAV suffix would keep the filed SID" when the filed SID is RNAV and valid otherwise. Both
  amendments are returned; step 21 settles which the sheet meant.
- **engine.ts**: `resolveAmendments(scenario, airport)` runs type, altitude, route in that order and
  concatenates; any unresolved box fails the whole result. The `ok` result also carries `corrected`,
  the scenario with every proposed value applied (user decision 2026-09-15: a session is *amend, then
  read the clearance for the amended plan*, so step 20 feeds `corrected` into the CRAFT form and the
  clearance engine, and the altitude clause reads "expect amended" where the altitude box changed).

## Clean clearances (user rule 2026-09-15)

Training defines a clean clearance as one read aloud exactly as filed, and the SID is part of the
flight plan. Clearance mode therefore draws only plans whose route already carries the assigned SID
(current version), and the procedure is no longer a graded element there. A missing, stale or wrong
SID is amendment material: the route check above proposes the assigned one. The dirty synthetic
fixtures (`syn-no-sid-*`, `syn-stale-*`, the SEGUL-off case) stay as clearance-engine fixtures because
the engine must still resolve the clearance a dirty plan gets after amendment.

## Steps (each a brief; all in the gen worktree, sequential)

- [x] 1. (landed `77f14a3` with step 2) Suffix on the scenario, fixture `mode`, amendment union (web half): schema + export; `classify`
  derives `rnavCapable` into the context and `sidSelection` reads it there; `generate.ts` puts the
  suffix in the scenario; strip, labels, `propose.ts`, every test literal, the exhaustive test loops
  `/L` and `/A`; 28 synthetic fixtures gain `mode: clearance` and `equipmentSuffix` (`/A` when
  `rnavCapable` was false, `/L` for jets, `/G` for props and turboprops) and lose `rnavCapable`.
  Proving: `pnpm -C web typecheck && lint && fmt:check && test` (the generator's fixture validation
  goes red until step 2)
- [x] 2. (landed `77f14a3`; A-RVSM cites 14 CFR 91.180, part 91 appendix G, AIM 4-6-1 and 7110.65 4-5-1 b, since the .65's 4-6 is holding) Generator half: importer emits `equipmentSuffix` (null when the sheet filed none) and `mode`;
  re-import the 70 worksheet fixtures with `--overwrite-settled`, then restore `expected` and
  `status: settled` on the 18 settled ones from `git show HEAD:<path>`; `airports.py` parses the
  magnetic variation and `merge.py` emits `airport.magneticVariation`; `A-PARITY` and `A-RVSM`
  phraseology rows in `sop.yaml`; `craft-gen build --check`. Proving: generator gate + `pnpm -C web test`
  all green, settled fixtures unchanged in `expected`
- [x] 3. (landed 2026-09-15; measured magnetic courses KSEA 346°, KSLC 51°, KLAX 124°; only the constraints the filed altitude broke are cited; a non-RVSM flight above FL410 is legal per 91.180, flag in step 21 if a sheet disagrees) `course.ts` + `altitude.ts` + tests (table tests per constraint, plus SFO→SEA even under the
  LOA, SFO→SLC odd, B737 FL430 → FL410, /A at FL330 → FL280 or FL270 by course, C172 to O88 at 10,000
  → 5,000 by the TEC cap)
- [x] 4. (landed 2026-09-15: 51 of 52 worksheet plans resolve, 5 need no amendment, boxes amended altitude 25 / route 41 / type 5, one unresolved: SWA2021 KPDX via LMT against LOA-ZSE-PDX-ROUTE) `route.ts` + `type.ts` + `engine.ts` + `toExpectedAmendments`; `fixtures.test.ts` runs
  amendment fixtures (settled must match, pending must still differ, pending-without-expected are
  reported) and `propose.ts` prints amendments for `mode: amendment` fixtures. Proving: the full web
  gate; the runner reports how many of the 52 plans resolve

## Open for step 21

- `LOA-ZSE-LA-BASIN-DIRECT` ("no further direct than ENI/LIN/FRA/REBRG/JAGWA") was a `kind: route` row
  but its text is a limit on direct routings, not a required token; the token check would have
  flagged every airway route to LAX. **User decision 2026-09-15: dropped from `loa.yaml`** (3 LOA rows
  remain). A direct-routing limit becomes its own rule kind if a worksheet plan ever needs it.
- Whether the sheet authors amend the type or the route when a non-RNAV suffix files an RNAV SID.
  Concrete on UAL313 (B752/Q, TRUKN2 in 28 RT): the engine returns two type amendments proposing
  the same `B752/L` (unknown suffix; RNAV ambiguity) plus the route amendment to GAPP7, and
  `corrected` ends with the RNAV suffix *and* the non-RNAV route, so the corrected clearance
  re-assigns TRUKN2. Policy to settle: collapse same-value type proposals into one, and decide which
  box wins when the type fix would make the route fix unnecessary.
- Whether SWA2021 (KPDX via LMT, no MACHU/MOXEE/OED) is a route fault, and to what.
- The checks see the filed plan, `corrected` sees the applied set: a null or unknown suffix reads
  as non-RVSM, so a plan filed at FL330 with `/Q` raises an altitude amendment (to 27,000) that the
  corrected `/L` suffix no longer needs. UAL313 is the concrete case. Settle with the sheets whether
  the altitude box is amended when the type fix alone restores RVSM; the fault injector avoids the
  case meanwhile (suffix faults only outside the band).
