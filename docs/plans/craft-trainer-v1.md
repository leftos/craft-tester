# CRAFT Clearance Trainer (KSFO) — Implementation Plan

## Context

ZOA (Oakland ARTCC, VATSIM) trainees learning Clearance Delivery must turn a flight plan into a spoken
CRAFT clearance, and the hard part is the fiddly phrasing: "DEDHD transition" vs "radar vectors DEDHD"
vs "then as filed"; "climb via SID" vs "climb via SID except maintain 5,000" vs "maintain 5,000"; which
departure frequency; which SID the SOP actually wants for this runway/direction/aircraft class. The user
wants a small instructional minigame where each scenario shows a flight strip plus ATIS runway config and
the player assembles the clearance from dropdowns, gets per-element grading with the rule that decided it,
and then sees the full spoken clearance.

Decisions made with the user (2026-09-15):

| decision | choice |
|---|---|
| platform | static web app, Vite + vanilla TypeScript, pnpm, oxlint/oxfmt, vitest; GitHub Pages |
| data flow | offline Python generator (uv/ruff/ty/pytest) in this repo emits checked-in `data/ksfo.json` |
| generator | self-contained (own ARINC 424 SID parser + pypdf chart text); no import of zoa-reference-cli |
| scope v1 | KSFO, all 12 SIDs; a second airport is a data addition, not a code change |
| answer key | rules engine, validated against trainer CRAFT worksheets used as test fixtures |
| SID choice | part of the game (filed route may lack a SID or carry the wrong one) |
| scoring | submit once, grade each CRAFT element green/red with reason, then reveal full clearance |
| game modes (v1) | **Clearance mode** (CRAFT builder) and **Amendment mode** (spot the wrong box in type/altitude/route and fix it), mirroring the two worksheet types |
| full-route phraseology | reveal only: the spoken reveal shows abbreviated ("then as filed") and full-route readings; no extra grading |
| runway configs | all SOP configs from day one: 28/01, 28 RT, 28 SO, 01/01, 10/10, 19/10, 19/19 |
| answer-key validation | engine proposes; the user validates **one example at a time** and corrects the rules until confidence is high, then a batch review of the remaining worksheet plans; corrections land in YAML, fixtures flip `pending` → `settled` |

### Worksheets (pulled 2026-09-15 from the S1-SFO-1 module on oakartcc.org)

Seven public Google Docs, exportable as text via `https://docs.google.com/document/d/<id>/export?format=txt`
(no auth needed). They contain **flight plans only, no answer keys**, so the "expected clearance" half of
each fixture must come from the rules engine and be confirmed by the user (or their trainer). Fixtures start
`pending` and are promoted to `settled` after review.

| doc id | title | type | config | count |
|---|---|---|---|---|
| `15xXEKZHDHvb5YmRurVv5rXdgiHdO_RiMrfrRVFt6E8w` | Phraseology Practice 1A | abbreviated clearance, routes correct | SFOW | 6 |
| `1ipC_K-axKq8eaPFADa8dPKHsgHU-wsNh5Z1jgJHyfVw` | Phraseology Practice 2 | **full route clearance**, routes correct | SFOW | 6 |
| `1ocBGUKoB23NLV2hYK-P9rRfpXWy5Z19TsyprG4uKP5I` | Phraseology Practice 3 | abbreviated, routes correct | SFOW 28 SO | 6 |
| `1yLZA87NLY-9ZfGOGR2K7FJ0gx3-GjkQGaslnZ6nmesw` | Amendment Practice 1A | at most one box wrong per plan; fix it | SFOW 28/01 | 13 |
| `1RrXqB6PTJi3xbXdwH9VXtcO70ea9-HWorv2JidRej78` | Amendment Practice 1C | same 13 plans as 1A | SFOW 28 SO | 13 |
| `1fld9dcjg9Kzo-apbjMVCvWKtNJUFOtMKayxCOHrWrH8` | Amendment Practice 2 | most plans have ≥1 wrong box | SFOW 28 RT | 13 |
| `1UgC3pa45psuYKSne-bJW5jrVU6L0A2vxOYZrTlZAuvM` | Amendment Practice 3 | ≥1 wrong box | SFOW 28/01 | 13 |

Phraseology-sheet plan shape: callsign, type with equipment suffix (`A320/L`, `B350/G`, `C172/G`,
`H/A306/L`), destination, cruise altitude, squawk, route. Amendment-sheet shape: callsign, type, dest,
altitude, route in a table; boxes that can be wrong are type/suffix (RNAV capability, RVSM), altitude
(direction of flight, RVSM, too high for type), and route (no SID, wrong SID, stale SID version, wrong
transition for destination, TEC route for NCT destinations).

