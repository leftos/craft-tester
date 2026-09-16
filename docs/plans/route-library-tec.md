# Route library as the correctly-filed baseline

Subplan of step 17 in [MAIN.md](./MAIN.md) (the "Route library vs TEC" item). Started 2026-09-16.

## Problem

The step 20 fault injector found that every NCT destination's `routes.yaml` tail differs from the
transcribed TEC route, so those plans read as clean in clearance mode but always take a route amendment
in amendment mode. The user decided 2026-09-15 that the library carries the TEC route and its cap: a
clean plan is one the amendment engine has nothing to say about, and wrong plans come only from the
fault injector.

Surveyed 2026-09-16, the fix is not a data pass:

- A TEC row is keyed by plan, runway family and class (`tecRow` in `web/src/rules/amend/route.ts` takes
  the first match), and its route begins on a DP family. A library row is keyed by exit fix and classes
  only, and the draw picks the configuration independently. No plan-agnostic tail is right in both plans
  (KSMF props: `OAK V6 SAC` in SFOW, `OAK V244 ALTAM V392 SAC` in SFOE).
- SNTNA2 and CIITY3 serve the six enroute transitions and their own base fix only (`data/ksfo.json`), so
  in 28/01 (P/T default to 28R) and 28 SO a flight filed via TRUKN gets GAPP7 radar vectors, and a TEC
  row beginning `TRUKN#` cannot be issued there. The clean tail therefore depends on the configuration.
- The amendment engine's TEC lookup ignores what the SOP assigns: a /A BE20 to KSMF is told to amend
  onto `TRUKN2`, and the `(28)` rows behind the catch-all `TRUKN#` rows are unreachable.
- `tecMatches` in `amend/altitude.ts` takes the first row *with a cap*, so a flight routed on a capless
  row (KSAC turboprops) is capped by a different row's figure.
- KSMF's `[9000, 10000]`: the course to KSMF is 016° magnetic, odd, so 10,000 is already a parity
  amendment. The library's altitudes were never checked against the amendment engine.

