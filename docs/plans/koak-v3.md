# KOAK as the second airport (v3)

Subplan of [MAIN.md](./MAIN.md). Follows [ADDING_AN_AIRPORT.md](../ADDING_AN_AIRPORT.md); this file records what
the OAK sources say and which new rule concepts they need before any YAML is written.

## Sources gathered 2026-09-15

| source | where | state |
|---|---|---|
| Oakland ATCT SOP v1.7, 18 pp | `https://oakartcc.org/controllers/file/1217f464-6766-11e9-8010-2a32edb55910`, sha256 `21f5fdfb40c879e7418e02339a41e48261975797505fc6b1ea76f0b409ab5935` | in `generator/cache/sop/21f5fdfb40c8.pdf`; text in `.tmp/oak-sop.txt` |
| DP charts | charts API `apt=OAK`: 17 entries = 11 procedures + 6 `CONT.1` continuation sheets | PDFs cached under `generator/cache/pdfs/2609/00294*.PDF` |
| CIFP | same FAACIFP18 as KSFO; `PD` records for KOAK not yet inspected | cached |
| S1-OAK-2 "Clean Clearances" (module `25b6cfd3-dba7-11ea-844f-2a32edb55910`) | worksheets: Phraseology Practice 1A (SFOW, abbreviated) `1mQd9jyb0jT18V4-zcT11sgQFqU-rqxpvYi7nLoEGnq4`, Phraseology Practice 2 (SFOW, full route) `1H-UOCLNPRNu6YyOlkyOOmMsxwjkT6KvxPZooum3ymd4` | text exports in `.tmp/oak-ws-*.txt`; same form shape as the SFO sheets |
| S1-OAK-5 "Unclean Clearances" (module `fcec63e0-249a-11ed-8c3d-2a32edb55910`) | Amendment Practice 1A `1kcIMVHUhKnK33tL71JdRukDoHw0qILnkOQeq20fMXGU`, 2 `1sYysW7ZB6tge1fpAWgVEMGbGSMdGtO3fGb0Tgf8RMws`, 3 `1hxT2tZxNMJ8wsd2IaP1ui1zzercsL2gEBEGs8bvUSkg` | text exports fetched 2026-09-15 |
| OAK CBT deck(s) | S1-OAK-1 (or -0) module, not yet opened | pending |

## Training-module text worth encoding (S1-OAK-2 and S1-OAK-5, read 2026-09-15)

- "If our fix is a VOR we should state it as such: RADAR VECTORS LINDEN VOR" (confirms the facility-word rule).
- "Know when you can use CVS / CVS except maintain and when you can't."
- Full routes: "a three letter identifier is a VOR, five letters is a fix, five letters and a number is an arrival; airways
  are Q###, J###, V###, T### and act like freeways: we specify the onramp and the offramp; fix to fix we say direct".
- Worked example: `NIMI5 OAK V244 ALTAM MOD NTELL` → "Nimitz Five departure, radar vectors to join Victor Two Fower
  Fower, ALTAM, direct Modesto VOR, direct Intel (NTELL), direct". Notes: the airport's own navaid `OAK` is skipped and
  the airway is the exit element (matches `radar_vectors_airway`); the offramp fix after the airway is spoken bare;
  the airway digits are spoken digit by digit there ("two fower fower"), but the user pointed to FAA JO 7110.65 2-5-1,
  which prescribes group form ("Victor Twelve", "J Five Thirty-Three", "Q One Forty-five", "Tango Two Ten"): the
  module example is informal and the trainer keeps group form. 2-5-1 also fixes the letters: "Victor" as a word, "J"
  and "Q" as letters, "Tango" phonetic; 2-5-2 lets a NAVAID in a routing be its name, ZOA practice adds the type.
- Amended altitude: "Climb via SID except maintain FL190, expect amended flight level tree tree zero one zero minutes
  after departure" (confirms the amended form with the minutes tail).