Route patterns the engine must handle (all from the sheets): `TRUKN2 DEDHD …` (transition), `TRUKN2 TRUKN
CCR CCR2` (exit at the base fix → "then as filed"), `WESLA5 NTELL` (transition is the whole route),
`GAPP7 OAK V244 …` / `GAPP7 SGD YAGER` / `GAPP7 EUGEN` (vector SID; OAK and SGD are CIFP vector
transitions, EUGEN is not), `SFO4 RBL J1 …` / `SFO4 SAC …` / `SFO4 DEDHD …` (radar vectors to a fix),
props on TEC routes to NCT airports (KSMF, KLVK, KAPC, KMRY, KWVI, O88, KOVE, KMYV). Sheets still cite
SFO4, NIITE3, WESLA4, PORTE8, OAK6: fixtures compare SIDs by family, and stale versions are a valid
"wrong SID" distractor.

## Data facts established during planning

### Sources (all public, no auth)

| source | URL | notes |
|---|---|---|
| ZOA charts API | `https://charts-api.oakartcc.org/v1/charts?apt=SFO` | JSON `{"SFO":[{chart_code, chart_name, pdf_path,...}]}`; `chart_code == "DP"` gives the 12 SIDs |
| FAA chart PDFs | `https://aeronav.faa.gov/d-tpp/<AIRAC>/00375<NAME>.PDF` | single page; pypdf text layer is clean enough (see below) |
| FAA CIFP | `https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_<YYMMDD>.zip` | ~53 MB `FAACIFP18` text; AIRAC epoch 2025-01-23, 28-day cycles |
| SFO ATCT SOP | `https://oakartcc.org/controllers/file/9a2b1e84-5e65-11e9-8010-2a32edb55910` | PDF v1.11, 34 pp; tables flatten to one cell per line under pypdf |
| ZOA positions | scraped by zoa-reference-cli into `~/.zoa-ref/cache/positions/all.json` | only needed to confirm sector frequencies; hand-transcribe into SOP data |

### ARINC 424 SID record layout (verified against cached FAACIFP18-2608, 210 KSFO rows)

`line[0]=='S' and line[4]=='P' and line[6:10]=='KSFO' and line[12]=='D'`; SID id `[13:19]`, route type `[19]`,
transition `[20:25]`, seq `[26:29]`, fix `[29:34]`, path terminator `[47:49]`, altitude description `[82]`,
alt1 `[84:89]`, alt2 `[89:94]`. Route types: `1/2/3` conventional runway/common/enroute, `4/5/6` RNAV,
`T/V` vector-SID runway/enroute. Initial climb legs (`VA`, `CA`) have a blank fix field and must be kept.

### KSFO SID classification (from CIFP + chart text, AIRAC 2609)

| SID | chart name | kind | top altitude | dep freq | enroute transitions |
|---|---|---|---|---|---|
| SFO5 | SAN FRANCISCO FIVE | radar_vectors (absent from CIFP) | ASSIGNED BY ATC | 120.9 | none; "RADAR vectors to assigned route/fix" |
| GAPP7 | GAP SEVEN | vector_hybrid (route types T/V) | none published | 120.9 NW-E / 135.1 SE-W | CIFP vector transitions ALCOA BEBOP ENI OAK OSI SAU SGD; chart lists none |
| MOLEN9 | MOLEN NINE | conventional_pilot_nav (1/3), crossing restrictions | ASSIGNED BY ATC | 135.1 | ENI |
| SEGUL1 | SEGUL ONE (RNAV) | rnav_pilot_nav | ASSIGNED BY ATC | 135.1 | YYUNG |
| WESLA5 | WESLA FIVE (RNAV) | rnav_pilot_nav | AS ASSIGNED | 135.1 | KAYEX KTINA NTELL SUSEY YYUNG |
| GNNRR3 | GNNRR THREE (RNAV) | rnav_pilot_nav | 3000 | 135.1 | ALCOA AMAKR BEBOP CINNY |
| SNTNA2 | SNTNA TWO (RNAV) | rnav_pilot_nav | 3000 | 120.9 | DEDHD GRTFL MOGEE ORRCA SYRAH TIPRE |
| TRUKN2 | TRUKN TWO (RNAV) | rnav_pilot_nav | FL190 | 120.9 | DEDHD GRTFL MOGEE ORRCA SYRAH TIPRE |
| NIITE4 | NIITE FOUR (RNAV) | rnav_pilot_nav | FL190 | 120.9 | DEDHD GOBBS GRTFL MOGEE ORRCA SYRAH TIPRE |
| CIITY3 | CIITY THREE (RNAV) | rnav_pilot_nav | FL190 | 120.9 | DEDHD GRTFL MOGEE ORRCA SYRAH TIPRE |
| SAHEY4 | SAHEY FOUR (RNAV) | rnav_pilot_nav | FL190 | 135.1 | KAYEX KTINA NTELL SUSEY |
| SSTIK5 | SSTIK FIVE (RNAV) | rnav_pilot_nav | FL190 | 135.1 | KAYEX KTINA NTELL SUSEY YYUNG |

