# A TEC route overrides the SOP assignment

Subplan for the Wave 1 item in [MAIN.md](./MAIN.md). A new rule concept, so it is planned before any code
(repo rule). Status: rulings in (user 2026-09-18); brief 1 next.

## Rulings (user 2026-09-18)

1. **Scope: blanket.** "The only time the TEC route can't override is if the SID it suggests literally
   cannot be used with the only available runways (e.g. a 01s-only SID in 28RT/28SO configurations)."
   Chosen over "only over a SOP heading" and "only over the SOP 2-2 b fall-through headings". The user
   knew this puts TRUKN on the 28s in 28/01 and 28 SO, against SOP 2-2 a's footnote "SNTNA# shall be used
   instead of TRUKN# off runways 28 while in 28/01 configuration, when the TRUKN DP is not in use (28 SO)"
   (`SFOW-N-SNTNA-28`).
2. **Row choice: the first keyed row the flight can fly.** Table order stands. A row whose SID the flight's
   equipment cannot fly is skipped for the next keyed row (SOP 2-1 b: "if a pilot cannot accept one,
   vectors direct"). No specificity order, no data change: RNAV J/T to KLVK in SFOW keep
   `TEC-KLVK-SFOW-JT` (`TRUKN# TRUKN ALTAM`), and a non-RNAV one falls to `-01` (`SFO# V244 ALTAM MOD`) or
   `-28` (`GAPP# OAK V244 ALTAM MOD`).
3. **Bare `GAPP#` (`TEC-KOAK-SFOE-TP`) reads `GAPP7 SFO`, spoken "radar vectors direct"** (user
   2026-09-18, twice). The box is filed the way every vector SID is, with the airport navaid after it
   (`R-RV-NAVAID`). With no fix after the navaid, the clearance reads the user's words, "radar vectors
   direct": vectors straight to the destination.
   - **Orchestrator derivation, told to the user:** the direction, and so the departure frequency, comes
     from the destination's own navaid where that is a gate fix. OAK is in the KSFO north gate, so
     Richmond. Where it is in no gate, the flight is `Unresolved` and reported.
   - It needs a new phraseology row (rules are data), so it belongs to **part 2** below, not brief 1.
     `routeFromExitFix` (`rules/route.ts:113-118`) reads `GAPP7 SFO` as having no exit today.
4. **Runway: the draw picks a usable runway.** The scenario generator and the worksheet importer put a
   TEC-routed flight on a runway its TEC SID is published from, and the engine explains that runway with a
   new `RWY-TEC` row. The engine never moves a flight. A scenario that still lands on a runway the SID is
   not published from skips the row, and the next keyed row is tried.
5. **Noise-abatement headings still win.** A flight inside a noise window gets the heading, and its TEC
   route's tail follows it, the way a heading-headed TEC row reads today.
6. **Notices win, like noise.** A SID an active notice takes out of use cannot be flown. Where the notice
   issues a heading in its place (KOAK QUAKE and SUNNE off), the flight gets that heading and the TEC tail.
   Where it issues nothing (KSFO `SFO-SEGUL-OFF`), the row is skipped for the next keyed row.
7. **On-request runway draws match the importer** (from the Singles playtest item). A draw keeps an
   on-request runway only when the procedure the SOP then assigns is published off the requested runway
   family alone. Otherwise the flight takes the runways in normal use.
8. **A noise row that assigns a SID wins too, and the TEC tail follows it** (user 2026-09-18, after brief
   1's first report). Examples are KSFO NIITE (SFOW, 2200–0700, RNAV) and KOAK HUSSH, SLNT and SUNNE. The
   noise SID stands, and the route box is that SID joined onto the TEC route minus its head, which the
   route builder connects as it connects any SID to a filed route. The TEC final altitude still applies.
   Example: an RNAV jet off KSFO 28L at 2300 to KSMF gets NIITE4, and its box is NIITE4 joined onto
   `TRUKN FEVTA FEVTA1`.
   - **How the engine reads it** (orchestrator, from brief 1's second report). NIITE4 has no TRUKN
     transition, so the table walk passes the noise row by, because it reads only rows whose SID serves the
     exit. For a TEC-routed flight, the first applicable noise-window row in table order wins whenever the
     flight can fly its procedure (`isFlyable` for a SID, and exit service is not required). That row
     supplies the sector and the citation.
   - The box is built as though the flight had filed `<noise SID> <TEC tail>`, with the build scope set to
     the noise family.
   - A notice that turns the TEC row's own family off and names a heading gives that heading, with the
     sector of the first applicable row for that family. That matches the walk's notice branch. No current
     row exercises this, so it is tested on an injected row.

9. **"Can't be used" includes "not in use"** (user 2026-09-18, after brief 1's third report, confirming
   "Yes, that's the model"). A TEC SID is usable off a runway only where the SOP puts its family in use
   from that runway family in the current configuration. That means some assignment row with that
   `sidFamily` and the flight's plan lists the runway family, and its `configs`/`notConfigs` admit the
   configuration. Direction, exit, audience, RNAV and noise conditions do not count here: equipment is
   ruling 2's test, and noise is ruling 5's and ruling 8's.
   - TRUKN, 28/01, 01R: `SFOW-N-TRUKN-01` has no config condition, so it is in use.
   - TRUKN, 28/01, 28R: the only TRUKN row for the 28s is `SFOW-N-TRUKN-28` (`configs: ["28 RT"]`), so it is
     not in use.
   - TRUKN, 28 RT, 28L: in use.
   - TRUKN, 28 SO: in use from no runway, so the row is skipped and the SOP's SNTNA or GAPP applies.
   - OAK# in KOAK SFOE off 10/12: in use (the KNUQ/KPAO `OAK# … SUNOL SJC` jet rows already route there),
     so the three never-routed SFOE jet rows still route.
   - Heading and fix heads are always usable.
10. **The runway move outranks the default runways** ("TEC moves them too"). The draw moves a TEC-routed
    flight to a runway its TEC SID is usable from, even off an airline, group or class default. N436MS
    (TBM9, 28/01, class default 28R) departs 01R on TRUKN2 and gets re-settled when brief 2 lands.
11. **Heading-headed rows win over the SOP's heading.** KOAK OAKE props and turboprops to KSFO fly the TEC
    `H270 OSI`, not `OAK-OAKE-PT-090`'s 090.
12. **Retarget `syn-sfo5-v6-01r-airway`.** It exists to test "radar vectors to join V6". It keeps its plan
    and moves to a destination with no TEC row, so it keeps testing the airway phrase.

**Orchestrator decisions from brief 1's third report:**

- **The route the SOP reads.** For a TEC-routed flight, the table walk and the noise search read the
  direction and exit of the TEC route, not of the route as filed. That is the route the flight will fly,
  and the old `issuable` read it too. It keeps the first pass and the corrected plan's pass in agreement:
  seed 971's route box never settled when they disagreed.
- **Heading heads behind a noise SID.** A heading-headed row cleared on a noise SID gets the same box as a
  family head: the noise SID joined onto the row's route minus its head.
- **Old tests.** Tests that asserted the replaced rule are rewritten to the new one. Tests of another
  feature that happened to use a TEC destination move to a destination with no TEC row, as ruling 12 does.

## What changes (measured 2026-09-18)

A throwaway enumeration ran every family-headed `kind: tec` row against every flight it is keyed for: each
configuration of the row's plan, each runway its families allow, and each fleet type and suffix of its
classes, filed on the row's own route at 1300 on a Tuesday (no noise window). It then sorted out the flights
`tecRouteFor` does not route today.

- **71 rows lose some flights today, not just the five never-routed ones.** The override routes the flights
  the SOP gives another answer.
- **KSFO:** 10 SFOW rows that begin `TRUKN#` (KSMF, KLVK, KMYV, KOVE, KSAC, O88, KOAK) lose every flight off
  28L/28R in 28/01 and in 28 SO, where the SOP assigns SNTNA or GAPP. That is roughly 1,000 enumerated
  combinations. Under the blanket reading all of them became TRUKN2. Under ruling 9 they stay with the
  SOP, and in 28/01 the draw moves them to the 01s instead. `TEC-KOAK-SFOE-TP` resolves nothing today ("filed route GAPP7
  has no fix after the procedure").
- **KOAK:**
  - `TEC-KMRY-SFOE-J`, `TEC-KWVI-SFOE-J` and `TEC-KSJC-SFOE-J` lose every flight to the runway-heading
    fall-through rows (57 each). **Correction to the MAIN.md line:** with the row's own route filed, the SOP
    answers runway heading, not KATFH/SKYL.
  - The SFOE turboprop rows that begin `OAK#` (KNUQ, KPAO, KRHV, KSJC) lose 42 of 45 flights to
    `OAK-SFOE-PT-090`.
  - The SFOW T/P rows lose their runway-33 flights to the 315 and 270 headings, and one flight each off
    28L, 28R and 30 to OAK6.
- **Rows a runway cannot fly** (the draw's job, ruling 4): TRUKN2 is not published off 01L (KSFO 28/01 and
  01/01). OAK6 and NUEVO8 are not published off 33 (KOAK SFOW).
- **Rows the equipment cannot fly** (skipped, ruling 2): the non-RNAV suffixes on every RNAV head.

Every settled fixture this moves is **a ruling for the user, not an expectation to update** (repo rule).
Brief 1 lists them before anything else lands.

## The rule, with examples

A TEC row is **usable** by a flight when `keyedFor` holds and:

- a head of `FAMILY#` names a family the airport still publishes, and the flight can fly that SID from the
  runway it is on with the equipment it has (`isFlyable` in `rules/sidSelection.ts:120`: the SID lists the
  departure runway, and `!sid.rnavRequired || ctx.rnavCapable`), the SOP puts the family in use from that
  runway family in this configuration (ruling 9), and no active `sid_off` notice without a heading takes
  the family out of use;
- a heading head (`H270`) or a fix or airway head (`EUGEN`) is always usable.

The flight's TEC row is the first usable row in table order. With a family head, the clearance's procedure
is that SID, unless the SOP walk ends on a noise-window row or on a notice that issues a heading. In those
two cases the heading stands and the route box is the row's route with its head dropped.

| Flight | TEC row | Result |
| --- | --- | --- |
| KOAK SFOE, 10R, RNAV jet to KMRY, 1300 | `TEC-KMRY-SFOE-J` `OAK# OAK EUGEN` | OAK6, box `OAK6 OAK EUGEN` (today: runway heading, the tail stands) |
| KSFO 28 RT, 28L, RNAV jet to KSMF | `TEC-KSMF-SFOW-J` (`TRUKN# …`) | TRUKN2 |
| KSFO 28/01, 28L, RNAV heavy jet to KSMF | TRUKN is not in use off the 28s in 28/01 (ruling 9) | row skipped on 28L; the draw moves the flight to 01R (ruling 10), which gets TRUKN2 |
| KSFO 28 SO, RNAV jet to KSMF | TRUKN is in use from no runway | row skipped; the SOP's SNTNA or GAPP applies |
| KSFO SFOW, 01R, `/A` jet to KLVK | `-JT` skipped (RNAV) → `-JT-01` | SFO5, box `SFO5 V244 ALTAM MOD` |
| KSFO SFOE, prop to KOAK | `TEC-KOAK-SFOE-TP` `GAPP#` | GAPP7, box `GAPP7 SFO` |
| KOAK SFOE, RNAV jet to KMRY, 2300 (`sfoe_night`) | `TEC-KMRY-SFOE-J` | noise row: heading 140, box `OAK EUGEN` |
| KSFO 28/01, jet drawn on 01L to a `TRUKN#` destination | `-JT` | the draw puts it on 01R and RWY cites `RWY-TEC` |
| The user's example: 28 RT or 28 SO, a row whose SID is 01s-only | (no current row: KSFO TEC heads are TRUKN#, CIITY#, SFO# and GAPP#) | no runway flies it, so the row is skipped |
| KOAK SFOW, prop drawn on 33 to a `NUEVO#` destination | `TEC-…-SFOW-TP` | the draw moves it to 28 or 30, whichever NUEVO8 is published off and the class may use |

## Design by layer

- **A. One row-choice function.** `rules/tecRoutes.ts` gets the usable-row test above. It replaces both
  `keyedTecRoute` (first keyed row, no test) and `amend/tec.ts`'s `tecRouteFor`/`issuable`, which put the
  row's route to `resolveClearance`. The new test calls no clearance engine, which also removes that
  recursion. Callers: `sidSelection.ts:42` and `:201`, `rules/altitude.ts:153`, `amend/altitude.ts:263`,
  `amend/route.ts:340` and `:774`, and `tecAltitudes.test.ts`. Today the altitude and SID-selection sides
  read the first keyed row while the route side reads the issuable one. After this change all of them read
  the same row. Heading-headed rows (KOAK OAKE `H270 …`) come within the blanket ruling too. The flight is
  issued the row's heading, so that the procedure and the route box always agree. `tecHeadConflict` stays
  as the data check it is. Brief 1 reports each flight where this changes the SOP's answer.
- **B. The procedure (`selectSid`).** Walk the table as today. Then, unless the walk ended on a
  noise-window row or a notice heading, a flight whose TEC row has a family head is given that SID, and one
  whose row has a heading head is given that heading. Either way the TEC row is cited.
  - **The departure frequency comes from the DP, per SOP 2-2 a** (user 2026-09-18, who pointed to the
    table: it lists the departure sector per DP). Take the in-use rows for the TEC family (ruling 9's
    rows, noise rows excluded).
    - If they name one sector, that is the sector.
    - If they name several, use the row whose direction matches the TEC route's.
    - If that still doesn't decide it, use the sector of the row the walk reached. Otherwise the flight is
      `Unresolved`.
  - Examples:
    - SFO# (north>richmond only) is Richmond, so `TEC-KLVK-SFOW-JT-01` (`SFO# V244 ALTAM MOD`) resolves
      with **no ALTAM gate added**.
    - GAPP# (Richmond, Sutro, Sutro) is decided by direction.
    - KOAK SFOE OAK# (north and oceanic rows only) on the southbound `OAK# OAK EUGEN` falls to the walk's
      south row, so Sutro.
  - `engine.ts` `issued` cites the TEC row
  beside the SOP row, and `builtFor` (`engine.ts:60`) moves to the new row choice with the others.
  Altitude follows from rulings 5, 6 and 8: on a flight whose noise or notice row stands, that row's
  altitude row gives the initial altitude (`tecInitialRow` already matches the TEC initial only when the
  procedure is the row's head), and the TEC final altitude still applies.
- **C. The route box (`amend/route.ts`).** With A in place, `expectedRoute` and `checkHeadingRoute` route
  the new flights. `tecTokens` drops a family head when the procedure is a heading (rulings 5 and 6), as it
  already drops a heading head. The bare row gets its navaid from `withVectorNavaid`: check that it yields
  `GAPP7 SFO`.
- **D. The runway draw.** `pickRunway`/`drawScenario` (`scenario/generate.ts:347`, `:468`), the importer's
  `departure_runway` (`generator/src/craft_generator/worksheets.py:701`) and `explainRunway`
  (`rules/runway.ts:89-123`), plus an `RWY-TEC` row next to the other `RWY-*` rows in each airport's
  `sop.yaml` (`ksfo/sop.yaml:469`, `koak/sop.yaml:1098`).
  - After the existing precedence picks a runway, take the flight's first keyed row whose SID its equipment
    can fly. If that SID is not published off the picked runway, move the flight to the first runway of the
    configuration listed for its class that the SID is published off, same family first, as long as the
    same row still keys there. If there is none, leave the runway, and A skips the row.
  - The generator, the importer and the explanation keep one precedence.
- **E. The on-request draw (ruling 7).** In `drawScenario`, after `resolveClearance`, a `requested` draw
  stands only if the procedure is a SID whose runways all lie in the requested family. In KSFO 28/01 that
  means GNNRR3, SNTNA2 and WESLA5. Otherwise the runway is drawn again without the request. Seed `f` then
  stops giving the heavy UPS A306 on 28L with `REQ RWY 28` and GAPP7 radar vectors TRUKN.
  `generate.test.ts:303` asserts the old draw.
- **F. Reports.** Drop the `initialAltitudeFeet` filter at `tecAltitudes.test.ts:203`. Replace the
  never-routed report with an assertion that every `kind: tec` row routes some enumerated flight.

## Named tests (one per invariant)

- A family-headed row wins over a SOP SID: KSFO 28/01 28L RNAV heavy to KSMF → TRUKN2.
- A family-headed row wins over a SOP heading: KOAK SFOE jet to KMRY → OAK6, box `OAK6 OAK EUGEN`.
- A row the equipment cannot fly is skipped for the next keyed row: `/A` jet to KLVK off 01R → `-JT-01`.
- A row whose SID is not published off the flight's runway is skipped: `TRUKN#` destination on 01L.
- A noise window keeps its heading and the box is the row's tail: KOAK SFOE jet to KMRY at 2300 → 140.
- A notice heading keeps its heading and the box is the row's tail; a notice without a heading skips the
  row.
- The bare `GAPP#` row reads `GAPP7 SFO`.
- The procedure and the route box agree for every TEC-routed enumerated flight: where the box begins on a
  SID, the clearance's procedure is that SID.
- Every `kind: tec` row routes at least one enumerated flight.
- The draw puts every TEC-routed flight on a runway its SID is published off, and `RWY-TEC` is cited
  exactly where the draw moved it.
- Every on-request draw carries a SID published off the requested family alone.

## Steps

- [x] **Brief 1: the engine override** landed 2026-09-18 (`798b88d`, merged in `5e46ff8`). Three dispatches:
  the first two stopped on gaps (noise SIDs, the walk skipping a noise SID that doesn't serve the exit,
  the bare `GAPP#` row) that became rulings 8-12 and the SOP 2-2 a sector rule.
  - The row choice is `usableTecRoute` (`tecRoutes.ts`), with `inUseRows` feeding both ruling 9 and
    `dpSectorRow` in `sidSelection.ts`. The table reads the TEC route's exit through `tableRoute`
    (`engine.ts`).
  - No fixture moved against HEAD. The synthetic moved to KTRK (ruling 12). Two KLVK library rows dropped a
    3,000 that no TEC-routed flight can file (`routes.yaml:70,73`), following the file's own header rule.
  - **Interim gap until part 2:** KSFO SFOE props and turboprops to KOAK are `Unresolved` whatever they
    file ("the SOP reads the TEC route TEC-KOAK-SFOE-TP, but filed route GAPP7 has no fix after the
    procedure"), so the draw never picks them. At HEAD they got the SOP's answer.
- [ ] **Brief 2: the runway draw and the on-request draw** (layers D and E, both halves of D plus
  `RWY-TEC`; E is bundled here because it edits the same `pickRunway`/`drawScenario`). Proving commands:
  `scenario/generate`, `rules/runway`, `generator tests/test_worksheets*`, `import-worksheets --check`
  (re-import if runways move, and report any moved fixtures), then `craft-gen build --check` for both
  airports.
  - `explainRunway` still reads the filed route's direction; it moves to `tableRoute`'s.
  - Brief 1 left these for brief 2 to pick up:
    - A box joined onto a noise SID (`joinedExpectation`) cites no TEC row, though its tail is the TEC
      route's. It should cite the row.
    - `engine.ts` imports `tecTokens` and `citeTec` from `rules/amend/`. Move them down to `tecRoutes.ts`
      and `cite.ts`.
    - The `route.test` name "passes over a TEC row that begins on a departure the flight is not issued" is
      stale. That flight now routes on `TEC-KMYV-SFOW-TP-01`.
  - After it lands, re-settle N436MS with the user (ruling 10: 01R, TRUKN2).
- [ ] **Part 2: `RH`, `RV` and heading tokens.** See the section below. It edits `tecTokens` and the route
  parser, and it closes the interim KOAK gap above.
- [ ] **Docs (orchestrator):** ARCHITECTURE.md "The route rule is one rule" (`:128-129`) and the
  amendment-mode section; ADDING_AN_AIRPORT.md's TEC paragraph (`:257-271`); the `tec.yaml` headers. Then
  archive this subplan.

## Part 2: `RH`, `RV` and heading tokens in TEC routes

A new rule concept, raised mid-plan (user 2026-09-18). Its briefs are planned after brief 1 lands.

**Rulings (user 2026-09-18):**

- "Some TEC routes are literally `RH RV` meaning 'fly runway heading, radar vectors direct'." So a row that
  ends in `RV`, or names nothing after a vector SID (bare `GAPP#`, ruling 3), is a legal TEC route: radar
  vectors direct to the destination. It is no longer a row a guard should reject.
- The route box: "If the TEC route contains a RH, RV, or HXXX, then include that." The box keeps those
  tokens as the row writes them:
  - `RH RV` reads `RH RV`, and `H090 RV` reads `H090 RV`;
  - `H270 FEVTA FEVTA1` reads `H270 FEVTA FEVTA1`. Today `tecTokens` drops the heading, so settled KOAK
    fixtures on heading rows will move; list them for the user;
  - a row with none of the three tokens is unchanged: bare `GAPP#` stays `GAPP7 SFO` (ruling 3).
- **Orchestrator reading, to confirm with the user when part 2's report comes back:** the airport-navaid
  convention (`R-RV-NAVAID`) is left as it is, so `OAK6 RV` reads `OAK6 OAK RV`. A box without the navaid
  is graded acceptable, as today.

**Rows to transcribe.** These were left out of `koak/tec.yaml` (the comment at `:112-113` and
`archive/koak-v3.md:395`):

- KOAK→KSFO, SFOW and SFOE: `RH RV`.
- KOAK→KHWD: `OAK6 RV`, `NIMI5 RV` and `H090 RV`, if KHWD is an NCT destination in
  `shared/destinations.yaml`.

Read the plans, classes and altitudes from the route tool
(<https://reference.oakartcc.org/routes?dep=OAK&dest=SFO> and `dest=HWD`).

**Design to plan.** Each item names what reads the tokens today:

- **The row grammar in the generator.** A head is `FAMILY#`, `Hnnn`, `RH`, or a fix or airway. After the
  head comes a route of fixes and airways, or `RV` alone, or nothing when the head is a vector SID.
  - `RH` and `Hnnn` may appear only as the head, and `RV` only as the last token.
  - `_check_fix_spoken` must never look `RH` or `RV` up as a navaid, because `RH` is the Arsha NDB.
  - This grammar replaces MAIN.md's "TEC rows that name no fix" guard.
  - It carries worked examples and non-examples, checked against every row in both `tec.yaml` files.
- **The filed-route reader in the engine.** `parseFiledRoute`, `routeFromExitFix` and `tecHead` read `RH`
  as runway heading, `Hnnn` as a heading, and `RV` as vectors direct.
  - With no exit fix, the direction comes from the destination's navaid (ruling 3's derivation). A
    destination whose navaid is in no gate is reported.
- **Speech and grading.** Add a phraseology row for "radar vectors direct" (source: SOP 2-1 b and this
  ruling). Update `speak.ts`, the dropdown options and the free-text grader so that "fly runway heading,
  radar vectors direct" is spoken and graded.