- Amendment-mode scripts for the UI: "(callsign) filed altitude flight level three five zero inappropriate for direction
  of flight, flight level three six zero available"; "(callsign) full route clearance available, advise when ready to
  copy"; "(callsign) amend your clearance, climb and maintain seven thousand"; "(callsign) can you accept routing
  Skyline One departure Avenal transition SADDE8 arrival?".
- Common ZOA-SID to ZLA-STAR fix pairings for SoCal (route validation data): SUSEY EBAYE → BURGL; KTINA CISKO → RDHOT;
  KAYEX LOSHN → CLASN; MCKEY/YYUNG → TILLT.
- Tools trainees use to build routes: SkyVector, FlightAware, the ZOA Info Tool, SOP, LOAs.
- S1-OAK-1 "Clearances Introduction" (module `4191b45b-7f98-11e8-a6af-2a32edb55910`) scripts: "cleared to Los Angeles
  International Airport, Candle Five (CNDEL5) departure, Susie (SUSEY) transition, then as filed. Climb via SID,
  departure frequency one three five point one, squawk …" (CNDEL# = plain climb via, matching SOP "CVS (CNDEL#)");
  "cleared to Seattle Tacoma Airport, Oakland Six departure, radar vectors Deadhead (DEDHD), then as filed. Climb via
  SID except maintain flight level one niner zero, departure frequency one two zero point niner". **OAK6 is a
  vector-hybrid SID that is still climb-via eligible** (it has published restrictions), so `climbViaEligible` must not
  exclude vector hybrids by kind alone; make it an override or derive it from the CIFP restrictions. The module also
  teaches three departure types: radar vectored, pilot nav (RNAV and conventional), hybrid. Spoken names: "Candle" for
  CNDEL, "Susie" for SUSEY, "Deadhead" for DEDHD: five-letter fixes have conventional pronunciations that the speaker
  should carry as `fix_spoken` rows where a trainer states them.

## User's own study notes (Google Doc `1rJm0csgkxlLMctyXmiPh-THOHpc4jxQDs9PYbGHO1Hs`, "Common Fixes", as of 2025-01-20)

- Common fix groupings for KOAK SFOW: N/NE with OAK# (AMAKR/ENI oceanic NW; GRTFL for PDX/EUG; DEDHD via RBL for SEA/CYVR;
  ORRCA/SAC to Q120; MOGEE to Q122/Q124; TIPRE to Q126; SYRAH to Q128/Q130; LIN to J84). S/SW: CNDEL#.YYUNG / COAST#.MCKEY
  to TILLT/LAX; CNDEL#.KTINA → CISKO → RDHOT; CNDEL#.SUSEY → EBAYE → BURGL/AVE; CNDEL#.KAYEX → LOSHN → BOILE/CLASN/EHF;
  CNDEL#.NTELL → Q174; SKYL#.AVE. W oceanic with OAK#: ALCOA → R463, BEBOP → R464, CINNY → A220. Oceanic airways may be
  unidirectional, in which case odd/even parity does not apply (amendment-mode exemption to encode).
- Common routes (seed for `koak/routes.yaml`): LAX `CNDEL5 SUSEY EBAYE BURGL IRNMN2`; LAS `CNDEL5 NTELL Q174 FLCHR COKTL4`
  (at or below FL310); SAN `CNDEL5 YYUNG LAX COMIX2` / `COAST9 MCKEY LAX COMIX2` / `COAST9 RZS LAX HUBRD1`; BUR `CNDEL5 KTINA
  CISKO RDHOT ROKKR3` (aob FL310); SNA `CNDEL5 YYUNG TILLT RUKKI1`; SEA `OAK6 OAK DEDHD RBL LMT HAWKZ8`; PDX `OAK6 OAK GRTFL
  MACHU TMBRS3`; SLC `OAK6 OAK MOGEE Q124 BVL YUTES1`; PHX `CNDEL5 KAYEX LOSHN BOILE BLH HYDRR1` / `SKYL1 AVE BOILE BLH`; LGB
  `CNDEL5 YYUNG TILLT RUKKI1`; DEN `OAK6 OAK SYRAH Q128 JSICA ILC EYPUZ IBSKI BUMMP SSKII3`; props to LAX `NUEVO8 SNS AVE LAX`.