**User rule 2026-09-16 (radar-vector SIDs):** a radar-vector SID (GAPP#, SFO#) can be vectored to any
initial fix, not only those its chart or the CIFP lists; competing vector SIDs off the same runway may be
preferred for their own designated fixes, but they are flexible where pilot-nav and hybrid SIDs are not.
`servesExitElement` in `sidSelection.ts` already reads this way, which is why GAPP7 radar vectors TRUKN
is the clearance off 28R in 28/01.

## Decisions (user, 2026-09-16)

1. **Verify at draw time.** No new `routes.yaml` keys. `drawScenario` already runs the clearance engine;
   it also runs `resolveAmendments` on the composed plan and returns `Unresolved` when the result is not
   ok or reports any amendment, so `generateScenario` redraws exactly as amendment mode does today. The
   amendment engine is the single definition of clean. Rejected alternatives: a `plans`/`rnav` key on the
   row (leaves 28/01 turboprops dirty), a `when` block mirroring assignment rules (six rows for KLVK
   alone, re-derived by hand on every TEC change), a row that references a TEC id (derivation code plus a
   first-match check).
2. **A TEC row applies only when the SOP would issue the DP it begins on to this flight here.** This
   generalises the approved RNAV skip (a non-RNAV flight is never assigned an RNAV DP) and covers the
   runway and configuration cases (28R in 28/01 is assigned GAPP7 or SNTNA2, never TRUKN2). SOP 2-1 b
   in the `tec.yaml` header says what happens otherwise: "if a pilot cannot accept one, vectors direct",
   which the engine reads as the assigned SID plus the filed tail, with no cap. The route and altitude
   modules share one matcher, and the cap comes from the row that routes the flight or from nowhere.
   Refined 2026-09-16 after the first brief: the matcher must not compare against the SID assigned for
   the *filed* tail, because a wrong tail (`SFO4 CCR CCR2` to KSMF off 01R) is assigned the vector SID
   and then no TEC row matched, so the plan got a version fix instead of the TEC route and the
   `wrong_tec_route` fault share fell from 2% to 0.3%. The matcher instead clears the candidate plan
   with the TEC route as filed and accepts the row when the clearance engine assigns that DP.
3. **NCT rows become the TEC tails**, one row per distinct tail the TEC rows issue, so every
   configuration, class and suffix finds a clean row. Altitudes sit at or below the cap on the
   direction-of-flight parity (courses from `magneticCourse` with the airport's 14°E variation: KSMF
   016° odd, KMRY 144° odd, KWVI 132° odd, KLVK 066° odd, KOVE 003° odd, KAPC 353° even).

## Rows

| destination | exit fix | tail | classes | altitudes | TEC rows |
| --- | --- | --- | --- | --- | --- |
| KSMF | TRUKN | `TRUKN FEVTA FEVTA#` | T, J | 7000, 9000 | TEC-KSMF-SFOW-J (cap 10,000) |
| KSMF | CIITY | `CIITY FEVTA FEVTA#` | T, J | 7000, 9000 | TEC-KSMF-SFOE-J (no cap) |
| KSMF | OAK | `OAK V6 SAC` | P | 3000, 5000 | TEC-KSMF-SFOW-P-01/-28 (cap 6,000) |
| KSMF | OAK | `OAK V244 ALTAM V392 SAC` | P | 3000, 5000 | TEC-KSMF-SFOE-P (cap 6,000) |
| KMRY | EUGEN | `EUGEN` | P, T | 3000, 5000 | TEC-KMRY-SFOW-TP (cap 5,000) |
| KMRY | OSI | `OSI V25 SNS` | P, T | 3000, 5000 | TEC-KMRY-SFOE (cap 5,000) |
| KWVI | EUGEN | `EUGEN` | P, T | 3000, 5000 | TEC-KWVI-SFOW-TP (cap 5,000) |
| KWVI | OSI | `OSI V25 SNS` | P, T | 3000, 5000 | TEC-KWVI-SFOE (cap 5,000) |
| KLVK | TRUKN | `TRUKN ALTAM` | T, J | 3000, 5000 | TEC-KLVK-SFOW-JT (cap 5,000) |
| KLVK | TRUKN | `TRUKN` | P | 3000, 5000 | TEC-KLVK-SFOW-P (cap 5,000) |
| KLVK | OAK | `OAK V244 ALTAM MOD` | P, T | 3000, 5000 | TEC-KLVK-SFOW-JT-28, -SFOE-P, -SFOE-T (cap 3,000 for T) |
| KLVK | CIITY | `CIITY ALTAM` | T, J | 3000, 5000 | TEC-KLVK-SFOE-JT (cap 5,000) |
| KOVE | ORRCA | `ORRCA` | T, J | 7000, 9000 | TEC-KOVE-SFOW-JT (cap 10,000) |
| KOVE | OAK | `OAK V6 SAC` | P, T | 3000, 5000 | TEC-KOVE-SFOW-TP-01/-28 (cap 5,000) |
| KOVE | CIITY | `CIITY ALTAM` | T, J | 3000, 5000 | TEC-KOVE-SFOE-JT (cap 5,000) |
| KOVE | OAK | `OAK V244 ALTAM MOD` | P, T | 3000, 5000 | TEC-KOVE-SFOE-TP (cap 5,000) |
| KAPC | SAU | `SAU` | P, T | 4000 | TEC-KAPC, TEC-KAPC-SFOE (cap 5,000) |

Dropped: KWVI `OAK V107 CATHE V111 SNS` (the seed-5 playtest route; V244/V392/V6 on the KTRK row keep
the airway reading exercised), KOVE `OAK V6 SAC V23 YUBBA` at 17/19,000, KAPC `SGD`. The KMRY jet row
(`GAPP# EUGEN`, cap 10,000) and KLVK/KOVE jets on the P/T tails are left out; add them if a plan needs
them. Non-NCT rows are checked by the same test and their altitudes corrected where the amendment engine
objects.

## Steps

- [x] A1. (landed 2026-09-16, first cut keyed on the assigned family; the issuable predicate is step 1 of
  the second brief) `web/src/rules/amend/tec.ts`: `tecRouteFor`, the first `kind: tec` row for the
  destination, plan, runway family and class whose leading `FAMILY#` DP the SOP would issue this flight
  (a row with no leading placeholder applies regardless). `route.ts` and `altitude.ts` call it;
  `tecMatches` and the cap-first lookup go. Tests in `route.test.ts` and
  `altitude.test.ts`: /A BE20 off 28R in 28/01 filing `GAPP7 TRUKN FEVTA FEVTA1` to KSMF gets no route
  amendment and no cap; /L B738 off 01R filing `GAPP7 TRUKN FEVTA FEVTA1` is amended to
  `TRUKN2 TRUKN FEVTA FEVTA1`; /L TBM9 off 28R in 28/01 filing `GAPP7 TRUKN ALTAM` to KLVK is amended to
  `GAPP7 OAK V244 ALTAM MOD` citing TEC-KLVK-SFOW-JT-28; a KSAC turboprop routed on the capless
  TEC-KSAC-SFOW-T is not capped
- [x] A2. (landed 2026-09-16; before the data rewrite 306 of 1,000 raw draws were rejected against the
  test's bound of 100, and the amendment injector's own retry loop stopped firing, 1.00 attempts per
  accepted draw) `drawScenario` verifies the composed plan with `resolveAmendments` and returns
  `Unresolved` naming the box and reason when it is not clean; `wrongTecRoute` in `scenario/amend.ts`
  never picks a tail the destination itself files
- [x] B1. (landed 2026-09-16; 34 → 43 rows; the gate-fix warning fell to 39 because CIITY, OSI and SAU
  are now filed) `routes.yaml` NCT rows per the table; `craft-gen build`; fixture and worksheet routes
  untouched
- [x] B2. (landed 2026-09-16, 26k combinations in under a second) `web/src/scenario/library.test.ts`:
  for every library row, altitude, configuration, departure runway, fleet type of the row's classes and
  suffix of that type (day, default notices), compose the plan as `drawScenario` does and run the
  engine; assert every row and every altitude is clean in at least one combination; print per-row clean
  rates. Rows it corrected or removed:
  - KDEN via MOGEE: FL340/FL360 → FL330/FL350 (061° magnetic, odd); PHNL via BEBOP: FL310/FL350 →
    FL300/FL340 (238°, even). Both were parity amendments on every draw
  - **KPDX via `DEDHD LMT OCITY#` removed**: clean in 0 of 608 combinations because `LOA-ZSE-PDX-ROUTE`
    demands MACHU, MOXEE or OED and the tail names none. The row generalised the SWA2021 worksheet plan
    (`TRUKN2 DEDHD LMT OCITY7`), which the amendment sheet files *because* it breaks the LOA; that plan
    stays as its fixture and as a `route.test.ts` case. KPDX keeps `GRTFL MACHU TMBRS#`, clean everywhere
  - Every other row is clean in at least half its combinations except the NCT rows written for one plan,
    which are clean only in that plan's configurations by design (an SFOE tail is rejected in SFOW)
  - The redraw bound in `generate.test.ts` rose from 100 to 300 raw rejections per 1,000 seeds, with the
    reason written on the constant: the configuration is drawn before the row, and about a fifth of raw
    draws are a tail written for the other plan
- [x] C. (2026-09-16) Docs: `ADDING_AN_AIRPORT.md` §4 (rows are drawn only when clean; NCT rows are the
  TEC tails, one per tail the TEC rows issue), MAIN.md, the amendment-mode finding. `ARCHITECTURE.md`
  does not describe the draw. Browser check of a KLVK and a KSMF draw in both modes: not done, offered
  to the user with the commit
- [ ] D. **User steer 2026-09-16**: run the browser check, but first add a dev cheat, an undocumented
  URL argument that forces the drawn destination (e.g. `d=KLVK`), so testing a destination does not
  mean drawing until the RNG lands on it. Rides in the URL next to the seed, not in the UI, not
  remembered; the draw filters the library to that destination's rows and redraws as usual

## Findings to carry

- `TEC-KLVK-SFOW-JT-01` reads `SFO# V244 ALTAM MOD`, an airway first: the gate direction would come from
  ALTAM, which is in no gate, so a plan filed that way is unresolvable. Nothing files it today
- `TEC-KAPC` claims every SFOW runway for `GAPP# SAU`, but northbound GAPP# is 28-only (SOP 2-2 a), so off
  the 01s the row never applies and a prop gets SFO5 radar vectors SAU with no TEC route. Check the route
  tool for a `(1)` row
- Seeds draw different scenarios after this change (the route pool and the rejection loop both changed)
