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
- [x] **Brief 2c, TEC routes without a DP, and the amendment side**. Landed 2026-09-16 in two halves: `217c698`
  (`when.tecRouteWithoutDp`, `rules/tecRoutes.ts` with `tecHead`/`keyedTecRoute`, the `H` head in `tecTokens` and
  `issuable`, the heading-mismatch gap) and `d229e0c` (`headingPick`/`headingFromPick` in `rules/grade.ts`, the
  dropdown lists every heading the rows name, `gradeProcedure` compares heading values, `headingReason` names the
  row and the heading, `merge.py` `_check_tec_heads`). SOP 2-1 c: "initial headings … shall only be
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
- [ ] **Brief 3a status 2026-09-16**: the five files are written in `wt/koak-data` (uncommitted; `verify-sop` and
  every loader pass, KSFO unchanged) and the build was blocked only by the FAA's "TRANSITON" misspelling on
  SKYLINE ONE CONT.1 (parser tolerance dispatched to `wt/koak-engine`; a dry run with it patched builds KOAK: 12
  SIDs, 59 assignment rows, 20 altitude rows, 2 notices, 45 routes). Review findings beyond the implementer's
  guesses: (1) SOP 3-4 a asks turboprops over 17,000 lbs off 28L/28R, so the DH8D belongs on 30/12 with the
  jets, which a class-keyed default cannot say; (2) SFOW P/T on a heading take 3,000 (315) or 10,000 (runway
  heading, 270) by heading, but altitude rows key on plan/runway/class/SID only, so every such prop gets 3,000;
  (3) the SFOW 2-2 b prop rows (315/runway heading) sit behind the NIMI# row (direction any) and are reachable
  only through a TEC-without-DP condition they do not carry, to be settled once `tec.yaml` shows which prop TEC
  rows omit NIMI#; (4) a non-RNAV jet between 0100L and 0500L falls to the SLNT#/270 rows the footnote forbids
  then (needs a "not in window" condition; rare, validation loop); (5) `non_standard_interim_expect_minutes: 3`
  copied from KSFO where SOP 2-2 b i says ten (unused by the engine; set to 10 in 3b). Guesses put to the user
  2026-09-16: east-flow prop parallel, DH8D runway, SUNNE notice heading, heading-keyed altitudes, spoken names,
  DH8D approach category, NUEVO# blanks, Sacramento jet altitude. **Answers 2026-09-16**: east-flow props default
  to 10L (same pavement as 28R; PCM to 10R); the DH8D goes with the jets through a group-keyed runway default
  (brief 2e-i); with SUNNE# off the engine issues the notice's 120 heading, not the SOP's 270 (a `sid_off` notice
  may carry the heading it issues instead: brief 2e-ii; the QUAKE notice carries 270 the same way); altitude rows
  may key on the heading (brief 2e-ii); Hush Two, Katfish Three and Sunne One are right; the DH8D approach
  category is to be read off the FAA Aircraft Characteristics Database (faa.gov/airports/engineering/
  aircraft_char_database), as should every other estimate; the NUEVO# row is not blank, its sector and altitude
  cells are merged with the southbound row's (Sutro, CVS x 10,000: rewrite the note); Sacramento jets file
  10,000 as the tool says (TEC altitudes ignore parity). **FAA AAC column read 2026-09-16** (the database's
  `aircraft_data` URL serves the xlsx; rows saved to `.tmp/faa-aac.txt`): A320 C, A20N C, A319 C, B737 C, B738 D,
  B752 C, B77L C, B788 D, A306 C, MD11 D, E75L C, E135 C, CL30 C, GL5T C, C750 C, C55B B, C25B B, C510 B, E55P B,
  DH8D C, B350 B, BE20 B, TBM9 A, C172 A, SR22 A, M20T A, C208 A. Eight estimates change (A306, B77L, B738, CL30,
  TBM9, M20T, plus C208 new); the fleet `approach_category` source becomes "FAA Aircraft Characteristics Database,
  AAC, 2026-09-16" and the review note comes off.
- [x] **Brief 2e-i, group runway default**: landed 2026-09-16 (`f69015a`): `default_for_groups` on a departure-runway
  row, read between the airline and the class default, `RWY-GROUP-DEFAULT` row required; loader, emitter, importer,
  draw, grader and ATIS; `inAnyGroup` in `classify.ts` is the one membership predicate. Left for 2e-ii: `pickRunway`
  reached six positional parameters.