Chart text regexes that work: `TOP ALTITUDE:` (value is the adjacent line, before or after),
`^(\w{3,5}) TRANSITION \((\w+)\.\s?(\w+)\)`, `NORCAL DEP CON` (frequency on adjacent line, optionally
tagged `(SE-W)`/`(NW-E)`), `TAKEOFF RUNWAYS ...`. Line order is scrambled, so treat the page as a bag of
lines.

### SFO SOP 2-2 (v1.11) — to be hand-transcribed into `data/sop/ksfo.yaml`, with SOP version + SHA asserted

Runway configs: 01/01, 28/01, 28 RT (TRUKN in use), 28 SO, 10/10, 19/10, 19/19. Clearance Delivery 118.2.
Aircraft classes P (prop), T (turboprop), J (jet).

SFOW DP assignment: Northbound rwy 01/28 P,T,J → TRUKN# (Richmond 120.9); rwy 28 → SNTNA# (in 28/01
config SNTNA# replaces TRUKN# off the 28s); rwy 01 → SFO#; rwy 28 → GAPP#. Southbound rwy 01 J → SSTIK#
(Sutro 135.1); rwy 28 J → WESLA#; 01/28 → SEGUL#; P,T,J → GAPP#. Oceanic rwy 28 J → GNNRR#, MOLEN#;
01/28 P,T,J → GAPP#.
SFOE: Northbound 10/19 P,T,J → CIITY#, GAPP# (Richmond); Southbound J → SAHEY#, P,T,J → GAPP# (Sutro);
Oceanic J → MOLEN#, P,T,J → GAPP#.
Non-DP headings: rwy 01 050/350/runway heading after coordination; rwy 10 085/runway heading.

Interim altitudes (when no TOC/top altitude is published): SFOW GAPP#, MOLEN#, SEGUL#, SFO#, WESLA# off 28
P,T,J → 3,000 "or CVS x 3,000"; all others 01/28 P,T → 5,000 / CVS x 5,000; J → 10,000 / CVS x 10,000.
SFOE all 10/19 P,T → 5,000; J → 15,000. Non-standard interim → "expect filed altitude 3 minutes after
departure".

Noise abatement 2200L–0700L (0800L Sun): Northbound 01/28 P,T,J → NIITE#; Southbound 0100–0500L rwy 01
→ NIITE# GOBBS; rwy 01 non-RNAV props → runway heading.

### Phraseology rules (FAA JO 7110.65 4-3-2 as ZOA applies them; worksheets are the arbiter)

- Altitude (7110.65 4-3-2 c.4/c.5, confirmed against ZSE/ZFW/ZLA training pages 2026-09-15):
  SID with published crossing restrictions and no radar-vector segment → "climb via SID" when the
  published top altitude equals the desired altitude, else "climb via SID except maintain X" (also when
  top altitude is ASSIGNED BY ATC / AS ASSIGNED). SID with no crossing restrictions, a radar-vector SID,
  or a SID with a vector segment → "maintain X". Expected at KSFO: SFO5, GAPP7 → maintain; MOLEN9,
  SEGUL1, WESLA5 → CVS except maintain 3,000 (off 28s); the RNAV SIDs → CVS except maintain 5,000 /
  10,000 / 15,000 by class and plan. Plain "climb via SID" appears only where top altitude == desired.
- Route: first filed fix after the SID is one of its enroute transitions → "(SID) departure, (fix)
  transition, then as filed". Radar-vector SID → "(SID) departure, radar vectors (fix), then as filed".
  Otherwise → "(SID) departure, then as filed".
- Open until worksheets are read: GAPP7 vector transitions (transition vs "radar vectors"), whether
  "expect (filed altitude) 10 minutes after departure" is spoken when the chart publishes it.

### TEC routes and other amendment-mode sources (checked 2026-09-15)

- `https://reference.oakartcc.org/routes?dep=SFO&dest=SMF` is a Blazor Server app (no JSON API; the CLI
  scrapes it with Playwright). Rendered text is regular, e.g. `Any Any Jet [SFOW] +TRUKN2 TRUKN FEVTA
  FEVTA1+ 100/`, `Any Any Prop [SFOW] +SFO4(1) OAK V6 SAC+ 060`, `[SFOE] +GAPP7 OAK V244 ALTAM V392 SAC+
  060`; `(1)`/`(28)` after a SID = departure runway family, trailing `100/` or `060` = altitude cap in
  hundreds of feet. Decision: **hand-transcribe** TEC routes for the NCT destinations that appear on the
  worksheets (KSMF, KLVK, KAPC, KMRY, KWVI, O88, KOVE, KMYV, KSAC, KOAK, KSJC, KRNO-excluded per SOP) into
  `generator/airports/ksfo/tec.yaml` with the source URL per row. No Playwright dependency in the generator.
