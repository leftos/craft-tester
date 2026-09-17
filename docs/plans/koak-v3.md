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
- [ ] **Brief 3c, `loa.yaml` ZLA and ZLC rows** (after 3b; data only, `wt/koak-data`). Sources: ZOA–ZLA LOA effective
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
- [ ] **Brief 3b-ii, KOAK into the index** (dispatched 2026-09-16 on `wt/koak-data` at `3ee592d`): `data/airports.json`
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
- [ ] **Brief 2f, TEC initial altitude** (user 2026-09-16: "In TEC routes, the first number is the initial/interim
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
  data finding for the validation loop, listed row by row, never patched in the engine. Engine files:
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
- [ ] `import-worksheets --airport KOAK`; validation loop with the user
