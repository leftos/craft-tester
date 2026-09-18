# Plan record, frozen 2026-09-17

The plan index as it stood on 2026-09-17, kept verbatim as the record of every item landed between
2026-09-16 and 2026-09-17 and the user decisions behind each. The live index is [../MAIN.md](../MAIN.md);
the previous freeze is [2026-09-16-plan-record.md](./2026-09-16-plan-record.md). Items still open on this
date were carried into the live index and are tracked there, not here. Relative links below were written
from `docs/plans/`; subplans archived alongside this file resolve in this directory, the rest one level up.

## Corrections from the hygiene pass that froze this file

Each line below was probed against the code and git history on 2026-09-17. Where the record contradicts
what the probe found, the probe wins; the text is kept as written because it records what was believed
at the time.

- "14. UI" and "User steer 2026-09-17, amendment form inputs" were left unchecked although both had
  landed; the caret fix (`setSelectionRange` in `ui/app.ts`) and the prefilled NEW VALUE box shipped in
  `856b4b8`.
- "`phraseology.nonStandardInterimExpectMinutes` … no engine module reads it" is no longer true:
  `web/src/rules/altitude.ts:354` reads it for the TEC initial-altitude expect clause. The user's ruling
  (leave it, the three-minute choice is deliberate misdirection) still stands.
- `keepsFiledSid` is cited but exists nowhere in the tree; the nearest symbol is `filedSid()` in
  `rules/amend/type.ts`.
- "UAL313 (`/Q`, FL330, still pending)" is stale: UAL313 settled at both airports in `d48852c`.
- Step 21's "14/52" and "16/52" were both stale; the real count at the freeze is **19 of 52 settled,
  33 pending**, all at KSFO. The KOAK loop closed at 51 of 51 settled.