- [ ] **Brief 2e-iii, FAA approach categories as shared data** (user 2026-09-16: "cache that in the repo parsed or
  raw"): `craft-gen fetch-aircraft-characteristics` downloads the FAA xlsx (the `aircraft_data` URL) and writes
  `generator/shared/faa_aircraft_characteristics.yaml` (source block with url and fetched date; one entry per ICAO
  code with aac, approach speed, engine class, MTOW, WTC), checked in; `routes.yaml` fleet `approach_category`
  becomes optional and the build fills it from that table by type, failing on a type the table lacks; a hand value
  still wins. Landed 2026-09-16 (`8bccab5`): `aircraft_characteristics.py`, the `fetch-aircraft-characteristics`
  command (`--from` for a local workbook, `openpyxl` dependency), 388 rows in the shared YAML, every KSFO fleet entry
  now emits `approachCategory` from the table. Follow-ups for 2e-iv: `merge._check_approach_categories` is now
  unreachable (the fill either supplies a category or fails first); the schema's `approachCategory` can become
  required; the FAA table carries category E (F15, P8) while the schema stops at D; the module imports `_Row`,
  `_load_yaml_mapping` and `_where` from `sop/load.py`, which should be public if a third module needs them. **User
  steer 2026-09-16**: keep
  airport-independent aircraft data in one shared place so airports do not copy it. Second half, brief 2e-iv: the
  type facts (class, wtc, suffixes) move to `generator/shared/aircraft_types.yaml`, the airline facts (telephony,
  cargo, the types each operates) to `generator/shared/airlines.yaml`, the destination facts (spoken name, artcc,
  foreign coordinates) to `generator/shared/destinations.yaml`; an airport's `routes.yaml` lists the type codes,
  airline codes and destination codes it draws plus its routes, and the build composes the same `routeLibrary`
  JSON as today, so the web app does not change. KSFO converts in that brief; KOAK's `routes.yaml` converts in 3b.
  Dispatched 2026-09-16 into `wt/koak-shared` (from `abea86b`); the shared files also gain the KOAK additions (KPHX,
  QXE types, PCM, DH8D, C208) so 3b touches no shared file. First dispatch came back underspecified: seven KSFO
  telephony codes (AAL, ABX, ATN, CKS, CLX, GTI, NCA) operate no drawn type and exist for worksheet callsigns and the
  cargo runway rule, so an airport may list an airline that operates none of its fleet types (no check) and a shared
  airline may have `types: []`; the per-type airline order follows the airport's airline list, which changes A319 and
  A306 (today's orders contradict each other), an accepted seed shift. Landed 2026-09-16 (`fe9dc58`): three shared
  files (43 destinations, 29 airlines, 27 types), `load_shared_route_facts`, `load_routes(path, shared)`,
  KSFO `routes.yaml` is three code lists plus routes; `data/ksfo.json` changed only in `cargoAirlines` and eight
  fleet airline arrays; one seeded web test moved (seed 1 callsign).
- [x] **Brief 2e-ii, heading-keyed altitudes and notice headings** (landed 2026-09-16, `abea86b`): (1) an altitude row may list `non_dp_headings`
  (`[315]`, `[runway heading]`) the way it lists `sid_families`, matching only a flight cleared on one of those
  headings; the two keys are exclusive. (2) A `sid_off` notice effect may carry `heading: 120`: while the notice is
  active, a row of that family clears the flight on that heading instead of being skipped (the row's sector and
  conditions stand; citations are the row and the notice; `unservedSids` ends its walk there). Data in 3b: SFOW P/T
  altitude rows split by heading (315 → 3,000; runway heading and 270 → 10,000), `heading: 120` on the SUNNE
  notice and `heading: 270` on the QUAKE notice. (3) **User steer 2026-09-16**: an inter-ARTCC LOA's at-or-below
  altitude tells the enroute controller what to have the flight at before the handoff; a pilot may cruise above it
  inside ZOA, so clearance delivery never caps a filed altitude for an LOA. The `max` LOA rule kind is used by no
  airport and is removed (model, loader, emitter, schema, `rules/amend/altitude.ts`), keeping `parity_rotated`,
  `even`, `odd` and `route`. (4) `pickRunway` takes an options object. Dispatched 2026-09-16 into `wt/koak-engine`.
- [ ] **Brief 3a, SOP transcription**: `sop.yaml` (v1.7, sentinels; configurations `SFOW`, `OAKE`, `SFOE` as both id
  and plan, since the TEC tool tags rows `[SFOW]`/`[OAKE]`/`[SFOE]`; training weights 70/20/10; departure runways
  and class defaults from SOP 1-6/2-2 with a `note` and a report question wherever the SOP is silent on which
  parallel; 2-2 a tables as rows with `groups: [jets_and_dh8d]`; 2-2 b headings as `non_dp_heading: <int>` rows;
  Appendix B as `noise_windows` + rows; three sectors; gates seeded from the CIFP transitions and the user's
  common-fix notes), `overrides.yaml` (12 charts; NIMITZ6 radar-vector facts; OAK6 `climb_via_eligible: true`),
  a minimal `routes.yaml` (destinations, telephony, fleet reused from KSFO plus DH8D, `approach_category` on every
  type estimated from published Vref with a `note`, **for the user's review**, and the user's common routes),
  `verify-sop`, build clean. User steer 2026-09-16 on the parallels: **props default to 28R** because they park
  north of it, **except PCM (airline), whose props default to 28L** because they park south of 28L. The first is
  `default_for_classes: [props]` on the 28R row (relayed to the running 3a agent); the second is a new rule concept,
  since `DepartureRunway` defaults are keyed on class only: brief 2d below.
- [x] **Brief 2d, airline runway default**: landed 2026-09-16 (`257d8df`): `default_for_airlines: [PCM]` on a
  `DepartureRunway` row (loader checks the code shape and one runway per airline per configuration; the build
  checks each code against `routes.yaml` telephony and requires an `RWY-AIRLINE-DEFAULT` phraseology row),
  emitted as `defaultForAirlines`, read ahead of the class default by the worksheet importer, the scenario draw
  (`pickRunway` now takes the callsign, drawn before the runway, so **every seed draws differently than before**;
  the heading-check seeds `s=41`/`s=3y` quoted earlier no longer apply) and the runway grader, and the ATIS treats
  such a row as outside normal use. Data side for brief 3b: the SFOW 28L row `classes: [P]`,
  `default_for_airlines: [PCM]` with the parking note (source "ZOA senior staff via the user, 2026-09-16"), the
  `RWY-AIRLINE-DEFAULT` row, PCM in `telephony` as "PAC VALLEY" (West Air, a FedEx feeder flying C208B freighters
  out of OAK to FAT/VIS/MRY) and in `cargo_airlines`, and C208 in the fleet as a prop flown by PCM. Observation
  from the implementer, not done: nothing checks that a row defaulting an airline lists a class that airline
  flies, so a mis-classed row is silently inert.
- [ ] **LOA documents** (user 2026-09-16): every LOA PDF is reachable the way `zoa-reference-cli`
  (`C:\Users\Leftos\source\repos\zoa-reference-cli`) pulls `procs` / `sop`; use that listing to fetch the ZOA–ZLA and
  ZOA–ZLC LOAs (and any other LOA a KOAK destination needs) before transcribing `loa.yaml` rows. The list is the
  `<select>` on `https://reference.oakartcc.org/procedures` (cached by that CLI at
  `~/.zoa-ref/cache/procedures/procedures_list.json`); the enroute LOAs: ZOA–ZLA
  `oakartcc.org/controllers/file/3779589d-ae45-11ea-aa39-2a32edb55910`, ZOA–ZLC `…/72d39e4f-ae45-11ea-aa39-2a32edb55910`,
  ZOA–ZSE `…/84f7be5c-ae45-11ea-aa39-2a32edb55910` (already in `loa.yaml`), ZOA–NCT `…/0e7f63e3-ae45-11ea-aa39-2a32edb55910`,
  ZOA–FAT `…/fc2bd476-ae44-11ea-aa39-2a32edb55910`, Pacific Oceanic `…/0810fda5-1c16-11ec-9430-2a32edb55910`. Fetched
  2026-09-16 to `.tmp/loa-zoa-{zla,zlc,fat,nct}.{pdf,txt}` (gitignored). A `craft-gen fetch-loa` command that reads
  the same dropdown is a later item once the LOA rows exist.
- [x] **Brief 3c-i, shared LOA rows** — landed 2026-09-16 (`7a3b662`; `SharedRouteFacts.loa`, `joined_loa_rules`, both
  data files byte-unchanged; `LoaData.sources` is joined but never emitted, a dead field to look at). Spec (user
  2026-09-16: "Shared file, airports inherit"): `generator/shared/loa_rules.yaml`
  holds every ZOA LOA source and rule once; a rule may carry `departures: [KOAK, KSFO]` and then applies only when
  the airport being built is listed; an airport's optional `loa.yaml` keeps only overrides by id and airport-only
  rows, joined the way `phraseology_rules.yaml` is. The three ZSE rows move to the shared file and both airports'
  `loa.yaml` go away; `data/ksfo.json` and `data/koak.json` are unchanged by the move. Dispatched 2026-09-16 on
  `wt/koak-data` at `69577d2`.
- [x] **Brief 3c-ii, landed 2026-09-16** (112 implementer calls over three resumes): `classes` and `rnav_only` on a
  `route` LOA rule through schema, model, loader (`_loa_route_classes`, empty list rejected) and emitter;
  `loaRouteGap(tail, ctx, …)` skips a row of other classes or an RNAV-only row for a non-RNAV flight; `_joined_loa`
  takes `SharedRouteFacts` and checks destinations against the shared table; 24 LOA rows (11 with classes, 1
  RNAV-only), 13 new shared destinations, KSFO `YYUNG TILLT LEGOZ#` and `SAC ANAHO PRNCS SADYL#`; both builds
  `--check` clean, suite 906 green, prek green. The KOAK LXJ351 fixture is no longer blocked by an LOA row (its
  remaining reason: `no assignment rule applies to SFOW no-gate runway 30 class J`). Left for later briefs: the
  route library has no prop rows to the ZLA fields, so the new prop rows are exercised by no library row; the
  thirteen new destinations are drawn by no airport. **User decisions
  2026-09-16** on the five findings below: (1) both keys, `classes` and `rnav_only`, on a `route` LOA rule, the
  prop cells as their own rows; (2) Carlsbad: the fixture is right and the CRQ cell binds jets routed west of J1
  only, so the row is `classes: [J]` and EHF/LHS satisfy it (the KSFO library row becomes `YYUNG TILLT LEGOZ#`,
  TILLT being a LEGOZ4 transition; the KBOI `SAC ANAHO` row gains `PRNCS SADYL#` since jets file `/L` and the
  BOI row is RNAV-only); (3) the LOA destination check reads `shared/destinations.yaml`, which gains the Empire
  group, NFG, PSP/TRM, HND, SBP, BIL and TWF; (5) the `ALL SBP` cell is transcribed, the MMMX overflight row and
  `FAT/MRY -> LAX` are not. Dispatched as one brief (schema and loader keys, `loaRouteGap` reads the class and
  RNAV capability, the check, the rows, both data files rebuilt). **Report 2026-09-16 (102 calls, blocked)**: every
  step's edits in, 24 LOA rows, both builds `--check` clean, generator gates green, one red web test: the
  route-building test on SWA984 (`SSTIK5 SUSEY EBAYE AVE SADDE8`, a `/L` jet to KLAX) now trips the LAX jet row,
  and the settled fixture expects that route. **User 2026-09-16: "SADDE8 is non-RNAV"**, citing the ZOA "Common
  ZLA Arrivals from ZOA" table (`.tmp/zla-arrivals.txt`, oakartcc file `7fc9fef0-d1de-11ef-a1be-2a32edb55910`,
  2025-01-13): LAX west-flow jets `IRNMN2 (BURGL, REBRG)`, `SADDE8 (DERBB) *Non-RNAV`, `HUULL2 (TOKIO)`,
  `BAYST1/DIRBY2/LEENA8` cargo; east flow `ZUUMA4 (BURGL, REBRG)`, `MOOR4 (DERBB) *Non-RNAV`; LAX/SMO props
  `WAYVE1 (EHF, LHS)`, `KIMMO3 (EHS, LHS)`; SMO all `BONJO2 (REBRG, RDHOT, HONKZ)`, `FERN7 (AVE, FLW, DERBB)`;
  LAS jets `COKTL4 (FLCHR)`, `PUMLE1 (BTY)`; LAS/HND props `GAMES (FUULL)`; SAN `COMIX2 (LAX, HUULK)`, `HUBRD1
  (LAX)`, `PLYYA2 (LAX)`, `SHAMU1 (LAX)`; LGB `BAUBB3 (TILLT)`, `PCIFC3 (RDHOT, REBRG, ELLBC)`; SNA `RUUKI
  (TILLT)`, `OHSEA3 (RDHOT, REBRG, ELLBC)`; LGB/SNA all `TANDY5 (FLW)`; BUR `ROKKR2 (RDHOT, REBRG, HONKZ)`, `FERN7`;
  VNY `IVINS (RDHOT, REBRG, HONKZ)`, `FERN7`; BUR/VNY props `WEESL1 (EHF, NINTY)`. CIFP: SADDE8 publishes an AVE
  transition beside DERBB and FIM. Two engine findings from the report, to model later: (a) `checkRoute` holds the
  LOA routing rows only against a box that already reads right, so a proposed amendment (built or TEC) is never
  checked against them and can violate one; (b) `rules/fixtures.test.ts` prints nothing for a `pending` fixture
  without an `expected` block, so the 50 imported KOAK fixtures are silent in the suite. Earlier state: 12 rows written to
  `generator/shared/loa_rules.yaml` (ZLA: LAX, SMO, LGB+SNA, BUR+VNY, SAN, CRQ, UDD, ONT, LAS, SBA; ZLC: SLC, BOI),
  two sources, `LOA_RULE_COUNT` 15, generator gates green, both builds `--check` clean, **blocked by six web
  failures that were findings, not bugs**:
  1. **Route rules need a class key** (new concept): the LOA's LAX cell routes jets via BURGL/REBRG/… and props
     west of J1 via AVE/FLW/RZS; with one classless row, KOAK `SNS -> KLAX SNS AVE LAX [PT]` is clean nowhere and
     the engine test `amend/route.test.ts` "leaves a plan that already files the transition alone" (SWA984, a jet
     filed `AVE SADDE8`) trips the row. Design: `classes: [J]` / `[P, T]` on a `route` rule (schema, loader,
     `loaRouteGap`), the prop cells transcribed as their own rows; that jet test then files a conforming route.
  2. **"Via filed route" for the conventional column** (new concept): the BOI cell is `..NEERO..PRNCS` for RNAV
     and "via filed route" otherwise, so KSFO `SAC -> KBOI SAC ANAHO [J]` is clean nowhere. Design: `rnav_only:
     true` on a route rule, skipped for a non-RNAV suffix.
  3. **Carlsbad**: settled KSFO fixture `ws-amendment-practice-1a-lxj351` (E55P, `GAPP7 EHF LHS V459 SLI V23 OCN`,
     confirmed correct as filed 2026-09-16) and the library row `YYUNG LEGOZ LEGOZ4 [J]` both name none of the
     CRQ/NFG cell's BURGL/TILLT/REBRG/LANDO/DERBB/FIM; the pending KOAK twin `ws-amendment-practice-1c-lxj351`
     flips to unresolved. The LOA text (`.tmp/loa-zoa-zla.txt` lines 295–303) puts EHF under the SAN cell, not
     CRQ. **Ask the user** whether the CRQ row is missing a column (props? EHF/LHS?) or the fixture and the
     library route are wrong.
  4. **Shared rows and unlisted destinations**: `_joined_loa` checks every joined row's destinations against the
     airport's `routes.yaml`, so the Empire group (CNO, POC, AJO, EMT, RAL, SBD beside ONT) and the ZLC BIL/TWF
     rows cannot be written until either the check reads the shared destinations file instead (preferred: an LOA
     fact does not depend on whether a scenario files there) and those fields get shared destination rows, or
     the rows stay out. Ready transcriptions: BIL `[YLSTN, BAM, REO]`, TWF `[BAM]`.
  5. Not transcribed, for the user: the ZLA overflight row `SFO/OAK/SJC ALL ..BOILE.. Through ZLA 27` (MMMX is in
     both route libraries; a `departures: [KOAK, KSFO]` row is writable), `FAT/MRY -> LAX`, `ALL -> SBP`.
  Original spec: **Brief 3c-ii, ZLA and ZLC rows** into the shared file (after 3c-i; data only). Sources: ZOA–ZLA LOA effective
  2026-04-26 (`.tmp/loa-zoa-zla.txt`, Attachment 1 "Preferred routes and altitudes from ZOA to ZLA", pages 5–7) and
  ZOA–ZLC LOA effective 2025-09-04 (`.tmp/loa-zoa-zlc.txt`, one word per line; 4 e, 4 h, Attachment 1). **Routing
  rows only** (user 2026-09-16: the LOAs' at-or-below altitudes bind the enroute controller before the handoff, not
  clearance delivery, so no altitude row is transcribed): KLAX jets route tokens [BURGL, REBRG, DOUIT, DERBB, BAYST,
  DIRBY, LEENA, TILLT, MCKEY]; KSMO jets [BURGL, HONZK, MMTLY, RDHOT, REBRG, AVE, FLW, DERBB]; KLGB/KSNA jets [TILLT,
  RDHOT, MMTLY, ELLBC, REBRG, AVE, FLW, MCKEY, DAISY, BENET, DERBB]; KBUR/KVNY jets [BURGL, HONZK, MMTLY, RDHOT, REBRG,
  AVE, FLW, DERBB]; KSAN via LAX [HUULK, PASKE, EHF, LANDO, LAX]; KCRQ [BURGL, TILLT, REBRG, LANDO]; KUDD [CLASN,
  OYVEY, BTY, ZELMA, PMD]; KONT (Empire) [CLASN, OYVEY, PMD]; KLAS jets [BASIC, Q174, FLCHR, J92, BTY]; KSBA [GVO];
  ZLC: KSLC [BVL, MLF, FLECC, REO], KBOI [NEERO, PRNCS] (conventional "via filed route"), KBIL [YLSTN, BAM, REO],
  KTWF [BAM]. **Gaps to flag, not model**: ZLC 4 e "0830–2200 Pacific, OAK/SFO/SJC departures enter ZLC north of
  KRAZY" is a time-windowed route rule (note only); the RNAV / conventional split of the ZLC table is not in the
  `route` kind (both columns' tokens listed, as the ZSE rows do); the prop routings to LAX/LGB/SNA differ by J1/J501
  side (note only). Each row cites the LOA attachment and row.
- [x] **Brief 3b-i, KOAK data landed 2026-09-16 (`3ee592d`)**: the six YAML files plus `data/koak.json` (12 SIDs, 59
  assignment rules, 21 altitude rules, 2 notices, 45 routes; `tec.yaml` 61 rows over 18 destinations, every row
  `runway_families: []`; `verify-sop` ok; `build --check` unchanged for KOAK and KSFO; pytest 401 green). KOAK is not
  yet in `data/airports.json` (brief 3b-ii). Observations from the build worth carrying: the SFOE/OAKE prop and
  turboprop TEC rows (`OAK#` heads to NUQ/PAO/RHV/SJC, bare `EUGEN` / `OAK V244 …` heads to MRY/WVI) have no
  SOP row that can issue them, since 2-2 a ii/iii give P/T only the 090 heading; the SFOW jet TEC rows to MRY/WVI
  end at 11,000 while `routes.yaml` files 7,000/9,000 on those tails; the build's 31-gate-fix warning is the normal
  state of a fresh gate list (KSFO warns about 39). History: the first pass had 75 rows over 21 destinations
  (every loader check passed; `verify-sop` ok) but the build stopped on twelve NCT
  satellites the TEC pages file to that `generator/shared/destinations.yaml` lacked (KCCR, KHWD, KMCC, KMHR, KMOD, KNUQ,
  KPAO, KRHV, KSCK, KSFO, KSQL, KSTS; added on main, `nct: true`, spoken Concord, Hayward, McClellan, Mather, Modesto,
  Moffett, Palo Alto, Reid-Hillview, Stockton, San Francisco, San Carlos, Santa Rosa). **User 2026-09-16: STS is not
  NCT; the airports under NCT control are listed in the NCT SOP** (`.tmp/nct-sop.{pdf,txt}`, oakartcc.org file
  `7576a83b-5e65-11e9-8010-2a32edb55910`). Settled the same day after two rounds: the SOP's 1-4 complex table
  lists STS under Napa and its 1-5 area table omits every satellite the trainer's worksheets TEC-route (a settled
  KMYV fixture says "KMYV is inside NorCal TRACON"), so neither table is the test; **an airport is NCT when it lies
  inside the NCT terminal polygon** (the SimAware TRACON boundary, as `vatsim_control_recs`'s "NCT Combined" preset
  grouping computes it: `C:\Users\Leftos\source\repos\vatsim_control_recs\data\preset_groupings\ZOA.json`,
  polygons in `data/simaware_boundaries/NCT.json`, source github.com/vatsimnetwork/simaware-tracon-project). Against
  our destinations: Napa, Concord and Santa Rosa are outside, Reno inside, every other satellite inside. The TEC
  lookup stays gated on the flag (user), so the KSFO `GAPP# SAU` rows to Napa and the KOAK rows to Napa, Concord and
  Santa Rosa are dropped. **Brief 2g** (engine, later): compute `nct` at build time from a checked-in copy of the
  NCT boundary polygons and the CIFP airport coordinates instead of the hand flag, and fail the build on a TEC row
  to a destination outside the polygon. Left out of `tec.yaml`, a gap to
  model later: TEC rows that name no fix (KSFO `RH RV`, KHWD `OAK6 RV` / `NIMI5 RV` / `H090 RV`) since a TEC row's route
  must end on a fix or an arrival. The `OAK ORRCA` jet rows file 11,000 (the SFOE band `030/110`), the FEVTA rows
  10,000. `direction_runway_preference` for OAKE/SFOE still maps family 10 to 10R while the prop default is 10L; it only
  decides where no default applies (nothing today) and is left for the validation loop.
- [x] **Brief 3b-ii, KOAK into the index** — landed 2026-09-16 (`69577d2`): suite green at 903 tests with KOAK
  enumerated (7,296 of 7,296 engine combinations resolve; every KOAK library row clean somewhere; picker checked on
  phone and desktop, no console errors). Findings for the validation loop: `OAK SUNOL SJC [PT]` files 4,000 on a
  133° course (odd wanted) and is clean in 3 of 150; `OSI [PTJ]` to KSFO files 5,000 on 216° (even wanted), clean
  only in OAKE where the `H270 OSI 050/050` row overrides parity; every KMRY/KWVI library row is clean in exactly
  one plan because each plan has its own TEC tail; `TEC-KMRY-SFOE-J` and `TEC-KWVI-SFOE-J` route no flight. Original
  brief: `data/airports.json`
  gains KOAK; `schema.test.ts` index assertion, `scenario/library.test.ts` (loop `checkedInAirports()`) and
  `ui/session.test.ts` (load and draw every listed airport) widened; the exhaustive and fixture suites now
  enumerate KOAK, so their KOAK unresolved-group tables are the first engine-vs-data audit; browser check of the
  airport picker (`select:0=KOAK`) on phone and desktop. ZLA/ZLC `loa.yaml` rows are brief 3c below.
- [x] **Brief 2g, NCT from the polygon** (landed 2026-09-16, `0e14430`; ADR rows are exempt from the TEC check since
  they leave the terminal area by definition; both data files byte-identical): `generator/shared/
  nct_boundary.yaml` (the eleven SimAware NCT sector polygons, copied from `vatsim_control_recs`
  `data/simaware_boundaries/NCT.json`), `nct_boundary.py` (loader + even-odd ray cast), `nct` computed in `merge.py`
  from the resolved coordinates, the hand `nct:` key rejected, and a build check that fails a TEC row to a destination
  outside NCT. A ray cast over the destinations found the hand flags wrong for one field: **KCCR Concord lies inside the
  NCT, NCT_DEP and SFO_DEP polygons** (Napa and Santa Rosa outside, Reno inside RNO). **User 2026-09-16: "CCR is part of
  Travis airspace, NCT overlaps laterally but Travis owns the airspace in a shelf below that to the ground"**, so the
  polygon alone is not the test: a destination row may state `outside_nct: <reason>` (required text) and the build
  computes `nct = inside polygon and not outside_nct`; a row that states it for a field the polygon already excludes
  fails the build (a stale override). KCCR carries it; its TEC rows stay out of `tec.yaml`. Gap noted, not modelled:
  the Travis shelf is a vertical split the polygon file cannot express, and no other destination is known to sit
  under one.
- [x] **Brief 2f, TEC initial altitude** — landed 2026-09-16 in two halves (`745b654` fields and data, then the engine:
  cruise = final up and down, initial overrides the SOP, single-number rows final-only, the report test
  `rules/tecAltitudes.test.ts`, the seven untagged OAK jet rows, both route libraries at the TEC finals, SKW2345
  re-settled to 10,000). Open from its reports, for the validation loop: eight KOAK library rows clean nowhere for
  route/procedure reasons (`FEVTA FEVTA1 [J]`, `OAK EUGEN [J]` and the KARNN/ALTAM MOD turboprop tails to
  MRY/WVI, `OAK ARTAQ [J]`, `OSI [PTJ]` to KSFO) and two KOAK TEC rows no flight is routed on (`TEC-KMRY-SFOE-J`,
  `TEC-KWVI-SFOE-J`: SFOE southbound jets get KATFH, not OAK#). History (user 2026-09-16: "In TEC routes, the first number is the initial/interim
  altitude, and the second number is the final altitude. They're not a range. So 030/090 is 3,000 initial, 9,000
  final."). The KSFO `tec.yaml` header and the plan text below read the band as floor/cap, which is wrong: rename
  `altitude_cap_feet` to `final_altitude_feet` (schema `finalAltitudeFeet`) and add `initial_altitude_feet`
  (`initialAltitudeFeet`, optional) read from the first number; re-read the KSFO rows from the tool (the tool
  prints both numbers; capture `?dep=SFO&dest=<FAA>` with the Playwright script the way `.tmp/oak-tec/` was) and the
  KOAK rows from `.tmp/oak-tec/*.txt`. **User rulings 2026-09-16 (after the 3b-ii library test found the FEVTA jet
  rows amended 10,000 → 9,000 for parity):** (1) **the cruise altitude of a TEC-routed flight is the TEC final
  altitude, exactly**: a facility directive, so 7110.65 4-5-1 parity does not apply; a filed altitude that differs
  is amended to the final altitude, cited on the TEC row, and the parity rule is not consulted (engine: the F
  element in `rules/amend/altitude.ts` and the LOA/parity walk skip when a TEC row applies; clearance mode only
  draws clean plans, so filed = final there). (2) First answered "the A element is the TEC initial altitude", then
  refined the same day: **"In theory the TEC initial altitude should match the SOP initial for that SID, if one is
  provided. It should, in theory, be redundant."** So the SOP altitude row keeps deciding the A element (no TEC
  override in `rules/altitude.ts`), and the TEC initial altitude becomes an audit: a web test enumerates every TEC
  row against every flight it routes (config, runway, class, type, suffix; the amend engine's `tecRouteFor` says
  which row is the flight's) and asserts the altitude the clearance climbs the flight to (`clearedToFeet`: the
  interim, or the published top on a plain "climb via SID") equals the row's initial altitude; the SOP's cap at the
  filed altitude makes OAK# jets to SMF (SOP CVS x FL190, TEC 100/100, cruise 10,000) agree. A disagreement is a
  data finding for the validation loop, listed row by row, never patched in the engine. **Superseded the same day
  by the 2f-ii audit results**: a single-number tool row (`100/`, bare `110`) records the final only (user: "Final
  altitude only"), which cleared 13 KSFO and 7 KOAK mismatches; "final exactly, up and down" was re-confirmed against
  the SKW2345 fixture the user had settled at 9,000 (re-settled to 10,000); and on the two remaining OAKE mismatches
  (jets to SMF `H270 FEVTA FEVTA1 100/100` vs the SOP's 5,000; DH8D on the turboprop `030/070` row vs the group's
  5,000) the user ruled **"For now we'll say that TEC initials override the SOP"** and "Tool: 3,000 like other
  turboprops". So the engine override is back: a TEC row with an initial altitude decides the A element (climb via
  SID except maintain / maintain at the initial, plain climb via when the initial reaches the published top; expect
  minutes from `phraseology.nonStandardInterimExpectMinutes`; cited on the TEC row), a single-number row leaves the
  SOP row in charge, and the audit test becomes a printed report of SOP-vs-TEC differences for the validation loop.
  Never-routed rows to look at in the loop: KSFO `TEC-KLVK-SFOW-JT-01`, `TEC-KOAK-SFOE-TP`; KOAK `TEC-KMRY-SFOE-J`,
  `TEC-KWVI-SFOE-J`, `TEC-KSJC-SFOE-J`. Known consequence for the
  validation loop: settled fixture `ws-amendment-practice-1a-skw2345` (KSFO jet to Sacramento filed 10,000, TEC
  `100/`) today expects the altitude amended to 9,000 for parity; under ruling (1) it is correct as filed, so the
  fixture's expected block changes and the user re-confirms it. 2f-i observation: the OAK tool pages for
  MCC/MHR/MYV/OVE and LVK/MOD/SCK do print a Jet row with no `[SFOW]`/`[SFOE]` tag (`+OAK6 OAK ORRCA+ 110`,
  `+OAK6 OAK V244 ALTAM MOD+ 070`); `tec.yaml` says "the tool prints no jet row" and skips them. **User
  2026-09-16: an untagged row "applies in every configuration the SID is eligible for, every configuration if no
  SID in route"**, so 2f-ii transcribes them for the plans whose SOP issues OAK# to jets and adds the matching
  jet filed routes. **2f-i landed 2026-09-16 (`745b654`)**: the two fields through schema, loader, both data files
  (every KSFO number matched the fresh capture; KOAK carries real pairs such as 3,000/11,000), web rename
  behaviour-neutral. Uncovered KSFO destinations the tool prints rows for: CCR 10, HWD 7, MCC 10, MHR 10, MOD
  10, NUQ 6, PAO 6, RHV 6, SCK 11 (a later data brief; CCR is outside NCT by the Travis ruling). Engine files:
  `rules/amend/altitude.ts` (cruise = final), `rules/amend/tec.ts`, `web/scripts/propose.ts`; generator
  `sop/load.py` `load_tec`, `merge.py` `_tec_routes`, `_check_tec_*`; schema + `schema:export`; both data files
  rebuilt; the KSFO worksheet fixtures whose expected altitude changes are findings to list, not to re-settle
  silently. Dispatch after 2g lands (shared loaders, schema and data files); 3b-ii lands after it. **KSFO tool pages
  captured 2026-09-16** into `.tmp/sfo-tec/<FAA>.txt` with `.tmp/pw/capture-tec.mjs` (`node capture-tec.mjs SFO
  ..\sfo-tec SMF …`): the SFO rows print `NNN/` (a trailing slash, no second number) or a bare `NNN`, never a pair;
  **user 2026-09-16: a blank final altitude means final = initial** (`100/` = 10,000 initial and final, as `100/100`
  is), and a bare number reads the same. No rows for RNO (prop header only), APC and STS (empty groups); SQL timed
  out (KSFO never had San Carlos rows); SAN prints the ADR rows dotted with no altitude. The tool tags SFO runways on
  the SID (`SFO4(1)`, `GAPP7(28)`) and prints `CITTY3` for CIITY3 on SAC/O88 (a tool typo; transcribe CIITY#).
- [ ] `tec.yaml`: the route tool pages for 22 destinations (SMF MRY LVK APC WVI MYV OVE O88 SAC SFO SJC CCR HWD SQL
  PAO RHV NUQ STS MOD SCK MHR MCC) were captured 2026-09-16 with Playwright into `.tmp/oak-tec/<FAA>.txt`
  (gitignored; re-run `web/.tmp/oak-tec.ts` style script if lost). Findings: the tool prints an altitude band
  `030/090` (hundreds of feet, floor/cap; KSFO recorded the cap only); **OAKE rows begin on a heading token**
  (`[OAKE] +H270 FEVTA FEVTA1+ 100/100`), so the TEC substitution in `rules/amend/tec.ts` must accept `H<ddd>` at
  the head of a route as the numbered heading the SOP issues there, not a SID placeholder (brief 2 or 3).
- [ ] `import-worksheets --airport KOAK`; validation loop with the user. **Run 2026-09-16 in `wt/koak-worksheets`**: the
  two phraseology sheets imported (6 + 6 pending fixtures, uncommitted there); the three amendment sheets fail
  (`Amendment Practice 1A [310/330]: aircraft type 'OAK6 OAK ORRCA' is not a designator…`). Cause: the OAK amendment
  sheets carry **four correction cells after the five plan cells** (type, destination, altitude, route corrections:
  N238JP KJAC FL320 → `310/330` + `OAK6 OAK ORRCA`; SWA984 KLAX → `270`; SWA1984 KPDX → `OAK6 OAK GRTFL`; JSX201 →
  none; AAY218's destination cell reads `KPGI` with `KGPI` on a second line, a destination correction the engine
  has no box for; KAL65 → `OAK6 OAK RBL`; XOJ715 → `OAK6 OAK SYRAH`; SWA1859 → `OAK6 OAK TIPRE`; LXJ351 →
  `CNDEL5 KAYEX LOSHN EHF`; SWA1883, SWA126, N172SP → none; SKW2345 → the sheet ends). The KSFO sheets have five
  cells and no key. Cached text: `generator/cache/worksheets/1kcIMVHUhKnK33tL71JdRukDoHw0qILnkOQeq20fMXGU.txt`;
  the sheet itself: `https://docs.google.com/document/d/1kcIMVHUhKnK33tL71JdRukDoHw0qILnkOQeq20fMXGU/edit`. All three
  OAK amendment sheets have the cells. **User 2026-09-16: "Those were accidental notes that shouldn't have persisted
  and can't be trusted. They could be correct or not."** So the importer ignores every cell after the five plan
  cells and any extra line inside a cell (AAY218 files `KPGI`), records nothing from them, and a plan whose
  destination the shared file does not hold is skipped with a report line until the destination box exists.
  Brief 3d (parser) dispatched 2026-09-16 on `wt/koak-worksheets`; then **user: "The linked files have been
  restored to a clean version at the original URLs"**, so the brief was redirected. **Landed 2026-09-16**: the
  re-fetched sheets are clean (13 five-cell rows each, no note cells, AAY218 still files `KPGI`), so no parser
  tolerance was added; the importer skips a plan whose destination the shared file lacks and prints
  `skipped AAY218: destination KPGI is not in generator/shared/destinations.yaml`; 50 KOAK fixtures written
  (12 clearance, 38 amendment, all `pending`); `data/koak.json` gains the worksheet navaids. **Findings for the
  validation loop**: six amendment plans are unresolved with `R.sid | no assignment rule applies to SFOW no-gate
  runway 30 class J` (e.g. LXJ351 to KCRQ off runway 30: a KOAK SOP gap for jets whose exit fix is in no gate);
  SWA2021 to KPDX (`OAK6 DEDHD LMT OCITY7`) trips `LOA-ZSE-PDX-ROUTE` exactly as its KSFO twin does (open KSFO
  question); `ECA` (N436MS `OAK V244 ECA`) has no spoken name; **fixture ids collide across airports**
  (`ws-amendment-practice-1a-lxj351` exists under both `fixtures/ksfo/` and `fixtures/koak/`, so `propose <id>`
  is ambiguous: decide whether the importer prefixes new ids with the airport). Backlog: the amendment parser
  still counts five non-blank cells per row, so an empty plan cell would shift every later row.
- [ ] **KOAK validation loop, started 2026-09-16** (`pnpm -C web propose --pending`, 87 pending across both
  airports; the log is `.tmp/propose-pending2.log`). Data fix the same day: the KOAK gates lacked the worksheet
  exit fixes (CCR, RDD, LKV north; SUNNE, CISKO, EBAYE, LOSHN, LHS, BOILE, EHF, GILRO south), which blocked six
  jets with `no assignment rule applies to SFOW no-gate runway 30 class J`. Engine gaps found: (1) **route
  building never runs when the SOP falls through to a heading**: `checkHeadingRoute` takes the filed tail, so
  LXJ351 (`OAK6 EHF LHS V459 SLI V23 OCN`, southbound RNAV jet, no SID serves EHF) proposes the bare tail on the
  runway heading, while `builtExpectation` would build `CNDEL5 KAYEX LOSHN EHF …` (KAYEX → LOSHN always, LOSHN →
  EHF usually; the sheet's discarded note read `CNDEL5 KAYEX LOSHN EHF`); same for PXT415/VOI5909 (`SUNNE1 SUNNE
  KAYEX LOSHN …`). Fix: try `builtExpectation` in `checkHeadingRoute` before the filed tail. (2) **A bare SID
  family token** (`CNDEL PORTE SUSEY EBAYE BURGL`, FFT2015) is read as a fix, so the plan is unresolved;
  `isSidToken` wants a version. A token equal to a family in `airport.sids` is the procedure filed without its
  version, amended to the current one. (3) LOA-unresolved plans (JSX203 to KLAS via `NTELL Q158 JEDNA`, SWA888
  to KBUR via `CISKO LHS LYNXX8`, SWA2021 to KPDX) wait for the arrival-swap concept on MAIN.md. (4) `ECA`
  (N436MS `OAK V244 ECA`) is in no CIFP record this cycle (Manteca VOR decommissioned?); the engine replaces the
  route by the TEC row anyway, so the warning is harmless until a clearance-mode plan files it. **User answers
  2026-09-16**: (1) LXJ351 builds `CNDEL5 KAYEX LOSHN EHF LHS V459 SLI V23 OCN` ("OAK6 is a radar-vector SID so in
  theory `OAK6 OAK EHF`, but OAK6 is northbound per the SOP; the proposed route properly route-builds backwards onto
  a southbound SID appropriate for an RNAV jet"): **landed 2026-09-16** with the fixture settled (`BuildScope` on
  `buildRoute`: `filed` keeps only the filed family on the procedure path, `any` on the heading path; first
  candidate in table order that connects wins; reason closes "so the SID is issued in place of the heading").
  Consequences: SWA888 (no SID filed, `CISKO LHS LYNXX8`) now builds `CNDEL5 KTINA CISKO LHS LYNXX8` and the BUR
  LOA gap goes silent, since a built box is not held against the LOA rows (finding (a) on MAIN.md); VOI5909 builds
  `CNDEL5 KAYEX LOSHN BOILE …`. The ids are renamed (`ws-koak-…`, `ws-ksfo-…`, 120 files). (2) FFT2015: a bare `CNDEL`
  is a fix, not a data error; the plan is meant to be **simplified** by the student: CNDEL5 has SUSEY as a
  transition, so `CNDEL PORTE SUSEY EBAYE BURGL` becomes `CNDEL5 SUSEY EBAYE BURGL`. Concept to model: the exit fix
  is the first filed token that is a gate fix or a transition (tokens before it that name no fix, or lie on the
  SID's own structure such as PORTE, are dropped), and route building with a chain of length zero (a transition
  already on the filed route) keeps the route from that transition on; the KSFO twin `PORTE8 PORTE SUSEY EBAYE
  BURGL` reads the same way. Pending until built. (3) Fixture ids gain the airport: `ws-koak-…`, `ws-ksfo-…`, the
  importer writes them so and the existing files are renamed once (dispatched). (4) The OAK6 batch (FDX354, SWA2125,
  UPS2896) is right except for the expect clause (below); the route string should carry `OAK` after `OAK6` (the
  vector-SID navaid concept on MAIN.md, warning tier). (5) The NIMI6 batch (N281EB, CMD70, N436MS): right, NIMI5 →
  NIMI6, `OAK` missing after NIMI6, and **"why are we telling them what altitude to expect when it's on the chart
  that they should expect filed 10 minutes after?"** Cause found: the chart parser reads "10 minutes" but not
  "ten minutes", so COAST9, OAK6, QUAKE2 and NUEVO8 build with no chart note, and NIMI6 (no CIFP, hand facts)
  has none in `overrides.yaml`; KSFO's SFO5 chart reads "expect further clearance to filed altitude …" the same
  way (**user 2026-09-16: SFO5 gains the note too, "the chart covers it"; the settled KSFO fixtures that spoke the
  clause are re-settled without it**). **User 2026-09-16: SUNNE1's
  "Maintain 5000. Expect higher altitude five minutes after departure" also covers the clause.** (6) The CNDEL5
  batch (NKS188, SWA1740, FDX1563) is right; settled once the ids are renamed. (7) COAST9/NUEVO8 batch (SWA344,
  N903JP, N172SP): right as spoken, but **COAST9 is off per the ZOA notice** "SFO/OAK SEGUL/COAST SID: OFF. Issue
  SSTIK#/WESLA#/CNDEL# YYUNG. CFG: SFOW" (the KSFO `SFO-SEGUL-OFF` notice's other half): a KOAK `OAK-COAST-OFF`
  notice (`sid_off` COAST, SFOW); with the heading-path route building, a COAST9-filed plan such as SWA344
  (`COAST9 MCKEY LAX COMIX2`) should build `CNDEL5 YYUNG LAX COMIX2` (YYUNG → LAX usually), which is what the
  notice says to issue. The two COAST9 fixtures stay pending until the notice lands; the expect clause on all of
  them waits for the parser fix. **Landed 2026-09-16** (generator brief in `wt/koak-gen`): number words, the
  "clearance to" / "further clearance to" / "higher altitude" objects and a reversed-line-pair join in
  `chart_text.py` (pypdf emits the QUAKE TWO and NIMITZ SIX note halves in reverse order); COAST9, OAK6, QUAKE2,
  NUEVO8, NIMI6 → 10, SUNNE1 → 5; the optional `expect_filed_altitude_minutes` override exists but no airport
  uses it (NIMI6 reads from its own chart; **KSFO's SFO5 and GAPP7 already read 10 before this**, so the SFO5
  question was moot and no KSFO clearance changed); `OAK-COAST-OFF` notice active by default. With COAST off,
  SWA344 (`COAST9 MCKEY LAX COMIX2`) now resolves to the runway heading, radar vectors MCKEY: the notice's
  "issue CNDEL# YYUNG" wants route building from the heading path to reach `CNDEL5 YYUNG LAX COMIX2` (YYUNG →
  LAX usually), and it does: SWA1883 (amendment, `COAST9 MCKEY LAX COMIX2`) proposes `CNDEL5 YYUNG LAX
  COMIX2`, spoken "Candle Five departure, Yyung transition, direct Los Angeles VOR, then as filed. Climb via SID".
  N858EE (`COAST8 MCKEY LEGOZ LEGOZ1`, KCRQ) gets the heading with box `MCKEY LEGOZ LEGOZ1`, since no chain
  reaches LEGOZ (TILLT is a LEGOZ4 transition and YYUNG → TILLT connects, but the filed LEGOZ1 is stale and TILLT
  is not on the filed route: the arrival-swap concept). In clearance mode SWA344 and N903JP file COAST9 with the
  notice active, so the engine answers the runway heading. **User 2026-09-16: "The COAST9 notice says to switch
  to the CNDEL, so we shouldn't be falling back on headings. In general we should be trying to fit the CNDEL
  first, then the other southbound-eligible SIDs, before resorting to a no-SID heading departure."** Concept:
  route building in clearance mode too: `resolveClearance`, before taking a heading row, tries the passed-over
  SIDs in table order with the any-candidate scope and clears the flight on the built route (SWA344 → "Candle
  Five departure, Yyung transition, direct Los Angeles VOR, then as filed"); N903JP (`COAST9 GVO HABUT`) reaches
  no chain (nothing connects to GVO) and stays a question. **User 2026-09-16, UAL313**: type `B752/L` and route
  `OAK6 OAK MOGEE Q124 BVL WAATS5`: concept, every route token must be a known fix, navaid, airway or procedure
  (from the CIFP) and an unknown one is a route amendment; pending until built. **User 2026-09-16, PXT415**
  (C25B/A, `SUNNE1 SUNNE KAYEX LOSHN PMD V137 PSP`): "requires looking at the various charts to see if you can
  find a good fix on the way to one filed. SKYL1 PXN LOSHN works and keeps them on a SID that's conventional"
  (SKYLINE ONE chart: PXN transition, LOSHN just east of it); a `PXN → LOSHN` row made the heading path build
  `SKYL1 PXN LOSHN PMD V137 PSP`, then **user 2026-09-17: "make that WAGES LOSHN instead of PXN LOSHN. WAGES is
  also on SKYL1 and seems to be preferred as an exit fix when PXN isn't involved"**: the row is `WAGES → LOSHN`
  and the expected route `SKYL1 WAGES LOSHN PMD V137 PSP`. WAGES is the SID's end fix, not a published
  transition, so the builder must also start a chain from a SID's end fix (engine, if the row alone does not
  build). VOI5909's `CNDEL5 KAYEX LOSHN BOILE …` stands.
  The settled-fixture commit landed 2026-09-16 (25 fixtures; EJA115 carries the route box `OAK6 RBL J1 BTG
  OLM2` beside FL430 since its plan filed no SID). **Amendment rulings
  2026-09-16** (engine answers confirmed, to settle once the ids are renamed; vector-SID proposals gain `OAK` when
  the navaid concept lands and are re-settled then): (a) **RVSM suffix rule: an RVSM-capable type filing a
  non-RVSM suffix at an RVSM level has its altitude amended, the type stays as filed** (the engine's behaviour):
  SWA984-KOAK (B737/G, FL350 → FL270), FDX3859 (B752/A, FL340 → FL270 and `HUSSH2` → `OAK6 MOGEE …`), SWA1922
  (no suffix → `B737/L`, FL280 → FL270, `OAK6 AVE J6 PMD` → `SKYL1 AVE J6 PMD`). (b) Altitudes: N238JP FL310, SWA126
  FL320, XOJ715 FL410, EJA115 FL430 right; **FDX3875 (MD11, PHNL, `BEBOP R464 …`) is correct as filed at FL310:
  R464 is a unidirectional oceanic airway, exempt from parity** (new data concept: an airway row that exempts a
  route from the parity rule; FDX3875 pending until it lands). (c) TEC batch right: SKW2345 `OAK6 OAK FEVTA FEVTA1`
  10,000; N172SP `NIMI6 OAK V6 SAC`; N346G 5,000 + `NIMI6 OAK V6 SAC`; N436MS `NIMI6 OAK V244 ALTAM MOD`; N222T
  `NUEVO8 EUGEN`; N739ML 5,000 + `NIMI6 OAK V6 SAC`. (d) SID batch right: AAY1002 and NAX7068 `OAK9` → `OAK6`;
  SWA1585 `CNDEL4` → `CNDEL5`; SWA1859 `SLNT1 …` → `OAK6 LIN TIPRE …`; SWA1984 `HUSSH2 …` → `OAK6 GRTFL …`; as
  filed JSX201, SWA556, QXE2415, TWY313. Still pending with a reason: NKS510 (A320/A FL350 `CNDEL5 SUSEY …`: the
  engine offers the type box as the RNAV pair AND amends the altitude to FL270 AND the route to the runway heading
  tail; under ruling (a) the type stays, so the answer is altitude FL270 + route `SUSEY EBAYE BURGL IRNMN2` on the
  runway heading, but the three-box print suggests the altitude is judged on the uncorrected plan while the pair
  is offered: check `judge()` before settling); UAL313 (`/Q` is no FAA suffix, so `B752/L` is right, but the route
  typo `BVLQ124` for `Q124` is unaddressed: ask); SWA1254, N471RY, N918AR, KAL65 (vector-SID navaid; N918AR to KSMO
  via AVE also trips the SMO props LOA row only once amended boxes are held against the LOA rows).
- [ ] **New concept (user 2026-09-16): destination amendment box.** AAY218 on Amendment Practice 1A files `KPGI` with
  `KGPI` as the correction; the strip has type, altitude and route boxes only. The user chose a fourth box for the
  destination over importing the plan as corrected. Needs: schema (`amendments[].box: 'destination'`, fixture
  variant), `rules/amend/` a destination check (an unknown ICAO whose one-letter-transposed neighbour is in the
  library? or the sheet's answer only — decide with the user), the amendment UI box, the results view, the
  importer's correction-cell reading. Plan before the OAK amendment import; the two phraseology sheets can land
  first.
