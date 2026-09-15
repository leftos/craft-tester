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
   non-RVSM suffix, the TEC cap, the type ceiling, an LOA `max`.
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
  the plan is correct as filed.
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
- **altitude.ts** (with **course.ts**): constraints from the fleet ceiling (type not in the fleet:
  no ceiling check), the matching TEC row's `altitudeCapFeet`, the RVSM band FL290–FL410 when the
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
  concatenates; any unresolved box fails the whole result.

## Steps (each a brief; all in the gen worktree, sequential)

- [ ] 1. Suffix on the scenario, fixture `mode`, amendment union (web half): schema + export; `classify`
  derives `rnavCapable` into the context and `sidSelection` reads it there; `generate.ts` puts the
  suffix in the scenario; strip, labels, `propose.ts`, every test literal, the exhaustive test loops
  `/L` and `/A`; 28 synthetic fixtures gain `mode: clearance` and `equipmentSuffix` (`/A` when
  `rnavCapable` was false, `/L` for jets, `/G` for props and turboprops) and lose `rnavCapable`.
  Proving: `pnpm -C web typecheck && lint && fmt:check && test` (the generator's fixture validation
  goes red until step 2)
- [ ] 2. Generator half: importer emits `equipmentSuffix` (null when the sheet filed none) and `mode`;
  re-import the 70 worksheet fixtures with `--overwrite-settled`, then restore `expected` and
  `status: settled` on the 18 settled ones from `git show HEAD:<path>`; `airports.py` parses the
  magnetic variation and `merge.py` emits `airport.magneticVariation`; `A-PARITY` and `A-RVSM`
  phraseology rows in `sop.yaml`; `craft-gen build --check`. Proving: generator gate + `pnpm -C web test`
  all green, settled fixtures unchanged in `expected`
- [ ] 3. `course.ts` + `altitude.ts` + tests (table tests per constraint, plus SFO→SEA even under the
  LOA, SFO→SLC odd, B737 FL430 → FL410, /A at FL330 → FL280 or FL270 by course, C172 to O88 at 10,000
  → 5,000 by the TEC cap)
- [ ] 4. `route.ts` + `type.ts` + `engine.ts` + `toExpectedAmendments`; `fixtures.test.ts` runs
  amendment fixtures (settled must match, pending must still differ, pending-without-expected are
  reported) and `propose.ts` prints amendments for `mode: amendment` fixtures. Proving: the full web
  gate; the runner reports how many of the 52 plans resolve

## Open for step 21

- `LOA-ZSE-LA-BASIN-DIRECT` ("no further direct than ENI/LIN/FRA/REBRG/JAGWA") is a `kind: route` row
  but its text is a limit on direct routings, not a required token; the token check would flag every
  airway route to LAX. Step 4 skips that row (only rows whose text names a required routing are
  checked) and the user decides whether it becomes a new rule kind or is dropped.
- Whether the sheet authors amend the type or the route when a non-RNAV suffix files an RNAV SID.
- Whether SWA2021 (KPDX via LMT, no MACHU/MOXEE/OED) is a route fault, and to what.