- The NCT SOP and ZOA–NCT LOA PDFs do not contain TEC tables (grepped the cached copies).
- Equipment suffixes: FAA JO 7110.65 Table 5-4-1 (`/L` RVSM+GNSS, `/Z` RVSM+RNAV no GNSS, `/W` RVSM no
  RNAV, `/G` GNSS, `/I` RNAV no GNSS, `/A` DME+Mode C no RNAV, etc.) — static table in the airport JSON
  (`equipmentSuffixes`), used for RNAV-SID eligibility and RVSM (FL290–FL410) checks.
- Direction-of-flight altitude rule (14 CFR 91.179): magnetic course 0–179 odd thousands, 180–359 even;
  above FL410, 4,000-ft intervals. Needs origin/destination coordinates: US airports from CIFP `PA`
  records; the handful of foreign destinations on the sheets (RKSI, ESSA, MMMX, CYVR, PHNL is US) from a
  small hand table in `routes.yaml`.
- Aircraft service ceilings are not in vNAS AircraftSpecs (fields: Designator, EngineType, WTC, WTG,
  Description); a per-fleet-type `ceiling` field in `routes.yaml` covers the "FL430 in a B738" check.

## Design

### Key decisions

| decision | choice | why |
|---|---|---|
| rules engine location | TypeScript only, `web/src/rules/` | game grades client-side; a Python mirror would be a second implementation with no consumer. Python does data-integrity checks only |
| schema source of truth | zod schema in `web/src/data/schema.ts`; `z.toJSONSchema()` exported to `data/schema/*.json` (checked in); generator validates its output against that export with `jsonschema` | one artifact yields TS types, runtime validation, and the JSON Schema Python needs; a vitest sync test fails when the export is stale |
| SOP tables | hand-transcribed `generator/airports/ksfo/sop.yaml`; generator downloads the SOP PDF and asserts sha256 plus sentinel strings (`3,000 or CVS x 3,000`, `TRUKN#`) | flattened PDF tables are unparseable; hash + sentinels catch drift |
| rule data vs code | every SOP-derived decision (assignment rows, altitude rows, noise windows, phrasing toggles) is a row in the airport JSON with `id`, `source`, `text`; the engine is a matcher | worksheet corrections become YAML edits, and each graded element cites the rows that decided it |
| distractors | deterministic: all plausible values from data (all SIDs, all frequencies, all interim altitudes ∪ top ∪ filed) | no RNG in grading, testable |
| scenarios | generated at runtime in TS from a curated `routes.yaml` library, seeded PRNG, seed in URL hash | reproducible/shareable scenarios for trainer review |
| aircraft class P/T/J | vNAS `https://data-api.vnas.vatsim.net/Files/AircraftSpecs.json` `EngineType` (Piston→P, Turboprop*→T, Jet→J), restricted to the curated fleet | public, already used by the user's yaat project |
| second airport | `generator/airports/<icao>/{sop,overrides,routes}.yaml` → `data/<icao>.json`; web reads `data/airports.json` index | no code keyed on KSFO |
| dependencies | Python: `pypdf`, `pyyaml`, `jsonschema`; dev `pytest`, `hypothesis`, `ruff`, `ty`. TS: `zod`; dev `vite`, `typescript`, `vitest`, `oxlint`, `oxfmt` | each justified above; stdlib `urllib` for HTTP; no UI framework |

### Repo layout

```
X:\dev\craft-tester\
  .github/workflows/{ci.yml,pages.yml}  .github/dependabot.yml
  .pre-commit-config.yaml  .gitignore  README.md  CLAUDE.md
  docs/ARCHITECTURE.md  docs/plans/MAIN.md
  data/schema/{airport,fixture}.schema.json  data/airports.json  data/ksfo.json
  fixtures/ksfo/synthetic/*.json  fixtures/ksfo/worksheets/*.json
  generator/
    pyproject.toml  uv.lock
    src/craft_generator/
      cli.py  http.py  charts_api.py  chart_text.py  aircraft_classes.py  merge.py  emit.py
      cifp/{cycle,records,sid}.py
      sop/{model,load,verify}.py
    airports/ksfo/{sop,overrides,routes}.yaml
    tests/  (fixtures/cifp/ksfo_sid_records.txt, fixtures/chart_text/*.txt, fixtures/sop_text.txt, test_*.py)
    cache/   (gitignored)
  web/
    package.json  tsconfig.json  vite.config.ts  .oxlintrc.json  index.html
    scripts/export-schema.ts
    src/main.ts  src/styles.css
    src/data/{schema,load}.ts
    src/rules/{types,sidSelection,routePhrasing,altitude,frequency,engine,options,grade,speak}.ts (+ colocated *.test.ts, fixtures.test.ts, engine.exhaustive.test.ts)
    src/scenario/{rng,generate}.ts
    src/ui/{app,strip,atis,craftForm,results}.ts
```

