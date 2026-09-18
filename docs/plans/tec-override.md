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
3. **Bare `GAPP#` (`TEC-KOAK-SFOE-TP`) reads `GAPP7 SFO`, then vectors.** It is read the way every vector
   SID is filed, with the airport navaid after it (`R-RV-NAVAID`).
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

## What changes (measured 2026-09-18)

A throwaway enumeration ran every family-headed `kind: tec` row against every flight it is keyed for: each
configuration of the row's plan, each runway its families allow, and each fleet type and suffix of its
classes, filed on the row's own route at 1300 on a Tuesday (no noise window). It then sorted out the flights
`tecRouteFor` does not route today.

- **71 rows lose some flights today, not just the five never-routed ones.** The override routes the flights
  the SOP gives another answer.
- **KSFO:** 10 SFOW rows that begin `TRUKN#` (KSMF, KLVK, KMYV, KOVE, KSAC, O88, KOAK) lose every flight off
  28L/28R in 28/01 and in 28 SO, where the SOP assigns SNTNA or GAPP. That is roughly 1,000 enumerated
  combinations, all of which become TRUKN2. `TEC-KOAK-SFOE-TP` resolves nothing today ("filed route GAPP7
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
  departure runway, and `!sid.rnavRequired || ctx.rnavCapable`), and no active `sid_off` notice without a
  heading takes the family out of use;
- a heading head (`H270`) or a fix or airway head (`EUGEN`) is always usable.

The flight's TEC row is the first usable row in table order. With a family head, the clearance's procedure
is that SID, unless the SOP walk ends on a noise-window row or on a notice that issues a heading. In those
two cases the heading stands and the route box is the row's route with its head dropped.

| Flight | TEC row | Result |
| --- | --- | --- |
| KOAK SFOE, 10R, RNAV jet to KMRY, 1300 | `TEC-KMRY-SFOE-J` `OAK# OAK EUGEN` | OAK6, box `OAK6 OAK EUGEN` (today: runway heading, the tail stands) |
| KSFO 28/01, 28L, RNAV heavy jet to KSMF | `TEC-KSMF-SFOW-J` (`TRUKN# …`) | TRUKN2 off 28L (today: GAPP or SNTNA) |
| KSFO SFOW, 01R, `/A` jet to KLVK | `-JT` skipped (RNAV) → `-JT-01` | SFO5, box `SFO5 V244 ALTAM MOD` |
| KSFO SFOE, prop to KOAK | `TEC-KOAK-SFOE-TP` `GAPP#` | GAPP7, box `GAPP7 SFO` |
| KOAK SFOE, RNAV jet to KMRY, 2300 (`sfoe_night`) | `TEC-KMRY-SFOE-J` | noise row: heading 140, box `OAK EUGEN` |
| KSFO 28/01, jet drawn on 01L to a `TRUKN#` destination | `-JT` | the draw puts it on 01R and RWY cites `RWY-TEC` |
| KSFO 28 RT, a row whose SID is 01s-only (SSTIK5) | — | no runway flies it, so the row is skipped |
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
  whose row has a heading head is given that heading. Either way the TEC row is cited. The departure frequency is still the sector of the SOP row the walk reached, because that
  row is keyed on the direction the flight leaves in. Where the walk reaches no row (KLVK `-JT-01`, whose
  exit fix ALTAM is in no KSFO gate, `ksfo/sop.yaml:164`), brief 1 reports the flight. Each one is a data
  fix to rule on with the user, not a fallback invented in code.
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

- [ ] **Brief 1: the engine override** (layers A, B, C and F, with the named tests except the two draw
  ones). Proving commands are scoped to `rules/tecRoutes`, `rules/amend/tec`, `rules/amend/route`,
  `rules/sidSelection`, `rules/altitude` and `rules/tecAltitudes`. Then
  `pnpm -C web test rules/fixtures` runs **as a report**: moved fixtures are listed as settled or pending,
  with old and new values, and none is edited. The report also lists the flights the walk leaves without a
  sector and the heading-row disagreements (layer A).
- [ ] **Review with the user:** every settled fixture brief 1 moves, the sector gaps (ALTAM), and the
  heading-row disagreements.
- [ ] **Brief 2: the runway draw and the on-request draw** (layers D and E, both halves of D plus
  `RWY-TEC`; E is bundled here because it edits the same `pickRunway`/`drawScenario`). Proving commands:
  `scenario/generate`, `rules/runway`, `generator tests/test_worksheets*`, `import-worksheets --check`
  (re-import if runways move, and report any moved fixtures), then `craft-gen build --check` for both
  airports.
- [ ] **Docs (orchestrator):** ARCHITECTURE.md "The route rule is one rule" (`:128-129`) and the
  amendment-mode section; ADDING_AN_AIRPORT.md's TEC paragraph (`:257-271`); the `tec.yaml` headers; and
  the doc comments in `tecRoutes.ts` and `sidSelection.ts`. Then archive this subplan.
- [ ] **Unblocked afterwards:** MAIN.md's "TEC rows that name no fix" guard. Under ruling 3 a bare
  radar-vector SID head is a legal row, so the guard's narrow version must accept it.