- LOAs to encode for amendment mode: ZOA–ZLA (and SBA/FAT/BFL) at-or-below restrictions to some ZLA destinations, e.g.
  KLAS; ZOA–ZLC "north of KRAZY" (JSICA is north of KRAZY) and KSLC routes needing BVL or MLF for RNAV, REO for
  conventional; ZOA–ZSE parity shifted by 20° (already in `loa.yaml`).
- Heuristics the user teaches: TEC routes have an assigned altitude, AAR/ADR routes do not (consistent with `kind` in
  `tec.yaml`); LOA instructions outrank AAR/ADR routes; work left to right, equipment code → altitude → route; always
  assign a DP when none is filed; no STAR needed for destinations outside ZOA unless an LOA requires one; a stale DP
  revision (OAK9 for OAK6) is a common typo/AIRAC problem; make the minimum change that yields a legal route.
| TEC routes | `reference.oakartcc.org/routes?dep=OAK&dest=…` | not yet transcribed |
| LOAs | ZOA–ZSE already in `loa.yaml` (shared concept, airport-specific file) | reuse |
| notices | QUAKE SID off in OAKE (270 HDG RV first fix for 12/10 jets); SUNNE SID off in SFOW noise abatement (120 HDG RV first fix for jet 30 departures) | in MAIN.md |

## Procedures the charts API lists

CNDEL5 (RNAV), COAST9 (+cont), HUSSH2 (RNAV), KATFH3 (RNAV), NIMITZ6, NUEVO8 (+cont), OAKLAND6 (+cont), QUAKE2,
SALAD5, SILENT3 (+cont), SKYLINE1 (+cont), SUNNE1. SOP shorthand: OAK#, CNDEL#, SKYL#, COAST#, NUEVO#, NIMI#,
QUAKE#, KATFH#, HUSSH#, SLNT#, SUNNE#, SALAD#.

## What the SOP says (2-2, flattened by pypdf; verify each row against the PDF before transcribing)

Runway configurations (1-6): SFOW = OAK 28s and 30; OAKE = OAK 10s and 12 while SFO uses the 28s; SFOE = OAK 10s
and 12 while SFO uses 19s/10s.

2-1 b: TEC routes for NCT destinations except RNO and satellites. 2-1 c: initial headings only when a DP cannot be
used; phraseology "CLEARED TO (airport) AIRPORT, VIA TURN LEFT/RIGHT (heading) / FLY RUNWAY HEADING, RADAR VECTORS
(first fix/airway)…".