### Airport data model (`data/ksfo.json`, zod in `web/src/data/schema.ts`)

- `airport {icao, faa, spoken, clearanceDelivery}`, `provenance {airac {cycle, effective, cifpSha256}, chartsApi, sop {url, sha256, transcribedAt}}`
- `runwayConfigs[] {id ("28/01"), plan "SFOW"|"SFOE", arrivalRunways, departureRunways[{runway, classes}]}`
- `departureSectors[] {id "richmond"|"sutro", name, frequency}`, `frequencies[]` (distractor pool)
- `gates {north: [fix], south: [...], oceanic: [...]}` — exit fix → SOP direction, hand-curated
- `sids[] {id "TRUKN2", family "TRUKN", chartName, spoken, kind: rnav_pilot_nav|conventional_pilot_nav|vector_hybrid|radar_vectors, rnavRequired, runways[], transitions[{fix, spoken, kind: enroute|vector, spokenAsTransition}], topAltitude {kind: published|assigned_by_atc|none, feet?}, hasCrossingRestrictions, restrictions[], climbViaEligible, routePhrasing, chartFrequencies[], chart {pdfUrl}}`
- `assignmentRules[]` ordered, first compatible match wins: `{id, source, text, plan, direction, runwayFamilies, classes, sidFamily, sector, when? {configs, notConfigs, noiseWindow, rnav}}`
- `noiseWindows[] {id, start, end, sundayEnd?}`
- `altitudeRules[]` ordered: `{id, source, text, plan, runwayFamilies, classes, sidFamilies?, outcome {kind: interim|climb_via, feet?}, whenTopAltitudePublished: interim|climb_via, expectAfterMinutes}`
- `phraseology {expectAltitude: always|unless_chart_publishes_it|never, nonStandardInterimExpectMinutes: 3, vectorHybridTransitionsSpoken: false}` (the clause is never spoken when the filed altitude is the altitude cleared to; `unless_chart_publishes_it` also drops it when `sids[].chartExpectFiledAltitudeMinutes` is set) plus a small `phraseologyRules[]` table quoting 7110.65 4-3-2 for citations
- `aircraftClasses {type: P|T|J}`, `routeLibrary {destinations[], fleet[], routes[{exitFix, tail, destination, classes, altitudes}]}`

### Fixture schema (`fixtures/**/*.json`)

`{id, source {kind: worksheet|synthetic, trainer?, date?, note?}, status: settled|pending, airport, scenario {callsign, aircraftType, rnavCapable, destination, filedRoute, filedAltitude, runwayConfigId, departureRunway, localTime, dayOfWeek, squawk}, expected {clearedTo, sidFamily, route {template: transition|radar_vectors_fix|as_filed, fix?}, altitude {phrase: climb_via|climb_via_except|maintain, feet?}, expect {feet, minutes}|null, frequency, spoken?}}`.
`pending` fixtures run but do not fail the suite (vitest `test.fails`), so open phraseology questions are recorded from day one. The same `scenario` shape is what the runtime generator produces.

### Rules engine pipeline (`web/src/rules/engine.ts`, each helper ≤100 lines)

1. `classify` → class P/T/J, plan, runway family (01/28/10/19), active noise windows (midnight wrap, Sunday end).
2. `parseFiledRoute` → strips a leading SID token (missing, wrong, or stale version), drops a colocated `SFO` navaid, exit fix = first remaining token; `direction = gates[exitFix]` else `Unresolved`.
3. `selectSid` → assignment rows filtered by plan/direction/runway family/class/`when`; first row whose SID is compatible (runway, RNAV capability, transition contains exit fix or SID kind is vector/radar). Returns SID + sector + citation.
4. `phraseRoute` → pilot-nav SID with matching enroute transition → `transition`; `radar_vectors` → `radar_vectors_fix`; `vector_hybrid` → per `sid.routePhrasing` and the `vectorHybridTransitionsSpoken` toggle; else `as_filed`.
5. `resolveAltitude` → first matching altitude row. `interim N`: not climb-via eligible → `maintain N`; published top and row says `climb_via` → `climb_via`; else `climb_via_except N`. Filed altitude below N caps to filed. Expect clause per `phraseology.expectAltitude`, 10 min standard, 3 min for non-standard interim.
6. `frequency` → sector frequency, cited from the assignment row.
7. `clearedTo` → destination.

`options.ts` builds deterministic dropdown lists; `grade.ts` compares picks to expected per element (SID by family) and returns `{element, ok, expectedLabel, actualLabel, citations}`; `speak.ts` renders the spoken clearance with number phonetics, in both abbreviated and full-route form for the reveal.

### Amendment mode (`web/src/rules/amend/`)

