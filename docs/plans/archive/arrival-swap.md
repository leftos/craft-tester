# Arrival swap: a flight is routed onto an arrival its equipment can fly, per the LOA

Landed 2026-09-17 on main: `cef27bb` (CIFP arrivals per destination), `b9ca7b6` (common-arrivals table, `R-ARRIVAL`, `arrivalSwap`), `2675bb9` (half-credit verdict, RNAV-clash pair made whole), `9370293` (the engine step in `rules/amend/arrival.ts`, nine fixtures settled, connection rows). The record below is the MAIN.md item as it stood when it landed.

- [ ] **New concept (user 2026-09-16, SWA984): an RNAV jet filing a non-RNAV arrival is amended onto the RNAV
  arrival the LOA routes it by** — **chosen next 2026-09-17**, together with holding every proposed box against the
  LOA rows. Both directions (user 2026-09-17, NKS510: an A320 `/A`, non-RNAV and non-RVSM, filing `CNDEL5 SUSEY
  EBAYE BURGL IRNMN2` to KLAX gets `SKYL1 AVE SADDE8` at FL270: "route-building both ways: SADDE8 is the
  conventional jet arrival, AVE is its entry fix, AVE is also the exit fix of SKYL1, the conventional jet
  southbound SID out of KOAK"). Rule: the flight is put on an arrival of its own class (RNAV-capable → an RNAV
  arrival, non-RNAV → a conventional one) of the destination, reached from a transition or end fix of the SOP's
  SID through the connection table, fewest hops, an arrival transition the LOA row names preferred; a
  radar-vector SID reaches any arrival transition directly. **State 2026-09-17**: (A) landed as `cef27bb`
  (`arrivals: [{id, family, rnav, transitions}]` on every destination row from the CIFP `PE` records; +41 KB KSFO,
  +46 KB KOAK). Then three briefs: **B1** (dispatched, `wt/koak-gen`) the ZOA "Common ZLA Arrivals from ZOA" table
  (current as of 2025-01-13) as `generator/shared/common_arrivals.yaml` emitted as `commonArrivals`
  (`{id: CA-LAX-IRNMN, destinations, classes?, cargo?, family, transitions}`; it settles which of a destination's
  arrivals a rerouted flight is put on and in what order: SADDE8 before MOOR4 at LAX), the shared row `R-ARRIVAL`,
  and `arrivalSwap` on the route amendment (the box as it would read without the arrival change, which is the
  half-credit answer); **B2** the engine swap (running); **B3** landed as `2675bb9`: `Verdict` gains `half` (half
  a box in the score line, a ½ mark and a "full credit:" line in the results, `gradeBoxes` takes the filed
  scenario), and the RNAV-clash pair is the type box against every other box the non-RNAV plan amends, raised
  only where the RNAV-suffixed plan needs no amendment at all (an unresolvable RNAV twin suppresses it too).
  Swap design for B2: the swap triggers on a proposed box (assigned, built, or the heading tail; never a TEC route)
  whose tail ends on an arrival whose `rnav` differs from the flight's capability, or whose family's published id
  differs from the token (stale revision), or that satisfies no LOA route row written for the destination (today's
  `loaRouteGap`, now held against every proposed box); targets are the transitions of the destination's arrivals of
  the flight's class, tried in order: common-table arrivals for the flight's class (and cargo) in table order at the
  transitions the table names, then any published arrival of the class at an LOA-named transition, then at any
  transition; sources, searched breadth-first over the connection rows with always-edges first and a zero-hop hit
  allowed: on the heading path the candidate SIDs in table order (their transitions, then end fix; "always assign a
  DP"), then the fixes of the pre-swap box; on the procedure path the pre-swap box's fixes from the last backwards
  (fewest changes), then the pilot-nav SID's transitions and end fix; a radar-vector SID as the last resort reaches
  any target directly (`OAK6 OAK MACHU TMBRS4`). The result keeps the box up to the source fix, then the chain, the
  transition and the arrival id; the LOA gap is not raised on a swapped box (the swap is the data's best answer;
  NKS510's `SKYL1 AVE SADDE8` meets no LAX jet token) and stays `Unresolved` only where nothing reaches. Predicted:
  SWA984-1A `SSTIK5 SUSEY EBAYE BURGL IRNMN2`, SWA984-1C `GAPP7 SFO EBAYE BURGL IRNMN2`, NKS510 `SKYL1 AVE SADDE8`,
  SWA888 `CNDEL5 KTINA CISKO RDHOT ROKKR3` (the CIFP has ROKKR3), N858EE `CNDEL5 YYUNG TILLT LEGOZ4`, SWA2021
  `OAK6 OAK MACHU TMBRS4`, JSX203 still unresolved (FLCHR sits on Q174, which no connection row reaches from
  NTELL). Decisions taken 2026-09-17 on the implementer's gaps: the target tiers are (1a) each satisfied
  common-table row at the transitions it names, (1b) the same rows at their arrival's remaining published
  transitions (SADDE8 via AVE beats MOOR4 via AVE and cites `CA-LAX-SADDE`; no connection row reaches DERBB),
  (2) LOA-named transitions, (3) any; an arrival the sheet lists for the destination only under rows the
  flight does not satisfy (cargo-only BAYST/DIRBY/LEENA, other classes) is out of every tier; a zero-hop hit
  writes the fix once; on the heading path the issued candidate's row is cited first and `R-HEADING` dropped; a
  destination publishing no arrivals returns the plain LOA gap as before. **Narrowed 2026-09-17 after the first
  engine run** (14 settled fixtures and 5 route-library rows changed, a BE20 to KSMF was put on an Oregon arrival,
  a vector-direct box dropped its gate fix): no `revision` trigger (a stale arrival revision alone stands, as the
  settled HAWKZ7/TMBRS2/SSKII1/COKTL1/MADEE4 fixtures say); the `class` trigger fires only at a destination the
  common-arrivals sheet lists, and where it reaches no arrival the box stands rather than failing; a TRACON
  destination (`nct`) is never swapped; the vector-SID direct fallback keeps the filed fixes ahead of the arrival
  (`OAK6 OAK DEDHD LMT MACHU TMBRS4`); the `loa` reason names the row and its tokens instead of quoting its text.
  Expected survivors for the user: the LOA hold-all cases N918AR (`NIMI6 OAK AVE` to KSMO meets no SMO props
  token; the sheet's WAYVE1 via EHF), SWA1254 (`OAK6 OAK SAC ANAHO` to KBOI; `LOA-ZLC-BOI-ROUTE` NEERO/PRNCS) and
  the KOAK library row `RZS LAX HUBRD1` for jets to KSAN (the sheet gives jets COMIX2 via LAX). **User ruling 2026-09-17 on the RNAV-clash pair (NKS510)**: keep it, and make it whole: "IF the pilot
  agrees that they're /L and misfiled, then the whole flight plan as filed is correct (and since /L is
  RVSM-capable, FL350 should stay). But if the pilot says that indeed due to equipment malfunction they're /A, the
  student needs to be able to amend properly, and that would include the route and altitude adjustment." So the
  pair is type alone versus every other box the non-RNAV plan amends (route and altitude), raised only where the
  RNAV-suffixed plan needs no amendment at all; fixing the type side means the other boxes are expected as filed,
  fixing the other side in full means the type is expected as filed. SWA984 (`/L` B737, KSFO to KLAX, filed `SSTIK5 EBAYE AVE SADDE8`) should expect
  `SSTIK5 SUSEY EBAYE BURGL IRNMN2`: SADDE8 is the non-RNAV LAX arrival (fed from DERBB per the ZOA "Common ZLA
  Arrivals from ZOA" table and the LOA's `..DERBB (Non-RNAV)`), IRNMN2 the RNAV one (BURGL, REBRG), and the LOA's
  LAX jet row names BURGL. Until this lands the fixture is `pending` (flipped 2026-09-16 with this note) and the
  route-building unit test files the conforming route. Design to plan before building: the data needs, per
  destination, which arrivals are RNAV and their transitions (the generator's `destination_stars` already reads
  the CIFP STARs for every library destination; add an RNAV flag from the CIFP record and the transitions); the
  amendment route check, when an LOA jet row is unmet and the flight is RNAV-capable, looks for an RNAV arrival of
  the destination with a transition among the row's tokens that the connection table reaches from the SOP SID's
  transitions (EBAYE → BURGL), and proposes SID + chain + transition + arrival, citing the LOA row and the
  connection; a non-RNAV flight on a non-RNAV arrival stays as today. Also to hold every proposed box against
  the LOA rows, not only a box that already reads right (finding (a) on [koak-v3.md](./koak-v3.md), 3c-ii).
  **User steer 2026-09-16 on scoring**: clearance delivery is mostly responsible for getting aircraft out safely;
  the correct arrival is a nice-to-have that enroute controllers change on the fly and re-clear per LOA and
  destination flow (which can change en route), so a missed LOA arrival / "common arrivals" routing costs
  **half a point, not a full one**. Together with the SFO-token warning above this is a graded-severity concept
  for the route box: a full-point element, a half-point element (LOA arrival routing) and a warning (the vector
  SID's airport navaid); the results view and the score need the three tiers, and the reveal says which applied.
