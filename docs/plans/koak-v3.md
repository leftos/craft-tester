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

- [ ] **Type-specific class**: "J & DH8D" rows treat the Dash 8-400 as a jet for SID assignment but give it its own
  altitude (CVS x 10,000 vs FL190). Proposal: `aircraft_groups` in the airport YAML mapping a group id to classes
  and/or types (`jets_and_dh8d: {classes: [J], types: [DH8D]}`), and rows reference groups instead of classes.
- [ ] **Heading departures as a first-class clearance**: OAK issues 090°/270°/315°/runway heading routinely; the
  route element becomes "via turn left/right heading (xxx), radar vectors (fix/airway)" with the turn direction
  derived from runway heading vs assigned heading (data: runway true/magnetic headings from CIFP `PG` records).
  Altitude "maintain (feet)", expect clause spoken (no chart note).
- [ ] **Plain "climb via SID"** for CNDEL# and HUSSH# (row outcome `climb_via`): already supported by the engine.
- [ ] **CVS x FL190**: an interim expressed as a flight level; check `speakAltitude` and the altitude row schema.
- [ ] **Continuation charts**: the chart parser must merge `NAME, CONT.1` text into `NAME` (6 of 17 OAK charts).
- [ ] **Approach category** ("P, Cat A/B → SALAD#"): a per-type approach category in the fleet, or treat as props.
- [ ] **Three departure sectors** (Richmond, Sutro, Grove) and "varies" rows resolved by direction: already
  expressible (`direction` on the row).
- [ ] **Optional noise abatement**: appendix rows are "may be activated"; model as a notice-like toggle that turns
  the noise rows on, default off, rather than as time windows alone.

## Steps

- [ ] Pull S1-OAK-2 and S1-OAK-5 worksheets (Chrome), add to `generator/airports/koak/worksheets.yaml`
- [ ] Inspect KOAK CIFP SID records; classify the 11 procedures; check for radar-vector SIDs with no CIFP body
- [ ] Land the new rule concepts above (schema first, KSFO data unchanged, tests)
- [ ] Transcribe `sop.yaml` (v1.7, sentinels), `overrides.yaml`, `routes.yaml`, `tec.yaml`; `verify-sop`; build
- [ ] `data/airports.json` gains KOAK; widen the KSFO-only web tests
- [ ] Validation loop with the user