Input: the same `Scenario` (a filed plan) plus config. Output: `Amendment[]` — zero or more `{box: "type"|"altitude"|"route", reason, citations, proposed}` — and the corrected plan. Checks, each a small function with its own tests:

- **route**: no SID / SID from another airport / stale version / SID not valid for config, runway family, direction, class / RNAV SID with a non-RNAV suffix / exit fix not a transition or gate of the SID / NCT destination whose route does not match a `tec.yaml` row (rows keyed by plan, runway family, class). Proposed fix = the clearance-mode engine's SID + the filed tail, or the TEC route.
- **altitude**: direction-of-flight parity, **overridden by LOA rules**. User steer 2026-09-15: the ZOA–ZSE LOA requires even altitudes into ZSE airports. The LOA text (effective 2025-09-04, §4.c, fetched from `oakartcc.org/controllers/file/84f7be5c-…`) actually rotates the boundary: course 020–199 → odd (7110.65 "0–179" altitudes), 200–019 → even; FL240+ oceanic transitions exempt. SFO→SEA/PDX courses (~350°) are even under both readings; the difference shows only for courses 000–019 and 180–199. Encode the LOA text as the rule, cite it, and settle the user's stated version against it in step 21. Attachment 1 preferred routings (SEA via ..RBL..LMT / ..KNGDM / ..BTG; PDX via ..MACHU / ..MOXEE / ..OED; non-RNAV alternates) become route checks for ZSE destinations. Other center LOAs (ZLA, ZLC) get the same treatment where worksheet destinations need them; RVSM band without an RVSM suffix; TEC altitude cap exceeded; above the type's ceiling; below the SID top altitude when the SID requires it (informational only). LOA rules live in `generator/airports/ksfo/loa.yaml` as `{id, source (LOA + section), destinations|destinationPrefixes|artcc, rule: even|odd|max|route, text}` and are cited like SOP rows.
- **type**: missing suffix; suffix inconsistent with the route's navigation requirement (RNAV SID or Q/T-route with a non-RNAV suffix) when the route is otherwise correct for the destination. Ambiguity rule: if both "fix the suffix" and "fix the route" would resolve it, prefer the box the worksheet author intended as recorded in the fixture; until settled, the engine reports both and the fixture stays `pending`.

UI: the strip is shown as an editable form with the three boxes; the player marks each box "correct" or edits it; grading compares per box. Worksheet amendment plans (52 rows across four sheets, many duplicated across configs) become fixtures with `expected.amendments[]`.

Scenario generation for amendment mode: take a correct generated plan and inject one fault from the check list (or none, 20%), so every fault is detectable by construction.

### Generator pipeline (`uv run craft-gen build --airport KSFO [--cycle 2609] [--offline] [--check]`)

1. fetch charts API, keep `chart_code == "DP"`, cache JSON
2. download chart PDFs to `cache/pdfs/<cycle>/`
3. `chart_text.py`: pypdf bag-of-lines → top altitude (same or adjacent line), transitions, dep frequencies with sector notes, RNAV flag
4. `cifp/cycle.py` + `http.py`: AIRAC effective date → `CIFP_YYMMDD.zip`, unzip `FAACIFP18`
5. `cifp/records.py` + `sid.py`: filter KSFO SID rows, slice fields, skip continuation records, group per SID → runways, common legs, enroute/vector transitions, crossing restrictions (excluding VA/CA/VI/CI initial climb legs), kind
6. `sop/`: load YAML, cross-ref validate, download SOP, assert sha256 + sentinels (`--allow-sop-drift` downgrades to warning)
7. `aircraft_classes.py`: vNAS EngineType → P/T/J for the fleet, assert against declared class
8. `merge.py`: join chart + CIFP + SOP + overrides (GAP SEVEN→GAPP7, SAN FRANCISCO FIVE→SFO5 radar_vectors with runways from overrides); integrity checks fail the build: every rule SID family resolves, every transition/exit fix in exactly one gate, every sector exists, every fleet type classed, warn on SIDs with no assignment row
9. `emit.py`: validate against `data/schema/airport.schema.json`, stable sorted JSON, `--check` diffs against the committed file

`--offline` uses only `cache/` and test fixtures so CI runs a golden `build --offline --check`.

Scenario generation (runtime TS): weighted config pick, runway allowed for class, fleet → callsign, route whose exit fix is reachable, altitude from route, time (70% day / 30% noise windows / 1-in-7 Sunday), squawk. Filed-SID mutation: 50% correct, 30% none, 20% wrong (other SID or version−1). Seeds 0..999 must all resolve.

## Implementation steps

Orchestrator/implementer split per global standards: main session writes docs, plans, config; source and test edits go to the `implementer` agent with a brief (worktree root, files, change, proving command). Load `language-conventions` before each brief. Steps 2–3 and 4–6 are independent tracks; 7 depends on 5–6; 9 on 3, 7, 8; 10 on 9; 11–13 on 10; 14 on 12–13.