2-2 a SFOW (28L/28R/30): Northbound J & DH8D → OAK#, Richmond, CVS x FL190 (J) / CVS x 10,000 (DH8D). Oceanic and
Southbound J & DH8D → CNDEL# / SKYL# / COAST#, Sutro, CVS (CNDEL#) / CVS x 10,000 (others). Via BSR, EUGEN, SHOEY
or SNS, P/T/J → NUEVO#. All other props P/T → NIMI#, Richmond, 3,000.
2-2 a OAKE (10L/10R/12): Northbound J & DH8D → QUAKE#, Richmond, 5,000; Southbound J & DH8D → QUAKE#, Sutro,
5,000; all P/T → 090°, Grove, 3,000.
2-2 a SFOE (10L/10R/12): Northbound J & DH8D → OAK#, Richmond, 3,000; Oceanic → Sutro; Southbound J & DH8D →
KATFH# / SKYL#, Sutro, CVS x 3,000; all P/T → 090°, Richmond, 3,000.
2-2 b non-DP headings (expect cruise altitude 10 minutes after departure): SFOW rwy 33 J & DH8D 270° 2,000, P/T
315° 3,000; SFOW 28/30 northbound P/T 315° Richmond 3,000, southbound J & DH8D runway heading Sutro 10,000; OAKE
10/12 J & DH8D 270° 5,000; SFOE 10/12 J & DH8D runway heading 3,000. Sector "varies": Richmond northbound, Sutro
oceanic/southbound.
Appendix B noise abatement (optional, activatable): SFOW Mon–Sat 2200–0700L, Sun until 0800L; SFOE 2200–0600L;
SALAD# 2200–0700L daily. SFOW: rwy 30 P/T 270° 10,000; northbound J & DH8D HUSSH# / SLNT# Richmond (CVS /
CVS x FL190); oceanic/southbound 270° or HUSSH# Sutro 10,000 / CVS; southbound 28/30 J & DH8D 270° or SUNNE#
(when NCT authorises) 10,000 / 5,000; northbound 28 J & DH8D 270° 10,000; all 28 P and Cat A/B → SALAD# CVS x
4,000. HUSSH# required for J/DH8D 0100–0500L, oceanic/southbound via GOBBS transition. OAKE: P/T 090° Grove 3,000;
J & DH8D QUAKE# or 270° 5,000. SFOE: P/T 090° 3,000; J & DH8D 140°.

## New rule concepts OAK needs (add to the schema and engine before transcribing)

**User decisions 2026-09-16** (AskUserQuestion round): aircraft groups in the SOP YAML; turn direction derived as
the shorter turn from the runway's magnetic heading; Appendix B noise rows always active inside their window, as at
SFO (no activation toggle); approach category per fleet type.

- [ ] **Type-specific class**: "J & DH8D" rows treat the Dash 8-400 as a jet for SID assignment but give it its own
  altitude (CVS x 10,000 vs FL190). **Decided**: `aircraft_groups` in the airport YAML mapping a group id to classes
  and/or types (`jets_and_dh8d: {classes: [J], types: [DH8D]}`); assignment and altitude rows may reference a group
  (`groups: [jets_and_dh8d]`) beside or instead of `classes`; KSFO data unchanged.
- [ ] **Heading departures as a first-class clearance**: OAK issues 090°/270°/315°/runway heading routinely. The
  runway-heading half landed 2026-09-16 for KSFO (`Procedure.kind === 'heading'`, "via fly runway heading, radar
  vectors (first fix)", [archive/heading-departures.md](./archive/heading-departures.md)). **Decided** for the
  numbered half: `non_dp_heading: 270` on the row; the turn direction is the shorter turn from the departure
  runway's magnetic heading (CIFP `PG` records, emitted per runway), read "via turn left heading two seven zero,
  radar vectors (fix/airway)"; a 180° split fails the build. Altitude "maintain (feet)", expect clause spoken (no
  chart note).
- [ ] **Plain "climb via SID"** for CNDEL# and HUSSH# (row outcome `climb_via`): already supported by the engine.
- [ ] **CVS x FL190**: an interim expressed as a flight level; check `speakAltitude` and the altitude row schema.
- [ ] **Continuation charts**: the chart parser must merge `NAME, CONT.1` text into `NAME` (6 of 17 OAK charts).
- [ ] **Approach category** ("P, Cat A/B → SALAD#"). **Decided**: `approach_category: A|B|C|D` on fleet rows (from
  the published Vref), and rows may say `approach_categories: [A, B]`.
- [ ] **Three departure sectors** (Richmond, Sutro, Grove) and "varies" rows resolved by direction: already
  expressible (`direction` on the row).
- [ ] **Noise abatement**: Appendix B rows are "may be activated". **Decided**: model them as SFO's are, time
  windows always active (`noise_windows` + `when: {noise_window: …}`); no activation toggle.

