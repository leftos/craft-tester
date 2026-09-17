# RNAV airways and RNAV waypoints filed by a non-RNAV aircraft

User steer 2026-09-17: the engine gated RNAV capability on procedures only (RNAV SIDs, RNAV arrivals, LOA
rows flagged `rnavOnly`). A non-RNAV aircraft filing a Q route, a T route or a route of RNAV waypoints passed
the route check. **User decision 2026-09-17: do both halves in one commit.**

## Sources

- AIM 5-3-4 c 1 (`docs/refs/aim/chap05_sec03.md`): published RNAV routes (Q, T, Y) are for aircraft with RNAV
  capability, RNAV 2 unless charted RNAV 1, met by GPS, GPS/WAAS or DME/DME/IRU. Q routes: "RNAV equipped
  aircraft" between 18,000 and FL450. T routes: "GPS or GPS/WAAS equipped aircraft" below 18,000. Y routes:
  "Pilots must use GPS".
- ARINC 424 enroute waypoint records (CIFP section `EA`, `SUSAEAENRT   NTELL K20    W   B …`): the waypoint
  type at `[26:29]`, first character `W` for an RNAV waypoint, `C` for a combined named intersection and RNAV
  waypoint, `R` for a named intersection, `I` unnamed charted intersection, `N` NDB as waypoint, `V` VFR
  waypoint. In the 2609 cycle NTELL, SUSEY, YYUNG, EBAYE and FEVTA are `W`; ALTAM, PORTE, SUNOL and GOBBS are
  `C`; COLLI is `R`.

## Design (orchestrator, assumptions stated)

1. **Data, shared rule rows** in `generator/shared/phraseology_rules.yaml`:
   - `R-RNAV-AIRWAY`, source "AIM 5-3-4 c 1": a Q route is filed only by an RNAV-capable aircraft, a T or Y
     route only by a GNSS-equipped one. Assumption: the suffix table's `rnav` flag stands in for RNAV 2 with
     GPS or DME/DME/IRU (so `/Z` and `/I` may file a Q route), and `gnss` for the GPS a T or Y route needs.
   - `R-RNAV-WAYPOINT`, source "AIM 5-3-4 c 1; ARINC 424 enroute waypoint type": a fix whose CIFP record is an
     RNAV waypoint (`W`) is filed only by an RNAV-capable aircraft; a combined fix (`C`) is also a named
     intersection and needs nothing.
2. **Data, per-fix waypoint kind.** New CIFP parser `cifp/waypoints.py` reading `EA` records (same
   continuation guard as the navaid parser, `line[21] in {"0","1"}` at the column the record uses) into
   `{ident: type[0]}`. `merge.py` emits `rnavWaypoints: string[]` on the airport document: every five-letter
   fix token filed anywhere the document or the fixtures name (route library rows, TEC rows, LOA rows, SID
   transitions, route connections, fixture routes) whose type is `W`, sorted. Schema: `rnavWaypoints:
   z.array(z.string())` beside `fixSpoken`; `schema:export`; rebuild both airports. A checked-in
   `generator/tests/fixtures/cifp/waypoint_records.txt` with a README, and tests for `W`, `C`, `R` and the
   continuation row.