| # | step | files | proving command |
|---|---|---|---|
| 1 | scaffold: `git init`, `.gitignore`, README, CLAUDE.md, `docs/ARCHITECTURE.md` skeleton, `docs/plans/MAIN.md` with steps 2–16 as checkboxes, prek config (hygiene hooks), dependabot | root, `docs/` | `prek install && prek run --all-files` |
| 2 | web scaffold: pnpm, Vite + TS with the 7 strict flags, oxlint (typescript/import/unicorn, deny warnings), oxfmt, vitest, exact pins, `minimumReleaseAge 1440`, `ignore-scripts`; add TS hooks to prek | `web/*` | `pnpm -C web build && pnpm -C web lint && pnpm -C web test` |
| 3 | zod schema for AirportData + Fixture, `scripts/export-schema.ts`, `data/schema/*.json`, `data/airports.json`, schema sync test | `web/src/data/`, `web/scripts/`, `data/schema/` | `pnpm -C web schema:export && pnpm -C web test` |
| 4 | generator scaffold: pyproject (uv, ruff, ty rules), package skeleton, `cli.py --help`, `http.py` cache; add Python hooks to prek | `generator/` | `cd generator && uv sync && uv run ruff check && uv run ty check && uv run pytest -q` |
| 5 | CIFP: `cifp/{cycle,records,sid}.py`; check in the 210 KSFO SID lines as fixture; tests incl. hypothesis properties | `generator/src/craft_generator/cifp/`, tests | `uv run pytest -q tests/test_cycle.py tests/test_records.py tests/test_sid.py` |
| 6 | charts: `charts_api.py`, PDF download, `chart_text.py`; capture 12 text snapshots; tests incl. shuffled-lines case | `charts_api.py`, `chart_text.py`, fixtures | `uv run pytest -q tests/test_chart_text.py` |
| 7 | SOP transcription: author `sop.yaml`, `overrides.yaml`, `routes.yaml` (≥3 routes per exit fix); `sop/{model,load,verify}.py`; tests | `generator/airports/ksfo/`, `sop/`, tests | `uv run craft-gen verify-sop --airport KSFO && uv run pytest -q tests/test_sop_load.py tests/test_sop_verify.py` |
| 8 | aircraft classes from vNAS; tests | `aircraft_classes.py`, tests | `uv run pytest -q tests/test_aircraft_classes.py` |
| 9 | merge + emit + integrity checks; commit first `data/ksfo.json`; golden offline test | `merge.py`, `emit.py`, `cli.py`, `data/ksfo.json`, tests | `uv run craft-gen build --airport KSFO --check && uv run pytest -q` |
| 10 | rules engine core + table-driven tests + exhaustive enumeration test (config × runway × class × rnav × gate fix × time); fix exposed gaps in YAML, regenerate | `web/src/rules/*`, maybe `sop.yaml` + `data/ksfo.json` | `pnpm -C web test` |
| 11 | synthetic fixtures, one per SOP row + edge cases (`pending` where phraseology is open) + `fixtures.test.ts` | `fixtures/ksfo/synthetic/`, `web/src/rules/fixtures.test.ts` | `pnpm -C web test -- fixtures` |
| 12 | `options.ts`, `grade.ts`, `speak.ts` + tests | `web/src/rules/` | `pnpm -C web test` |
| 13 | scenario generator `rng.ts`, `generate.ts` + tests | `web/src/scenario/` | `pnpm -C web test -- scenario` |
| 14 | UI: load, app state, strip, ATIS panel, dependent dropdowns, results with citations and spoken reveal, seed in URL hash, styles | `web/src/ui/`, `main.ts`, `index.html` | `pnpm -C web build && pnpm -C web lint` + manual smoke via `pnpm -C web preview` |
| 15 | CI (`ci.yml`: lint/typecheck/test both halves + `craft-gen build --offline --check`) and Pages deploy (`pages.yml`), pinned SHAs, `zizmor` clean; finalize README, ARCHITECTURE, CLAUDE.md | `.github/`, docs | `zizmor .github/workflows` then `gh run watch` after first push |
| 16 | worksheet ingestion: `generator` subcommand `import-worksheets` fetches the seven Google Docs as text (`export?format=txt`), parses both sheet shapes, writes `fixtures/ksfo/worksheets/*.json` with `status: pending` and no `expected` yet | `generator/src/craft_generator/worksheets.py`, `fixtures/ksfo/worksheets/`, tests with the exported text as fixtures | `uv run craft-gen import-worksheets --airport KSFO && uv run pytest -q tests/test_worksheets.py` |
| 17 | validation loop, clearance mode: a `pnpm -C web propose <fixture-id>` script prints the engine's clearance with citations for one worksheet plan; the user confirms or corrects in chat, corrections go into YAML, regenerate, fixture gets `expected` and `settled`. One at a time until the user calls it solid, then the script emits a batch review table for the remaining plans | `web/scripts/propose.ts`, `generator/airports/ksfo/*.yaml`, `data/ksfo.json`, fixtures | `pnpm -C web test -- fixtures` green with zero `pending` phraseology fixtures |
| 18 | TEC routes + LOA altitude/route rules (ZOA–ZSE even-altitude rule first; ZLA, ZLC as the worksheet destinations require) + equipment suffix table + destination coordinates and ARTCC + fleet ceilings in YAML; merge/emit/schema extended | `generator/airports/ksfo/{tec,loa}.yaml`, `routes.yaml`, `merge.py`, `web/src/data/schema.ts`, `data/ksfo.json` | `uv run craft-gen build --airport KSFO --check && pnpm -C web test` |
| 19 | amendment engine: `web/src/rules/amend/{route,altitude,type,engine}.ts` + table tests + fixture runner for amendment sheets | `web/src/rules/amend/` | `pnpm -C web test -- amend` |
| 20 | amendment scenario generator (fault injection) + amendment UI (editable strip, per-box grading) + mode switch | `web/src/scenario/amend.ts`, `web/src/ui/amendForm.ts`, `app.ts` | `pnpm -C web build && pnpm -C web lint && pnpm -C web test` |
| 21 | validation loop, amendment mode: same one-at-a-time then batch protocol as step 17 over the 52 amendment rows | fixtures, YAML, `data/ksfo.json` | `pnpm -C web test -- fixtures` green, zero `pending` |