## CIFP inventory (read 2026-09-16 from cycle 2609)

Runways (PG rows, magnetic bearing in columns 28–31 of the record, tenths of a degree): 10L 098°, 10R 098°, 12
116°, 15 150°, 28L 278°, 28R 278°, 30 296°, 33 330°. Procedures: CNDEL5 RNAV (28B/30; KAYEX KTINA NTELL SUSEY
YYUNG; restrictions), COAST9 conventional (28B/30; FLW GVO RZS SXC), HUSSH2 RNAV (30 only; DEDHD GOBBS GRTFL
MOGEE ORRCA SYRAH TIPRE; restrictions), KATFH3 RNAV (10B/12; KAYEX KTINA NTELL SUSEY; restrictions), NUEVO8
conventional (28B/30; SHOEY SNS), OAK6 vector (all runways; no CIFP transitions), QUAKE2 vector (all runways),
SALAD5 conventional (28B only; ALTAM; restrictions), SKYL1 conventional (all runways; AVE FLW PXN; restrictions),
SLNT3 conventional (30 only; ENI LIN RBL SAC; restrictions), SUNNE1 conventional (28B/30; no transitions).
**NIMITZ6 has no CIFP records**: a radar-vector SID like SFO5, every fact from `overrides.yaml`. `RW28B` is
handled by the grouper. OAK6 is "CVS x FL190" in SOP 2-2 a and the S1-OAK-1 module although it is a vector SID,
so `climb_via_eligible` becomes an override field rather than a change to the KSFO rule (GAPP7 stays not eligible).

## Steps (implementer briefs; the orchestrator does docs, data review and commits)

- [x] Inspect KOAK CIFP SID records (above)
- [x] **Brief 1, schema + generator concepts** — landed 2026-09-16 (150 implementer calls: too big for one brief; the
  next ones carry fewer steps). Findings: OAK's five continuation sheets carry the enroute transitions the base
  sheets do not print, so without the merge four procedures would build with no transitions; every OAK chart reads
  `topAltitude = assigned_by_atc`, so OAK6's "CVS x FL190" needs the `climb_via_eligible` override plus an altitude
  row; the charts API lists 12 procedures + 5 continuations = 17. Original brief: `aircraftGroups` on the airport
  document and `groups` on assignment and altitude rows; `approachCategory` on fleet rows and `approachCategories`
  on assignment rows (the build requires every fleet row to carry a category once any row names one);
  `nonDpHeading` as `runway heading` or an integer 1–360; `runways[]` with `magneticBearing` from the PG rows;
  `climb_via_eligible` override on a SID; continuation charts (`NAME, CONT.1`) merged into their procedure's
  text before the facts are parsed; schema export; KSFO rebuilt (new fields only) and `--check` clean.
- [x] **Brief 2a, audience matching** — landed 2026-09-16 (`ad6604c`): `Classification` carries the type and the
  fleet's approach category; `addresses(row, ctx, airport)` in `rules/classify.ts` reads `classes`, `groups` and
  `approachCategories`; the assignment and altitude tables use it. Finding: TEC rows and route-library rows still
  key on classes only (no `groups` in their schema); needed only if an OAK TEC row says "J & DH8D".
- [x] **Brief 2b, numbered headings** — landed 2026-09-16 (98 calls). Original: `nonDpHeading` as the literal or an
  integer 1–360 in the schema, the generator loader and the fixture `heading`; `Procedure` heading variant with
  `heading`, `turn` and a `spoken` label; `selectSid` derives the turn from `airport.runways` (shorter turn; the
  reciprocal is a data error); speaker "via turn left heading two seven zero"; `headingLabel()` replaces the
  constant label; `R-HEADING` text covers both forms; `propose` prints the label.