3. **Engine.** `rules/route.ts` gains `rnavElements(filedRoute, airport)`: the tokens of the route that need
   RNAV and what each needs, `{ token, needs: 'rnav' | 'gnss', why }` for `Q` airways (rnav), `T` and `Y`
   airways (gnss), and fixes in `rnavWaypoints` (rnav). `Classification` gains `gnssCapable` beside
   `rnavCapable`, read off the suffix row's `gnss` (`null` and no suffix read false).
   - `checkRnavClash` in `rules/amend/type.ts` widens from "the filed SID needs RNAV" to "the filed plan needs
     RNAV or GNSS the suffix lacks": the SID (`rnavRequired`), or any element of `rnavElements`. The proposed
     suffix is the fleet's first Mode C row with `rnav === true`, and with `gnss === true` where a T or Y
     route or a GNSS-only element is filed. The reason names the elements ("Q174 is an RNAV route, NTELL and
     SUSEY are RNAV waypoints"); citations `R-RNAV-AIRWAY` / `R-RNAV-WAYPOINT` as applicable plus the suffix row.
   - `checkRoute` in `rules/amend/route.ts`, on a plan whose suffix lacks what an element needs: the route
     box is unresolved ("`Q174` needs RNAV a `/W` flight does not carry, and the data holds no conventional
     route to propose") unless a TEC or LOA row already proposes a route without RNAV elements (the existing
     TEC and LOA paths run first and win). So the pair resolves to the type box alone where the fleet files an
     RNAV suffix, and the whole plan is unresolved where it does not, which the clearance-mode draw already
     throws away.
4. **Scenario generator.** `rnavClash` in `scenario/amend.ts` draws on plans whose SID needs RNAV **or** whose
   route carries an RNAV element; the non-RNAV row it picks must lack what the plan needs (`gnss` false for a T
   route plan, `rnav` false otherwise) and carry Mode C. `takesPlainSuffixFault` also requires no RNAV element
   on the route.
5. **Fixtures.** Every settled fixture stays green; pending ones may change and are printed. New synthetic
   fixtures at KOAK: a B738/W filing `CNDEL5 NTELL Q174 FLCHR COKTL4` in SFOW (answer: type box to `/L`), and
   a `/A` C172 filing a T route (answer: unresolved, recorded as `pending` with the note).

## Step A landed in the worktree (2026-09-17)

`cifp/waypoints.py` reads EA and PC rows (type at `[26:29]`, enroute row wins); `rnavWaypoints` holds 48
fixes at KSFO and 34 at KOAK because most SID transition and gate fixes are published `W` (TRUKN, SSTIK,
CNDEL, SNTNA …). Nine KSFO fixes on routes to foreign fields have no waypoint record at all and read as not
RNAV. The Pacific grid waypoints carry their type one column right and are skipped (their identifiers carry a
digit). `_document_navaid_tokens` does not walk LOA rows, so the list mirrors that.

## Step B decisions (orchestrator, 2026-09-17)

- A fix the filed SID already implies (its base fix and its published transitions) is not an element: the
  RNAV SID is gated by `rnavRequired`, and a conventional SID's fixes are navaids or intersections.
- `Classification.gnssCapable` beside `rnavCapable`; `Y` joins the airway token pattern. **User confirmed
  2026-09-17**: T routes need GNSS, per the AIM's "GPS or GPS/WAAS equipped aircraft" wording for T routes
  against "RNAV equipped" for Q routes.
- When the RNAV clash is raised and the non-RNAV side is unresolved (no conventional route in the data), the
  type box alone is the answer, unpaired; without a clash an unresolved outcome still fails the result.
- The generator's `rnavClash` fault writes `/U` for a plan needing RNAV and `/I` for one needing only GNSS.
- Fixture `rnav-elements-b738w-klas` (KOAK, OAKE, `NTELL Q174 FLCHR COKTL4`, `/W`) stays pending until the
  user confirms the type-box answer.

## Step B finding and decision (orchestrator, 2026-09-17)

Three settled KOAK worksheet fixtures were validated before this rule existed and keep RNAV elements on a
`/A` aircraft: FDX3859 (`B752/A`, `HUSSH2 MOGEE Q124 …`, settled as altitude FL270 plus a rebuilt route that
keeps Q124, type as filed), PXT415 (`C25B/A`, settled onto `SKYL1 WAGES LOSHN …`, LOSHN being an RNAV
waypoint), and NKS510 (structure unchanged, only the clash reason now names EBAYE and BURGL). Under the
user's rule of today those first two answers are wrong: a `/A` jet cannot fly Q124 or LOSHN, and the data
holds no conventional route to rebuild, so the only answer is the type box.

Decision, extending step B item 5: when the route check on the non-RNAV plan fails only because of RNAV
elements the data cannot route around, and the fleet files an RNAV Mode C suffix, the type box is raised as
a first-stage amendment like the suffix gap, and the altitude and route are judged on the RNAV plan — no
alternatives, whether or not the RNAV plan is otherwise clean (when it is, this equals the earlier "type box
alone"). The generator gets a separate `rnav_element` fault (type box alone) for plans whose route carries
RNAV elements, and `rnav_clash` (type against route) stays restricted to plans whose only RNAV need is the
SID. FDX3859 and PXT415 go back to `pending` with the engine's new answer printed for the user to confirm;
route-building unit tests that used `/A` on RNAV-waypoint routes file `/L` instead, since RNAV is not what
they test.

## Landed 2026-09-17 (`d06779a`, one commit)

Both halves as designed above plus the step B decisions. Implementer deviations accepted: the flipped
`rules/amend/route.test.ts` cases keep `/A` and read against a copy of the airport with `rnavWaypoints: []`
(filing `/L` would invert each test's own subject); the re-opened fixtures carry no `expected` block, as every
other pending fixture does, since `fixtures.test.ts` fails a pending fixture whose expectation already matches
the engine; the type-box reason names the navigation (`RNAV`, `GPS`, `RNAV and GPS`); the clash reason with
element clauses reads "the filed CNDEL5 needs RNAV, EBAYE and BURGL are RNAV waypoints, and the route and
FL350 all stand for a /L flight". Both re-opened worksheets also change their altitude (FDX3859 FL270 →
FL330, PXT415 FL270 → FL310) because the altitude is now read for the RVSM-approved plan. Left alone: three
short reason helpers duplicated between `rules/amend/route.ts` and `rules/amend/type.ts`.

## Out of scope

- Conventional route rebuilding (no J or V airway structure is in the data).
- Y routes exist nowhere the Bay files; the rule row names them for completeness only.