Step 16 can run any time after step 3 (it only needs the fixture schema). Steps 17 and 21 are interactive with the user and are the only steps that cannot be dispatched to an implementer unattended. Steps 18–20 depend on 9–13.

## Open questions to settle from the worksheets (encoded as data toggles, not code)

1. Does the SOP interim-altitude table override a published top altitude ("3,000 or CVS x 3,000" for SEGUL/WESLA off 28 implies yes; TRUKN2 jets off 01 with FL190 top and "10,000 or CVS x 10,000" is the ambiguous case)? → `altitudeRules[].whenTopAltitudePublished`
2. Is "expect (filed altitude) 10 minutes after departure" spoken when the chart publishes it and on plain "climb via SID"? → `phraseology.expectAltitude`
3. GAPP7: "radar vectors (fix)" or "(fix) transition" for its CIFP vector transitions? → `sids[GAPP7].routePhrasing`, `phraseology.vectorHybridTransitionsSpoken`
4. Which runways depart in `28 RT`, `28 SO`, `19/10`? → `runwayConfigs[].departureRunways`
5. Filed routes whose first token is an airway or a non-gate fix → parser rule or `Unresolved`
6. Amendment sheets: when both the type suffix and the route could be "the wrong box" (e.g. `E135` with no
   suffix on `WESLA4 NTELL Q158`), which box did the author intend? → recorded per fixture during the
   one-at-a-time validation
7. TEC altitude caps (`100/`, `060`) and whether the tool's `(1)`/`(28)` runway tags mean "only from that
   runway family" → confirmed against the reference tool during step 18

## Risks

- AIRAC drift bumps SID versions and may change chart text layout: fixtures compare by SID family, integrity checks fail loudly, chart-text snapshots make regressions visible in the diff.
- SFO5 has no CIFP body: its runways, spoken name, and first fixes are override and route-library data.
- Chart value may land on a different line than its label: `TOP ALTITUDE` regex accepts same or adjacent line; tests include a shuffled-lines case.
- GitHub Pages base path must equal the repo name (`/craft-tester/`).

## Verification

- Generator: `cd generator && uv run ruff check && uv run ty check && uv run pytest -q`, then `uv run craft-gen build --airport KSFO --check` produces a byte-identical `data/ksfo.json` twice.
- Web: `pnpm -C web lint && pnpm -C web typecheck && pnpm -C web test && pnpm -C web build`; the exhaustive engine test proves every reachable scenario resolves with citations; fixture runner is green with the open items reported as pending.
- End to end: `pnpm -C web preview`, open the app via Claude in Chrome, play several seeded scenarios (a TRUKN2 jet off 01R in 28/01, a MOLEN9 oceanic jet off 28L, an SFO5 prop off 01L, a NIITE4 night departure), confirm the grading colors, citations, and spoken clearance match the expected fixtures.
- Amendment mode: `pnpm -C web test -- amend` covers every check with a positive and a negative case; fault-injection generator seeds 0..999 each produce exactly the injected amendment.
- Validation loop: for each worksheet plan, `pnpm -C web propose <id>` output is shown to the user one at a time; a corrected rule must make the fixture pass without editing engine code (YAML + regenerate only), otherwise the plan gets a new rule concept and a subplan.
- After worksheets are ingested: all 18 phraseology and 52 amendment fixtures `settled` and passing.