- [ ] **Brief 2c, TEC routes without a DP, and the amendment side**. SOP 2-1 c: "initial headings … shall only be
  issued when a DP cannot be used or an applicable one does not exist (e.g. pilot is unable to accept DP, TEC
  route does not include DP)". The OAKE TEC rows are that case (`[OAKE] +H270 FEVTA FEVTA1+` for jets to SMF,
  `[OAKE] +EUGEN+` for jets to MRY), while 2-2 a assigns those jets QUAKE#. Concept: a new assignment condition
  `when: { tec_route_without_dp: true }` (schema `tecRouteWithoutDp`, loader, `conditionsHold`) that holds when
  the flight's keyed TEC row (destination, plan, runway family, class; no issuable test) begins on no `FAMILY#`
  placeholder, i.e. on an `H<ddd>` token or a fix/airway; the OAKE heading rows carry it and sit before the QUAKE#
  rows, citing SOP 2-1 c and 2-2 b. A leading `H<ddd>` token is the heading the row is issued on: `tecTokens` drops
  it from the route box; a row with an `H` head is issuable when the engine clears the flight on that heading (a
  mismatch between the token and the row's heading is unresolved, naming both). The keyed-row helper moves out
  of `rules/amend/tec.ts` into a module the selector can import without a cycle. Amendment side: the procedure
  dropdown offers the runway heading plus every numbered heading the airport's rows use (pick values
  `heading:runway`, `heading:270`) and `gradeProcedure` compares headings; the route-box reason for a heading
  clearance comes from the row instead of the hard-coded "in the noise window"; `CVS x FL190` spoken as a flight
  level (check `speakAltitude`).
- [ ] **Brief 3a, SOP transcription**: `sop.yaml` (v1.7, sentinels; configurations `SFOW`, `OAKE`, `SFOE` as both id
  and plan, since the TEC tool tags rows `[SFOW]`/`[OAKE]`/`[SFOE]`; training weights 70/20/10; departure runways
  and class defaults from SOP 1-6/2-2 with a `note` and a report question wherever the SOP is silent on which
  parallel; 2-2 a tables as rows with `groups: [jets_and_dh8d]`; 2-2 b headings as `non_dp_heading: <int>` rows;
  Appendix B as `noise_windows` + rows; three sectors; gates seeded from the CIFP transitions and the user's
  common-fix notes), `overrides.yaml` (12 charts; NIMITZ6 radar-vector facts; OAK6 `climb_via_eligible: true`),
  a minimal `routes.yaml` (destinations, telephony, fleet reused from KSFO plus DH8D, `approach_category` on every
  type estimated from published Vref with a `note`, **for the user's review**, and the user's common routes),
  `verify-sop`, build clean.
- [ ] **Brief 3b, the rest of the data**: `tec.yaml` from `.tmp/oak-tec/*.txt`, `loa.yaml` (ZOA–ZSE reused, ZLA/ZLC
  rows from the notes), `worksheets.yaml`, `data/airports.json`, the KSFO-only web tests widened to the index, the
  airport switch in the UI checked in the browser.
- [ ] `tec.yaml`: the route tool pages for 22 destinations (SMF MRY LVK APC WVI MYV OVE O88 SAC SFO SJC CCR HWD SQL
  PAO RHV NUQ STS MOD SCK MHR MCC) were captured 2026-09-16 with Playwright into `.tmp/oak-tec/<FAA>.txt`
  (gitignored; re-run `web/.tmp/oak-tec.ts` style script if lost). Findings: the tool prints an altitude band
  `030/090` (hundreds of feet, floor/cap; KSFO recorded the cap only); **OAKE rows begin on a heading token**
  (`[OAKE] +H270 FEVTA FEVTA1+ 100/100`), so the TEC substitution in `rules/amend/tec.ts` must accept `H<ddd>` at
  the head of a route as the numbered heading the SOP issues there, not a SID placeholder (brief 2 or 3).
- [ ] `import-worksheets --airport KOAK`; validation loop with the user