- "the 37 pending KSFO fixtures" (twice) is stale; the real number is **33**.
- The radar-vector navaid rule landed as `e5f0f99`, a hash the record never cited.
- The "Open:" tail on the N172SP rule ("`resolveAmendedClearance` writes 'expect amended (altitude)' …
  user to decide") was answered by the "will be your final" rule: `amendedExpect` in
  `rules/amend/engine.ts` returns a `final` clause in exactly that case.
- "fleet ceilings" in item 18 was reversed by the later SWA1984 ruling; `ceilingFeet` and `above_ceiling`
  exist nowhere in the tree.
- "16 rows moved" to the shared phraseology file is a landing count; the file carries 26 rows today.

## The index as frozen

## Current focus

- [x] 1–13. Scaffolds, schema, CIFP, charts, SOP transcription, aircraft classes, merge/emit, rules engine, synthetic fixtures, `options`/`grade`/`speak`, seeded scenario generator — landed by 2026-09-15 (archive)
- [ ] 14. UI: strip, ATIS, CRAFT form, results, seed in URL hash — landed 2026-09-15 and steered through 2026-09-16 (archive: result rows, revisit spoiler, expect-runway element, time and configuration filters, C dropped, clean draws and R.sid dropped, "(no prefix)" shape, read-only CRAFT rows, published-top "climb via SID", the acceptable-but-inefficient verdict). Left:
  - [x] Found 2026-09-16: `phraseology.nonStandardInterimExpectMinutes` (3) is in the schema and data but no engine module reads it; every delay comes from `altitudeRules[].expectAfterMinutes`. **User decision 2026-09-16**: leave it, the three-minute dropdown choice is a deliberate misdirection for students
  - [x] **User steer 2026-09-16**: "expect filed altitude 5 minutes after departure" as a second distractor in the expect dropdown — landed 2026-09-16 (order 10, 5, 3, none; `EXPECT_CHOICES` in `options.ts`)
  - [x] **User steer 2026-09-16, amendment layout** — landed 2026-09-16: the read-only strip rows sit in a `Flight plan` panel beside the ATIS and the "Amend the flight plan" panel spans the width below with the three boxes; type and altitude filed values and inputs are 7rem, the route's take the rest of the row (`.amend-box.<box>` and `.field.amend-value` hooks, desktop-only rule); strip-side altitudes at or above 18,000 read as flight levels (`formatAltitude` in `rules/grade.ts`: the strips, the amend boxes, the box verdict labels; the CRAFT altitude dropdown and the spoken labels stay in feet). Left as a choice for the user: the route row's answer and new-value controls start further right than the other two rows' (a grid instead of a flex row would align them at the cost of the narrow boxes). Also fixed: the scenario link overflowed the phone viewport on a long hash. Original steer: the box goes below the ATIS so its boxes can be sized: the type box narrower (six characters at most), the altitude box narrower, the route box longer; altitudes of 18,000 and above are presented as `FL180`, not `18,000`
  - [ ] Playtest observations for the user: the standing `SFO-SEGUL-OFF` notice is in force on 80% of scenarios (`NOTICES_OFF_CHANCE`); seed `f` puts a heavy UPS A306 filing `TRUKN CCR CCR2` (no 28-only SID) on 28L in 28/01 with the remark `REQ RWY 28` (the generator's on-request draw does not require a 28-only filed SID the way the importer does), and the engine then issues GAPP7 radar vectors TRUKN, maintain 3,000, because TRUKN is no SNTNA2 transition and TRUKN# is off the 28s only in 28 RT (a trainer might amend to SNTNA2 instead: amendment mode)
- [x] 15. CI + GitHub Pages — landed; docs finalized 2026-09-16 (README rewritten for the two modes, the layout, the gates and the rule-correction workflow; Pages live at <https://leftos.github.io/craft-tester/>, deploying on every push to `main`; actionlint and zizmor clean; ARCHITECTURE web table covers the amendment generator, the amendment UI and `web/scripts/`; CLAUDE.md graded-elements note covers amendment mode and heading draws)
- [x] 16. `import-worksheets`: seven Google Docs → 70 pending fixtures (18 phraseology + 52 amendment) — landed (archive holds the source findings: UAL313 `/Q` and `BVLQ124`, four truncated rows)
- [x] 17. Validation loop, clearance mode: all 18 phraseology plans settled 2026-09-15 (archive holds the decision record: SOP-over-CBT rows, expect-clause modes, navaid names and facility words, full-route grammar, airway reading, on-request 28s, the ZOA CRAFT Phraseology reference, 28R for GA, worksheet import rules, the CIFP arrivals check, route library vs TEC, the CIFP parser survey and audit). Left open from it:
  - [x] Heading departures are "(via) turn left/right heading (xxx)" ("via turn right heading 315"), for the non-DP heading rows (v1 does not clear them). **User decision 2026-09-16: build it now for KSFO** (not deferred to KOAK); **user rule 2026-09-16**: the heading is introduced by "via" ("cleared to … airport, via fly runway heading", "via turn left/right heading (xxx)"). Landed 2026-09-16 for KSFO's `runway heading` rows: engine, speaker, `R-HEADING`, fixture schema, clearance-mode draws, amendment-mode route check and procedure pick; record in [archive/heading-departures.md](./heading-departures.md). `syn-heading-c172-night-kmyv` reads "cleared to Marysville airport, via fly runway heading, radar vectors Oakland VOR, then as filed. Maintain five thousand." (**user confirmed 2026-09-16**, fixture settled). Numbered headings come with KOAK's data (v3).
    - [x] Landed 2026-09-16: the type box is corrected first and the altitude and route boxes are judged on that plan (`checkSuffix` / `checkRnavClash` in `rules/amend/type.ts`; `judge()` in `rules/amend/engine.ts`); the RNAV pair is raised only where the RNAV-suffixed plan is in fact assigned the filed SID (`keepsFiledSid`); a draw-level test asserts the corrected plan has nothing left to amend (21 of 1,000 seeds failed it before, all suffix faults, two of them single-fault draws whose corrected plan was still wrong); the heading route cites `R-HEADING`. Consequences: UAL313 (`/Q`, FL330, still pending) proposes the type box alone, since `/L` is RVSM-approved and keeps TRUKN2; the merged "suffix gap + RNAV clash" type reason is gone. Original finding (browser check, seed `#s=3y&t=night&c=id:01%2F01&m=amend`): the amendment draw never verified that the corrected plan is clean. A suffix fault that makes an SR22 non-RNAV, drawn beside a wrong-SID fault, has the route box judged against the non-RNAV plan (runway heading → `OAK V6 SAC`), yet the corrected plan `SR22/G OAK V6 SAC` is cleared on SFO5, so the reveal names a SID the corrected route does not carry. Before heading draws landed such draws were rejected (the route box came back unresolved); the same gap exists for any suffix fix that changes the RNAV class. **User decision 2026-09-16: judge the route box against the type-corrected plan** (the route check runs on the plan with the type box already corrected, so both boxes agree with the reveal; the RNAV-clash either/or pair stays). In progress 2026-09-16 (worktree `wt/amend-judged`): the suffix-gap fix is applied first, the altitude and route boxes and the RNAV clash are judged on that plan, the RNAV pair is raised only where the RNAV-suffixed plan is in fact assigned the filed SID, and a draw-level test asserts the corrected plan has nothing left to amend. Nit from the same check: a heading clearance's route element cites `R-RV-SID` ("(SID name and number) DEPARTURE, RADAR VECTORS (fix)…"); `R-HEADING` fits better.
  - [x] Filed altitude below a SID's published top altitude (TBM9 filed 11,000 on TRUKN2, top FL190): the engine issues "climb via SID except maintain (filed)" per 7110.65 4-3-2 c 4, with no expect clause (landed in `c89f636`; **user confirmed 2026-09-16**)
  - [x] SFO5 off the 01s: the override says the 01 side has a crossing restriction (SFO 6 DME at or above 3,000), so the engine says "climb via SID except maintain"; the 28 side has none, so "maintain" (**user confirmed 2026-09-16**)
  - [x] `when.forcedTransition` (NIITE# GOBBS row) — landed 2026-09-16 with route building: a late-night southbound plan off 01 is amended to `NIITE4 GOBBS …` citing the noise row, the corrected plan resolves southbound (`flightDirection` looks past a forced transition to the next gate fix, GOBBS being a north gate), and clearance mode draws such plans between 0100L and 0500L. **User decision 2026-09-16: honour it as a route amendment**: a late-night southbound RNAV flight off 01 gets NIITE4 with the GOBBS transition and the filed route from its first fix (filed `SSTIK5 YYUNG …` → `NIITE4 GOBBS YYUNG …`, read "Niite Four departure, Gobbs transition, direct Yyung, then as filed"), citing the noise row; clearance mode draws such plans already carrying `NIITE4 GOBBS`. Folded into [archive/route-building.md](./route-building.md) step 2
  - [x] CIFP audit finding (2026-09-16, archive item 17 "Stop hand-rolling CIFP parsing"): `navaids.py` and `airports.py` lacked the continuation-record guard (`line[21] in {"0","1"}`) that the procedure parsers apply at column 38. Landed 2026-09-16 with tests: before the guard a VHF limitation continuation row for OAK parsed as a second navaid named "Limitation" and the differing-names rule dropped the Oakland VOR entirely, and an airport continuation row raised `ValueError` from the coordinate parser; both checked-in fixtures hold only primary rows; `build --check` byte-stable
- [x] 18. TEC routes, LOA rules, equipment suffixes, destination coordinates, fleet ceilings — landed (archive)
- [x] 19. Amendment engine — landed 2026-09-15, see [amendment-engine.md](./amendment-engine.md); **user confirmed 2026-09-16** that the amended expect clause keeps its "(minutes) minutes after departure" tail
- [x] **User rule 2026-09-16 (N172SP amendment plan)** (landed 2026-09-16: `asFiledJoin` in `speak.ts`, `originalRoute` on the speaker input, `R-THEN-AS-FILED` cited on every route amendment, the reveal shows one block when both readings agree, `propose` resolves the corrected plan with `resolveAmendedClearance`; N172SP now reads "…radar vectors Oakland VOR, Victor six Sacramento VOR, direct" and is settled; JSX201 keeps "Ntell transition, then as filed"): on an amended plan, "then as filed" may be spoken only when the last fix spoken before it connects to the rest of the *originally filed* route: the amended route must keep a trailing substring of the original, and the controller speaks every element of the amended route up to the first fix that was already on the original plan and after which the two routes are identical, then "then as filed". When no such fix exists (a TEC route that shares nothing with the filed route, a nonsensical filed route replaced outright) the amended clearance is obligatorily a full-route clearance. Example: N172SP filed `SGD SAC`, amended to `GAPP7 OAK V6 SAC`: the only common fix is the last one, so the reading is "Gap Seven departure, radar vectors Oakland VOR, Victor six Sacramento VOR, direct", never "radar vectors Oakland VOR, then as filed". Design (assumptions stated, not asked): the join fix is the first *fix* (not airway) of the longest common suffix of the two routes without their SID tokens; if tokens follow it, the abbreviated reading is the full-route grammar through that fix plus "then as filed"; if nothing follows it or there is no common suffix, both readings are the full route. A `phraseology_rules` row `R-THEN-AS-FILED` states the rule and is cited on the amended clearance's route element whenever the route box was amended. Grading is unchanged (the tail is spoken, not picked); free-text v2 grades it. N172SP stays pending until this lands and its spoken form is re-proposed (dispatched 2026-09-16). Found while proposing SKW2345: `propose.ts` resolved the corrected plan with `resolveClearance`, not `resolveAmendedClearance` as the UI does, so its CRAFT and SPOKEN blocks omitted the amended expect clause (folded into the same brief). Open: `resolveAmendedClearance` writes "expect amended (altitude)" whenever the altitude box changed, even when the corrected plan is cleared straight to that altitude (SKW2345: 19,000 → 9,000, "climb via SID except maintain 9,000"), where the clause would repeat the altitude just assigned; user to decide whether the filed-equals-assigned drop applies to the amended clause too
- [x] 20. Amendment scenario generator + UI + mode switch — landed 2026-09-15, see [amendment-mode.md](./amendment-mode.md); its step D holds the open questions for the user that step 21 consumes
- [ ] 21. Validation loop, amendment mode: 52 worksheet amendment plans, one at a time with the user, as step 17 was. **Paused 2026-09-16 at 14/52 by user steer** ("move on from the validation loop for now; I can point out any mistakes I notice or that users find as they come up"): the 38 remaining fixtures stay `pending` and the suite prints the engine's answer for each; resume by `pnpm -C web propose --pending`. Settled (Practice 1A: AAY218 FL360 → FL350 parity; JSX201 WESLA5 → SSTIK5 off 01L; KAL65 no SID → SFO5 RBL off 01R, truncated tail kept as transcribed; LXJ351 correct as filed, GAPP7 EHF off 01L; N238JP FL320 → FL310; SKW2345 `SFO4 CCR CCR2` → TEC `TRUKN2 TRUKN FEVTA FEVTA1` at 9,000; SWA126 FL330 → FL320 under the ZSE parity LOA; SWA1859 NIITE3 → TRUKN2; N172SP `SGD SAC` → TEC `GAPP7 OAK V6 SAC`, read as a full route; SWA1883 SEGUL1 → SSTIK5 YYUNG under the notice; XOJ715 FL430 → FL410 and OAK6 → TRUKN2. Practice 1C, 28 SO: AAY218 SNTNA2 + FL350, JSX201 WESLA5 as filed, KAL65 GAPP7 RBL). SWA1984 settled as filed once the ceiling rule was removed; SWA984 settled as `SSTIK5 SUSEY EBAYE AVE SADDE8` once route building landed (16/52). Proposed but not confirmed, 1C: LXJ351 as filed, N172SP TEC full route, N238JP SNTNA2 + FL310, SKW2345 `GAPP7 CCR CCR2`. SWA2021 stays unresolved since its KPDX `DEDHD LMT OCITY#` route left the library (the Portland LOA never allowed it)

- [x] **User rule 2026-09-16 (SKW2345)**: "(altitude) will be your final" in place of the expect clause when the altitude box was amended and the clearance speaks that altitude — landed 2026-09-16: `ExpectClause` is `filed | amended | final` (`kind` discriminator), the amendment engine writes `final` when the altitude element's spoken feet reach the amended altitude (a plain "climb via SID" speaks no feet, so it keeps "expect amended … minutes", per the implementer's report of a mid-run steer; SWA126 stays amended), shared row `A-FINAL`, dropdown pick "(feet) will be your final" in both modes (a distractor in clearance mode), fixture schema variant `{feet, final: true}`, `propose` prints both readings. SKW2345 now reads "…Climb via SID except maintain niner thousand. Niner thousand will be your final." Not browser-checked; the session test exercises the pick end to end
  - [x] **User rule 2026-09-16**: where "will be your final" is the answer, "expect amended (altitude) N minutes after departure" at the delay the amended clause would carry is graded `acceptable` — landed 2026-09-16: `redundantExpect` is now "the longer reading the rules still allow" (the chart's note, or the amended clause beside a final clause, cited `A-FINAL`); other delays and "none" stay wrong
- [x] **User rule 2026-09-16 (SWA1984, B738 filed FL430 to KPDX)**: a controller does not apply an aircraft's service ceiling — landed 2026-09-16: the ceiling constraint, its `FLEET-*` citation, the `above_ceiling` fault and the fleet `ceilingFeet` column are gone; SWA1984 settled as correct as filed (FL430 is the even series above FL410, which the ZSE LOA requires)
- [x] **User rule 2026-09-16 (SWA984)**: route building before the vector-SID fallback — landed 2026-09-16 (shared connection table, BFS over always-then-usually edges to keep the filed SID's family, the NIITE# GOBBS forced transition, the `dropped_transition` drill fault, SWA984 settled; record in [archive/route-building.md](./route-building.md)). Original steer: before replacing the SOP's SID with a vector SID, the engine must try to *route-build* in both directions: connect the SID the SOP assigns to the filed route through fixes that are already on the SID's structure or on the filed route (here EBAYE connects to SSTIK5 via SUSEY, which is on SSTIK already, so the answer keeps SSTIK5 rather than switching to GAPP7 radar vectors EBAYE). Source: the ZOA route-building reference the user linked (Google Doc `1rJm0csgkxlLMctyXmiPh-THOHpc4jxQDs9PYbGHO1Hs`, heading `h.hrzqaxjcuncl`; "replace CNDEL for SSTIK" reads its CNDEL example for SFO's SSTIK). Document read 2026-09-16 (text in `.tmp/route-building-doc.txt`; it is the "OAK Route Building Cheat Sheet (vZOA S1-OAK-5)", routes dated 01/20/2025, no author line): a legend `f` for destination / `c` usually connects / `ac` always connects; "Common S/SW Fixes: DPs listed below assume SFOW flow, but the fixes can be used with other compatible DPs depending on flow" then `CNDEL#.YYUNG / COAST#.MCKEY - cTILLT/LAX`, `CNDEL#.KTINA - acCISKO -> cRDHOT`, `CNDEL#.SUSEY - acEBAYE -> cBURGL/AVE`, `CNDEL#.KAYEX - acLOSHN -> cBOILE/CLASN/EHF`, `CNDEL#.NTELL - cQ174`, `SKYL#.AVE`; N/NE: `GRTFL fPDX/EUG`, `DEDHD cRBL -> fSEA/CYVR`, `ORRCA/SAC cQ120`, `MOGEE cQ122/Q124`, `TIPRE cQ126`, `SYRAH cQ128/Q130`, `LIN cJ84`; W: `ALCOA cR463`, `BEBOP cR464`, `CINNY cA220`; tips "first try to make the minimum amount of changes possible; a suboptimal route that is legal per SOPs and LOAs is not an unclean route", "TEC routes should always be used as-is", "always assign a DP if there isn't one". So SWA984 becomes `SSTIK5 SUSEY EBAYE AVE SADDE8` (SUSEY is a SSTIK5 transition, EBAYE always connects off SUSEY). **User decisions 2026-09-16**: (1) the connection table is a shared file every airport inherits, `generator/shared/route_connections.yaml`, rows `{from, to, connects: always|usually, source}` keyed by fix, since the cheat sheet says the fixes work with any compatible DP; (2) both strengths count, chains of `always` edges searched first, then chains with a `usually` edge, either beating the vector-SID fallback, the reason naming the strength; (3) any chain length, breadth-first from every published transition of the SOP's SID until a fix already on the filed route is reached, fewest hops wins, ties by the chart's transition order; (4) the expected route box is the full rebuilt string and it is read "Sstik Five departure, Susey transition, direct Ebaye, then as filed": a chain fix after the transition is spoken with "direct", and the then-as-filed join applies at the first fix of the filed route. Subplan: [archive/route-building.md](./route-building.md)
- [x] **User steer 2026-09-16**: CRAFT phraseology rows are national, not SFO facts — landed 2026-09-16: 16 rows moved to `generator/shared/phraseology_rules.yaml`, every airport inherits them and `sop.yaml` overrides by id (KSFO keeps the four `RWY-*` rows and overrides `A-CLIMB-VIA` and `A-EXPECT`); the 7110.65 cache lives gitignored under `docs/refs/` per section (see `CLAUDE.md`)

## Inputs to fold into the rules

- [x] **Arrival swap (user 2026-09-16, SWA984; 2026-09-17, NKS510)** — landed 2026-09-17 (`cef27bb`, `b9ca7b6`, `2675bb9`, `9370293`): every proposed route box is held against the LOA route rows and, at a destination the ZOA common-arrivals sheet lists, against the flight's equipment; the flight is routed onto an arrival it can fly at the entry fix the sheet, then the LOA, then the chart names, fewest changes first (`rules/amend/arrival.ts`, `buildToArrival` in `rules/routeBuild.ts`, shared `common_arrivals.yaml`, CIFP `arrivals` per destination); the amendment carries `arrivalSwap` and a student who leaves that box earns the new `half` verdict; the RNAV-clash pair is the type box against route and altitude, raised only where the RNAV plan is clean. Nine fixtures settled (SWA984 1A/1C, NKS510, SWA888, N858EE, SWA2021, JSX203, N918AR, SWA1254). Record in [archive/arrival-swap.md](./arrival-swap.md). Left: the KSFO twins of those rulings are still pending (`propose --pending`: 37, JSX203/N858EE twins move the same way; the KSFO SWA2021 twin stays unresolved on the PDX row since nothing filed reaches MACHU); the class-before-LOA precedence when both fire and nothing reaches drops the LOA gap (no fixture hits it); `generate.test.ts` seed-window sweeps for rare draws are fragile to library edits; **the `half` tier is unreachable from the generator** (browser check 2026-09-17: 4,000 KSFO seeds in amendment mode draw no arrival swap, since `scenario/amend.ts` has no arrival fault, so the tier is exercised by fixtures and unit tests only until an `arrival_swap` fault is added; the RNAV-clash pair was checked live at `#s=2z&m=amend`: type fix alone 3 of 3, route fix alone 3 of 3, both 2 of 3 with the route box told the other box already fixes it, no console errors, no sideways scroll on phone)

- [x] **User steers 2026-09-17, equipment suffixes** — landed 2026-09-17 (`e2a31fb`, merged `9cab7b2`): TBL 2-3-10
  citations, `/H` and `/O` as navigation-unknown, shared row `T-MODE-C`, the `no_mode_c` drill fault, and the
  table-order route-building scope below. Original steers (from seed `#s=aam7gy&t=day&m=amend`, a B738/Y drawn at KOAK and
  graded correct as filed): (1) the suffix table is FAA JO 7110.65 TBL 2-3-10 under paragraph 2-3-8, not "Table
  5-4-1" (in 7110.65BB, 5-4-1 is the radar-handoff Application paragraph): every citation in code, data and tests
  moves; (2) TBL 2-3-10 also lists /H (RVSM, any navigation, failed transponder) and /O (RVSM, any navigation,
  failed Mode C), ATC-use-only per the 2-3-8 note. **User decision 2026-09-17: add them as navigation-unknown**
  (`rnav`/`gnss` nullable in the schema and the loader; every reader already treats an absent flag as not RNAV);
  (3) **on VATSIM every aircraft simulates a Mode C transponder** (CoC B4(a) requires a transponder where
  regulation does; the VATSIM transponder has only standby and Mode A+C), so a suffix without Mode C (/X, /T, /D,
  /B, /M, /N, /Y, /C, /V, /S, /H, /O) is illegal on the network: the type box is amended to the fleet's first
  Mode C suffix, citing a new shared row `T-MODE-C`, and the other boxes are judged on that plan (the student's
  `B738/L` and "correct as filed" FL290 were the right answers); the amendment generator draws its RVSM and RNAV
  suffix faults from Mode C rows only (/I, /U instead of /Y, /X) and gains a `no_mode_c` type-box fault so the row
  is reachable from a draw. Found while landing it (seed 896 of the 1,000-seed draw test, surfaced by the
  reshuffle the new fault kind causes): a night northbound plan filed `TRUKN2 SFO RBL …` off 01R was rebuilt to
  `TRUKN2 DEDHD RBL …` under the filed-family scope of route building, although the first applicable row at
  night is the NIITE# noise row, whose SID also builds to RBL via DEDHD; judged again, the corrected plan is
  amended to NIITE4. (An earlier diagnosis blamed the amended altitude; reproduced on main at FL280 and FL290,
  the altitude is irrelevant, and the user asked for the citation.) **Orchestrator decision 2026-09-17,
  extending the user's 2026-09-16 scope rule**: the SOP's table order outranks the filed family and the filed
  family outranks the rows below it, so `buildRoute` builds on a candidate above the filed family that
  connects, and still ignores candidates below it. Question raised alongside: why KATFH3 was not eligible on that draw — because SOP 2-2
  a ii (OAKE) offers southbound jets QUAKE# only; KATFH# is the SFOE row (2-2 a iii). Answered, no change.
- [x] **User steer 2026-09-17: the scenario link does not carry the airport** — landed 2026-09-17 (`856b4b8`):
  an `a=<ICAO>` part written on every scenario link, read on load ahead of the picker's default, and fed to
  the browser check.
- [ ] **User steer 2026-09-17, amendment form inputs**: (1) typing in the route box's NEW VALUE cell jumps the
  cursor to the end after every keystroke, and the altitude box does the same (user checked); cause:
  `restoreFocus` in `ui/app.ts` re-renders on every change and deliberately parks the caret at the end, so the
  fix is to capture and restore the selection range for whichever text input had focus; (2) the NEW VALUE box
  starts out holding the filed value so it can be edited in place, and the student clears it to write from
  scratch (applied to all three boxes; the route is the one the user named). Landed 2026-09-17 (`856b4b8`)
  with the `a=` hash part; the caret fix is browser-checked, not unit-tested (no DOM harness in the suite).
- [x] **User steer 2026-09-17: draw the flight plan as a flight strip** — landed 2026-09-17 (`4c7232c`),
  browser-checked on both viewports; the CWT prefix landed 2026-09-17 (`d189b6a`). Original steer: in both modes, the way vStrips lays one
  out (callsign, weight-class/type/suffix, CID and barcode on the left; beacon, P-time, requested altitude in
  hundreds in the second column; departure and destination; the route wrapped over three lines; blank annotation
  boxes on the right), so an amendment-mode plan reads as one strip carrying every field including the ones to
  amend. Inspiration: `X:\dev\yaat` strip control and its vStrips web app (the whole layout is in
  `src/Yaat.Client.Strips/Views/VStrips/FlightStripControl.axaml`: 535×74, rows 28/23/23, columns
  118/46/90/*/32/32/33, cream `#EEEBE0` cells, `#BFBBAE` borders, `#111111` ink, bold JetBrains Mono 13/12/8,
  route `MaxLines` 3 or 2 with remarks, tail tokens dropped for ` *** ` on overflow, barcode 14 px tall from a
  hash, revision number at 8 px under the callsign). **User decisions 2026-09-17**: (1) the strip is read-only
  in amendment mode and the three answer rows stay in their panel below; (2) the reveal keeps two strips,
  filed and amended, and the amended one carries revision number `1`; (3) cream cells on both themes, a
  three-digit CID derived from the seed, the barcode from the callsign. Orchestrator assumptions: the
  equipment cell reads `H/B744/L` for a heavy or super (`wtc` H or J) and `B738/L` otherwise; the altitude
  cell is hundreds of feet (`290`, `090`); the time cell is `P` plus the local HHMM; the departure cell is
  `KOAK KLAS`; the strip scales down below its 535 px width so a phone shows it whole with no sideways
  scroll. Dispatched 2026-09-17 (worktree `wt/strip-look`); landed in the worktree the same day, with the
  strip column widened so the paper draws at full size on a desktop. **User decision 2026-09-17: the wake
  prefix is the FAA CWT letter (A–I), not the ICAO H/J category** — landed 2026-09-17 (`d189b6a`): the
  user pointed at yaat, whose `FaaAircraftDataService` reads the `CWT` column of the FAA Aircraft
  Characteristics Database already fetched into `generator/shared/`; every one of its 388 rows states one,
  so `cwt` is required on the shared table and each fleet row emits it (`F/B738/L`, `B/B77L/L`, `I/C172/L`).
  Left open: `web/scripts/browser-check.ts` hardcodes port 4173, so two previews cannot be checked at once;
  make the port an env var. Implementer observations, not acted on: `_check_approach_categories` in
  `merge.py` can never fire since `_approach_category` raises first; `scenario/generate.ts` still keys the
  heavy kind on `wtc === 'H'` (correct, the CWT letter is a display value).
- [x] **User bug 2026-09-17: "I don't hear anything when clicking read aloud"** on the read-aloud button
  below — fixed 2026-09-17 (`9f291d7`), proven with a Playwright probe of real Firefox (David picked, a
  5.6 s reading, the second box's reading full length after cancelling the first); awaiting the user's
  retest on the live site. Diagnosed 2026-09-17: Firefox on Windows 11; the button stays pressed a few seconds, no sound.
  Mozilla's own demo in the user's Firefox speaks only with the Windows OneCore voices ("Microsoft David /
  Zira / Mark", not "Desktop"), most listed voices (the "Online (Natural)" and "(Natural)" ones) are silent,
  and Firefox flags no voice `default`, so an utterance with no voice set lands on a silent one. A Playwright
  probe (Chrome and Firefox on this machine, `.tmp/tts-probe.mjs`) also showed Firefox cuts an utterance
  started right after cancelling a speaking one to 0.6 s. **User decision 2026-09-17: auto-pick the voice,
  no voice UI.** Dispatched (worktree `wt/tts-voice`): pure `pickVoice` preferring an en-US David/Zira/Mark
  voice, else a plain local en-US one; the next utterance starts from the cancelled one's end event.
- [x] **User steer 2026-09-17: a TTS icon button on each of the "On frequency" and "With the route read in
  full" boxes** — landed 2026-09-17 (`b1ef6e9`): `ui/speech.ts` reads the box through the browser's Web
  Speech API (en-US, rate 1), `iconButton` in `ui/dom.ts`, pressed state on `aria-pressed`, no button where
  the API is absent; browser-checked. Noted: `browser-check.ts` lists an icon-only button as a blank entry,
  so an icon button is proven by the screenshot or a `click:<label>` action.
- [x] **User steer 2026-09-17: a comma after an airway before its exit fix, for pacing** — "Queue one
  seventy-four, Flchr", while "direct Flchr" keeps no comma between the word and the fix. Seen on the KOAK
  NKS9010 reading "…Ntell transition, Queue one seventy-four Flchr, Coktl Four arrival". Landed 2026-09-17
  inline: `routeUnit` in `rules/speak.ts`, the `R-AIRWAY` row text, data rebuilt, eight speak-test
  expectations; the radar-vectors-airway join already read the fix as its own comma-separated unit.
- [ ] **User steer 2026-09-17: airway structure for conventional rebuilds.** The RNAV element check leaves a
  non-RNAV plan with no conventional route in the data; the J and V airway structure would let the engine
  rebuild one. Sources the user named: yaat's handling of `C:\Users\Leftos\AppData\Local\yaat\cache\NavData.dat`
  (the vNAS nav data) and `C:\Users\Leftos\source\repos\zoa-reference-cli\`, which can pull up any airway.
  Surveyed 2026-09-17, findings and recommendation in [airway-structure.md](../airway-structure.md): parse the
  CIFP `ER` records the generator already downloads (ordered fixes plus high/low, conventional/RNAV, MEA/MAA);
  the vNAS file carries only `id + fixes` and has 224 colliding ids (`J1`, `V6` resolve to foreign routes
  first-wins). Data concept and the rebuild rule still to plan with the user before any engine change.
- [x] **User question 2026-09-17: does the engine flag RNAV waypoints and RNAV airways (Q and T routes) filed by
  a non-RNAV aircraft, or only RNAV procedures?** It did procedures only; landed 2026-09-17 (`d06779a`, one
  commit per the user's decision) — see [rnav-route-elements.md](./rnav-route-elements.md) for the design and
  the decisions. Shared rows `R-RNAV-AIRWAY` (Q needs RNAV, T and Y need GPS, AIM 5-3-4 c 1) and
  `R-RNAV-WAYPOINT` (CIFP waypoint type `W`); `rnavWaypoints` per airport from the CIFP `EA`/`PC` records;
  the route check leaves such a route unresolved for a suffix that cannot fly it and the engine answers with
  the type box raised to the fleet's suffix, judging the rest on that plan; new `rnav_element` drill fault.
  **User confirmed 2026-09-17** the re-opened FDX3859 (B752/L, FL330, OAK6 route) and PXT415 (C25B/L,
  FL310, CNDEL5 KAYEX route) answers and the new `syn-koak-rnav-elements-b738w-klas` fixture (B738/L alone);
  settled 2026-09-17 (`9147f8b`); KOAK now has no pending amendment fixture. Implementer observation: the
  web formatter does not touch JSON fixtures, so their formatting comes from `propose` and
  `import-worksheets`, not from `fmt:check`.
- [x] **User rule 2026-09-16 (FDX3875, KOAK to PHNL via R464): a unidirectional oceanic airway is exempt from
  odd/even parity** — landed 2026-09-17 (`cd341df`): shared `generator/shared/airways.yaml` lists R463, R464 and
  A220, every airport inherits them as `airways`, and the parity walk in `rules/amend/altitude.ts` skips a route
  whose filed tail rides one; KOAK's FDX3875 settled at FL310 (with KAL65, SWA1254, N471RY, N918AR). The KSFO
  twin is among the 37 pending KSFO fixtures
- [x] **User rule 2026-09-16, radar-vector SIDs carry the airport navaid** — landed 2026-09-17 as designed below
  (`withVectorNavaid` in `rules/amend/route.ts`, `warning` on a route amendment and in the fixture schema,
  `gradeBoxes(…, airport)` in `rules/amend/grade.ts` grading the navaid-only difference `acceptable` both ways,
  `composedRoute` in `scenario/generate.ts`, shared row `R-RV-NAVAID`, 13 fixtures re-settled). Left for the user:
  the results view labels an acceptable route box "shorter: …" and counts it "acceptable but inefficient", which
  reads backwards for the navaid case (the proposal is the longer form); the UI never shows an amendment's
  `reason`, only its citations. Original steer and design: a radar-vector SID such as OAK6 or NIMI6
  must be followed in the filed/amended route string by the departure airport's three-letter navaid (`OAK6 OAK RBL`,
  "e.g. OAK or SFO") for computerized flight plan reasons, and that token is ignored when the clearance is spoken:
  `OAK6 OAK RBL` reads "Oakland Six departure, radar vectors Red Bluff VOR". State 2026-09-16: `routeFromExitFix` in
  `rules/route.ts` already skips the airport's own navaid after the procedure token, so the exit fix and the spoken
  reading are right today for `OAK6 OAK RBL` (KOAK's library and TEC rows carry `OAK`). The gap is amendment mode:
  the route box does not require the token after a vector SID, and a built route (a plan filed with no SID, KAL65
  at KOAK) comes out `OAK6 RBL …`. **User decision 2026-09-16: KSFO too, SFO5 and GAPP7** (`SFO5 SFO RBL …`,
  `GAPP7 SFO OAK V6 SAC`), **and at every airport a missing token is a warning, not a scored error**. **Design
  (orchestrator 2026-09-16, assumptions stated; next brief after the fixture settling)**: (1) which SIDs: every SID
  whose `routePhrasing` is `radar_vectors_fix` (SFO5, GAPP7, OAK6, NIMI6, QUAKE2), no new data field; the
  navaid is `airport.faa`; a shared phraseology row `R-RV-NAVAID` states the rule ("a radar-vector SID is filed
  as SID, the airport navaid, then the route, for the computerized flight plan; the navaid is not spoken") and
  is cited. (2) Engine, amendment mode: every proposed route whose head is such a SID reads `SID NAVAID tail`
  (assigned + tail, built, TEC: insert unless the tail already starts with the navaid; KOAK TEC rows already
  carry `OAK`, KSFO's `SFO# OAK V6 SAC` becomes `SFO5 SFO OAK V6 SAC`); a plan whose only defect is the missing
  navaid gets a route amendment flagged `warning: true` (schema `ResolvedAmendment.warning`, fixture
  `amendments[].warning`), and the grader scores a route box that differs from the expected only by that
  token as `acceptable` with the row's text, in both directions (missing or present). (3) Clearance mode: the
  scenario generator composes drawn routes the same way, so a drawn SFO5/GAPP7 plan reads `SFO5 SFO …`; the
  speaker already skips the token. (4) Fixtures: KSFO settled amendment fixtures whose proposed route begins with
  SFO5/GAPP7 are re-proposed and re-settled with `SFO` (user pre-approved), "as filed" fixtures gain the
  warning amendment where their filed route lacks it; KOAK likewise (SWA1859, SWA1984, FDX3859, KAL65, SWA1254,
  N471RY, N918AR, QXE2415, TWY313). (5) `propose` prints the warning flag.

- [x] OAK notices for the second-airport backlog: "OAK QUAKE SID: OFF — issue 270 HDG RV first fix for 12/10 jet departures, CFG OAKE"; "OAK SUNNE SID: OFF — issue 120 HDG RV first fix for jet 30 departures, CFG SFOW noise abatement" — landed 2026-09-16 as the two KOAK `notices` rows with their `heading` effect (`3ee592d`)

## Blockers

None. Worksheets are public Google Docs (ids in the subplan); no browser needed to fetch them.

## Backlog

- [ ] **v2, user steer 2026-09-15, queued next by the user 2026-09-17** ("after that, I'd like to implement the
  free text input feature as an **alternative to** the dropdowns", so the dropdowns stay and the student
  chooses): **free-text clearance entry** so students practise without dropdown hints. The student types (or dictates) the full spoken clearance; the grader normalises both sides (digits ↔ number words, "flight level three two zero" ↔ "FL320", punctuation, optional words such as "airport") and aligns the text against the CRAFT elements of `speakClearance` so each element is still graded green/red with its citation, plus a per-element diff showing what was said versus expected. Needs a tolerant matcher (per-element regex or token alignment), a decision on how strict wording is (accept "climb via the SID"? "then as filed" vs "direct"?), and the same seed/URL sharing as v1. Plan as a subplan before starting. The acceptable-but-inefficient verdict (step 14, 2026-09-16) is where two spoken-only readings belong once text is graded: "then as filed" after a bare exit fix, and a full route spelled out where the abbreviated form would do; the user decides whether they are acceptable or wrong
  - [ ] **First step of the free-text subplan (stack review 2026-09-17): stop re-rendering the input panels.**
    `mount` in `ui/app.ts` replaces the whole page on every state change and `restoreFocus` puts the caret back
    afterwards; that workaround already produced the caret-jumping bug of 2026-09-17 and a free-text box (long
    value, selection, scroll, IME composition, dictation) would make every input a `restoreFocus` case. Render
    the answer form once per scenario and update only the results panel and the strips from state, so the inputs
    are never replaced; then `restoreFocus` and `focusedInput` go. No new dependency. Fall back to Preact or
    Solid for `ui/` only if that refactor needs a hand-rolled diff; the engine and scenario code are pure and
    stay as they are either way
- [ ] **v3, user steer 2026-09-15: KOAK as the second airport** — see [koak-v3.md](./koak-v3.md). Prep done 2026-09-15: OAK ATCT SOP v1.7 downloaded and hashed, 17 DP charts cached, SOP 2-2 tables read, the new rule concepts listed (type-specific class for DH8D, heading departures, hybrid SIDs that are climb-via eligible, continuation charts, approach category, optional noise rows), five OAK worksheets (2 phraseology, 3 amendment) and the S1-OAK-1/2/5 module texts read, the user's "Common Fixes" notes folded in. Status 2026-09-16 (paused by the user): on main — the KOAK data, computed NCT membership, TEC initial/final altitudes with the cruise and override rulings, KOAK in `data/airports.json` (picker works, suite green at 904), shared LOA rules (`generator/shared/loa_rules.yaml`), 50 pending KOAK worksheet fixtures. Brief 3c-ii landed 2026-09-16 (21 ZLA/ZLC routing rows, class and RNAV keys on route rules, the shared destination check). State 2026-09-17: **KOAK has no pending fixture left** — the last two landed with the two rule concepts in [route-token-repair.md](./route-token-repair.md) (`3117367` and `5a86e63`, merged `e041058` and `1736564`; user decisions and settlements 2026-09-17): a filed route is read past the elements its SID already flies over where it files a published transition further along, and a route element that names nothing is dropped with the gap connected. Next: the destination-box concept for AAY218
- [ ] Scheduled workflow that re-runs the generator each AIRAC cycle and opens a PR
- [x] **Stack review 2026-09-17 (user asked whether the project is on the right technologies)**: keep the split.
  The generator is an offline ETL over fixed-width CIFP, scrambled chart PDFs, Google Docs text and an FAA
  spreadsheet, where Python's pypdf, openpyxl and pyyaml are the shortest path; the web half must run as a static
  page, so the rules engine is TypeScript in the browser; the seam is the zod schema and its checked-in export, with
  no logic duplicated across it. Toolchains current (TypeScript 7, Vite 8, Vitest 5, oxlint/oxfmt; Python 3.13,
  uv, ruff, ty), one runtime dependency in the web app and four in the generator, a 229 KB airport file loaded per
  airport, both suites under 15 s. The one finding is the UI render model, slotted under v2 above. The answer
  reopens only if a backend appears (accounts, shared progress, one deployment serving many facilities) or
  dictation moves off the browser's Web Speech API

## Open questions (settled by the validation loops, recorded as data toggles)

See "Open questions" in [craft-trainer-v1.md](./craft-trainer-v1.md#open-questions-to-settle-from-the-worksheets-encoded-as-data-toggles-not-code).

## Landed after the 2026-09-17 hygiene pass

Moved out of MAIN.md by the next hygiene pass (2026-09-17, at `fd05a17`); MAIN.md keeps one line each.

- [x] The answer form is built once per phase and synced in place, so a keystroke or a pick no longer
  destroys the control it came from; `focusedInput`/`restoreFocus` are gone and `viewKey`/`phaseOf` decide
  rebuild-or-sync. No UI framework was needed — the forms hold no dynamic lists. `happy-dom` (dev only)
  gives `ui/app.ts`, `ui/dom.ts` and `ui/amendPanels.ts` their first tests, which assert node identity
  across a keystroke — 2026-09-17
- [x] An airline-default runway row must list a class that airline flies — `_check_runway_defaults`,
  the only place the runway rows and the fleet are joined. Both readers silently dropped a mismatched
  row, so it was dead data with no signal — 2026-09-17
- [x] `LoaData.sources` deleted: parsed, joined and never emitted (user ruling). The three LOA letters it
  held keep their URLs as a comment in `shared/loa_rules.yaml`, where whoever re-verifies a row will look,
  rather than as data nothing reads — 2026-09-17
- [x] An empty amendment-worksheet cell names its row and column instead of shifting the sheet —
  2026-09-17. `_cells` dropped blank lines, so an empty cell vanished and the positional five-cell slice
  shifted every later cell left; any multiple of five blanks passed the modulus check and wrote corrupt
  fixtures silently. Rows are now the next five lines once the six-blank run between them is skipped, and
  every empty cell in the table is reported in one message. **Two limits by design:** an empty *Callsign*
  merges into the boundary run and is still unrecoverable, and an empty last cell of the last row raises
  the short-row error instead, because the export writes no trailing blank run
- [x] A CIFP `VD` leg is an initial climb, not a crossing restriction, so no SID emits a restriction with
  an empty fix and the `rules/route.ts` filter that worked around five of them is gone; COAST9 and NUEVO8
  take `climb_via_eligible` to hold the "CVS x 10,000" the SOP clears them with. `CD` is the same shape and
  deliberately absent — see CLAUDE.md Footguns — 2026-09-17
- [x] KOAK's `direction_runway_preference` maps family 10 to 10L, the north-field runway its P/T class
  default already names, rather than PAC VALLEY's 10R — 2026-09-17 (user ruling)
- [x] `merge._check_approach_categories` deleted: `_approach_category` writes the key unconditionally and
  raises first, so the guard could never fire — 2026-09-17
- [x] A built route that reads past the departure's own structure cites `R-SID-STRUCTURE`, and the reason
  names the SID whose structure it is — 2026-09-17. Threading `dropped` was not enough: `procedureOutcome`
  returns `builtAmendment` first, which cited the row nowhere. Two KSFO departures answer PORTE to SUSEY,
  so `parseFiledRoute` carries every SID that justifies a drop and the clause names the procedure the box
  proposes where that one is among them, else the SID that does carry it
- [x] The `half` verdict tier stays fixture-only — closed by the user 2026-09-17 after an `arrival_swap`
  fault kind would not draw. **Why, so nobody re-opens it blind:** every eligible library route files
  inside the RVSM band (KSFO's four at 31,000-41,000, KOAK's seven at 29,000-35,000) and the suffix the
  fault writes (`/U`) is not RVSM-approved, so the altitude box is raised too and `sameBoxes` discards the
  draw. A drawn swap needs library routes outside the band that neither airport has. The cheaper mechanism
  if it ever returns: `arrivalTrigger` fires on `filed.arrival.rnav !== ctx.rnavCapable` in **both**
  directions, so filing a conventional arrival for an RNAV flight swaps the arrival with no suffix strip.
  Two survey errors corrected against the source: `rnav_clash` is `['type','route']`, not type-box-only,
  and the common-arrivals sheet lists nine destinations, not eight
- [x] `A-ONE-WAY-AIRWAY`: a one-way airway is read against TBL 4-5-1's one-way row in place of parity
  (any whole thousand up to FL410, odd flight levels above, so FL420 on R464 steps down to FL410), and
  the altitude box of such a route cites the row whatever its verdict, so the reveal says why FDX3875's
  FL310 stood — 2026-09-17
- [x] Cleanup (user 2026-09-17):
  - navaids the CIFP does not carry are named once in shared `navaid_names.yaml` (ECA Manteca VOR,
    decommissioned 2018; SMA Saint Mary's NDB; KAE Gangwon VOR);
  - the gate-coverage warning is the `build --coverage` report, so both builds print no warnings;
  - `altitude.ts` has one TBL 4-5-1 FL410 constant, and the RVSM band has one copy;
  - the dead half of the TRUKN2 base-fix test pair is gone.

  The one skipped test left, the fixtures report over pending clearance plans, is conditional by design —
  2026-09-17
- [x] Stack review 2026-09-17: keep the Python-generator / TypeScript-web split. The generator is an
  offline ETL over fixed-width CIFP, scrambled chart PDFs, Google Docs text and an FAA spreadsheet, where
  pypdf, openpyxl and pyyaml are the shortest path; the web half must run as a static page, so the rules
  engine is TypeScript in the browser; the seam is the zod schema and its checked-in export, with no logic
  duplicated across it. The one finding was the UI render model, which is Wave 1. **The answer reopens
  only if** a backend appears (accounts, shared progress, one deployment serving many facilities) or
  dictation moves off the browser's Web Speech API

## Wave 1 items landed 2026-09-17 (results view and amendment form)

- [x] **An acceptable route box reads backwards for the navaid case.** `ui/results.ts:69` labels every
  `acceptable` verdict `shorter: …` and `:48` counts it "acceptable but inefficient", but where the box is
  acceptable because a radar-vector SID's airport navaid is missing or present, the proposal is the
  *longer* form. `Grade` (`rules/types.ts:193-199`) can already tell the two apart three ways: `element`
  (only `A.expect` and `BOX.route` ever carry `acceptable`, and only the expect clause is genuinely
  shorter), the `R-RV-NAVAID` citation that only the navaid case adds (`amend/grade.ts:230-237`), or a
  token count. `results.test.ts:52-68` and `:88-93` pin the current wording. **Ruled (user 2026-09-17):**
  the navaid case reads `preferred: <route>` and its score tail `1 acceptable (airport navaid)`; the
  expect clause keeps `shorter:` and `acceptable but inefficient`
- [x] **The UI never shows an amendment's `reason`, only its citations**, though all three amendment shapes
  require it (`schema.ts:778, 801, 813`). Survey 2026-09-17 corrects this index: the earlier note that
  `ui/session.ts:79` shows it "for unresolved items only" was wrong — that line is `Unresolved.reason`
  (`rules/types.ts:158-162`), the engine's "I could not clear this seed" text, an unrelated type. An
  amendment's `reason` is shown nowhere at all. **Ruled (user 2026-09-17):** a `why: <reason>` line in each
  strip-box verdict row, under the correction and above the citations, in the post-submit Amendments
  panel, the results and the revisit; a box the engine left alone shows none
- [x] **The amendment-mode Results score line splits by half** (user 2026-09-17). Today `resultsBody`
  (`ui/results.ts`) calls `scoreLine(grades, 'elements')` on the whole session list, so the strip boxes are
  counted as elements ("2 of 11 elements correct"). The user's wording, slash included (confirmed):
  "2 of 3 flight plan checks / amendments correct, 0 of 8 CRAFT clearance elements correct". The results
  and the revisit both show it. In
  dropdown mode the clearance half is the procedure pick plus the five CRAFT elements (6); typed, it is the
  eight typed elements. The half-credit and acceptable tails stay with the half they belong to. Clearance
  mode keeps its one line
- [x] **Route row alignment.** The route row's answer and new-value controls start further right than the
  other two rows'; a grid instead of a flex row would align them, at the cost of the narrow boxes.
  **Ruled (user 2026-09-17): the grid**, the three rows sharing columns (label | filed | answer | new
  value), phone width still stacked
- [x] **The corrected strip follows the student's boxes where those were right** (user 2026-09-17, choosing
  this over labelling the engine's plan or drawing both strips). Today `ui/session.ts:112` reads
  `drawn.result.corrected`, the engine's plan, always. Seed 83: a student who fixes the route box alone
  still scores 3 of 3, but the corrected strip shows the engine's type-side fix (`E75L/L` with the filed
  TRUKN2 route). Two things the survey says this needs, neither of which exists:
  - [x] Nothing folds `BoxAnswer`s into a `Scenario`. They are free text; `apply` (`amend/engine.ts:82-87`)
    folds `ResolvedAmendment`s, which carry `proposedFeet`/`proposed`
  - [x] **Ruled (user 2026-09-17): the clearance follows too.** Once the boxes are submitted, the plan is
    the filed plan with each box graded `correct` as the student wrote it and every other box (`wrong`,
    `acceptable`, `half`) as the engine corrected it; the CRAFT clearance is resolved from that plan, so the
    strip and the answer key always agree, and a wrong box still never compounds because it takes the
    engine's value. A plan that does not resolve falls back to the engine's. `ARCHITECTURE.md:98-101`
    ("the engine's corrected plan, never the student's") is restated to match
  - Correction at landing: seed 83 is not a pair seed. It draws E75L/Y with a type amendment only, and
    `s=83` in the hash is base 36 (seed 291, no amendments). The pair seeds among 1-400 are 107 (`s=2z`:
    GL5T/U `SAHEY4 NTELL`; the engine fixes the suffix to /L, the student can file `GAPP7 SFO NTELL`) and
    352. `app.test.ts` uses 107. Landed as `studentPlan` (`rules/amend/grade.ts`) and `clearedPlan`
    (`ui/session.ts`), with a `console.warn` fallback to the engine's plan
- [x] **Cleanup (user 2026-09-17): `selectControl` selects after inserting.** `ui/dom.ts` marks the chosen
  option `selected` before appending it; happy-dom drops that, so no DOM test can read a dropdown's first
  render (`app.test.ts` works around it with a "shape" pick). Set `select.value` once the options are in,
  then drop the workaround
- [x] **Cleanup (user 2026-09-17): `clearedPlan` resolves once per answer set.** `onBoxesSubmit` and each
  phase's panels call it again, so an unresolvable plan warns two or three times; memoise it per view and
  answers
