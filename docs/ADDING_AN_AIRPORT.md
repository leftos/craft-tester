# Adding an airport

How the KSFO data was built, written as the procedure to repeat for the next airport. An airport is a
directory `generator/airports/<icao>/` of hand-transcribed YAML plus one line in `data/airports.json`. No
code in either half is keyed on KSFO; if adding an airport needs a code change, the change is a new rule
concept and goes through `docs/plans/MAIN.md` first.

Read `docs/ARCHITECTURE.md` for the pipeline and `CLAUDE.md` for the rules of the repo. The field-level
contract is `web/src/data/schema.ts`; the loaders in `generator/src/craft_generator/sop/load.py` enforce it
on the YAML side with named errors, so the fastest way to learn a file's shape is to copy the KSFO file,
edit, and run the build.

## 0. Before starting

Confirm every source exists for the airport. Each one below was needed for KSFO; a missing one is a
plan question, not something to work around in code.

| source | check | KSFO example |
|---|---|---|
| ZOA charts API | `https://charts-api.oakartcc.org/v1/charts?apt=<FAA>` returns entries with `chart_code == "DP"` | 12 DP charts for `SFO` |
| FAA CIFP | the airport has `PD` (SID) records and a `PA` (airport) record | 210 SID rows, one airport row |
| ATCT SOP PDF | a stable URL on oakartcc.org; the departure section has a DP-by-direction table and an interim-altitude table | SOP v1.11, sections 1-7, 2-2, 2-4 |
| training material | the position's CBT deck and any published clearance worksheets | S1-SFO-0 CBT (Google Slides), seven S1-SFO-1 worksheets (Google Docs) |
| TEC/ADR routes | `https://reference.oakartcc.org/routes?dep=<FAA>&dest=<FAA>` for each NCT destination | 49 rows transcribed |
| LOAs | the center LOAs that constrain altitude or routing for the destinations the routes reach | ZOA–ZSE |
| operational notices | anything currently turning a SID off or forcing a heading | SEGUL SID off |

The FAA code is the ICAO code without the leading `K`; the CLI derives it, so `--airport KOAK` reads
`generator/airports/koak/` and asks the charts API for `OAK`.

## 1. Pull the raw material into the cache

```sh
cd generator
uv run craft-gen fetch-charts --airport <ICAO>       # cache/charts/<FAA>.json, cache/pdfs/<cycle>/*.PDF
uv run craft-gen fetch-cifp --airport <ICAO>         # cache/cifp/<cycle>/FAACIFP18
```

The cache is `generator/cache/` (gitignored) or `$CRAFT_GEN_CACHE`. Download the SOP PDF by hand into
the cache as well; `verify-sop` names the path it expects once `sop.yaml` has a `source.url`.

Get the SOP text for transcription with pypdf into `.tmp/` (never `/tmp`). Tables flatten to one cell per
line; the text is for reading, not parsing. The chart PDFs are parsed by the build itself
(`chart_text.py`): top altitude, transitions, departure frequencies with sector tags, RNAV flag. Chart text
comes out as a bag of lines in scrambled order, with a box's value on the line before or after its label.

Skim the SID records before writing any YAML. For KSFO this is how the four SID kinds were discovered:

| kind | how it shows | KSFO |
|---|---|---|
| `rnav_pilot_nav` | route types 4/5/6 | most SIDs |
| `conventional_pilot_nav` | route types 1/2/3 | MOLEN9 |
| `vector_hybrid` | route types T/V, transitions not on the chart | GAPP7 |
| `radar_vectors` | **no CIFP records at all** | SFO5 |

A radar-vector SID gets every fact from `overrides.yaml`. A vector-hybrid SID has CIFP "transitions" the
chart never names; decide with the trainers whether they are spoken as transitions.

## 2. `sop.yaml`: transcribe the SOP

Start from `generator/airports/ksfo/sop.yaml`; the comments in it say which SOP section each block came
from. Every rule row has `id`, `source`, `text` because the game cites the row, so copy the SOP wording
into `text` and the section into `source`. Quote any YAML string containing a colon, or `check-yaml` in
the hooks rejects the file.

1. **`source`**: title, version, URL, `sha256` of the PDF (`Get-FileHash` on the cached copy), the date, and
   four or five **sentinels**: short strings that pin the transcription (the version string, a section
   heading, a table cell such as `3,000 or CVS x 3,000`, a sentence a rule row depends on). `verify-sop`
   fails when the hash changes and a sentinel disappears; `--allow-sop-drift` downgrades a hash-only
   change to a warning. When it fails, re-read the changed section, fix the rows, then update the hash.
2. **`secondary_sources`**: the CBT deck and anything else rows cite. Record its date. Where it and the SOP
   disagree, the SOP wins, and the row cites both. The KSFO CBT was three years older than the SOP and
   still described a SID that no longer exists; that is why the date matters.
3. **`airport`**: `icao`, `faa`, spoken name, clearance delivery frequency. Coordinates come from CIFP.
4. **`runways`**: every runway the CIFP `PG` records list; the build rejects a runway CIFP does not know.
5. **`runway_configs`**: one per configuration in the SOP, with the plan (`SFOW`/`SFOE`, the SOP's flow
   name), arrival runways, and departure runways with the aircraft classes allowed on each and a `note`
   for conditional ones (KSFO: heavies on 28L/R in 28/01 for performance). The config `id` is what
   worksheets and ATIS scenarios name, so use the SOP's own labels (`28/01`, `28 RT`).
6. **`departure_sectors`**: id, name, frequency, from the ZOA positions list and the chart's DEP CON boxes.
   **`departure_staffing_fallbacks`**: the combined-sector frequencies from the CBT (not used by the engine
   yet; recorded so the data exists when a staffing scenario is added).
7. **`direction_runway_preference`**: plan → direction → runway family → runway. This encodes the "which
   parallel runway" convention (KSFO: right turn 1R, left turn 1L) that no SOP table states outright; the
   CBT had it.
8. **`frequencies`**: the distractor pool for the frequency dropdown: clearance, ground, tower, every
   departure sector nearby, center.
9. **`gates`**: exit fix → SOP direction (`north`/`south`/`oceanic`). Seed it with every CIFP transition
   fix, then add the navaids and fixes filed after radar-vector and vector SIDs, taken from the worksheets
   and the route tool. Every fix in a route library `tail`'s first token must be in exactly one gate; the
   build fails otherwise. Expect to extend this list during validation.
10. **`no_sid`**: which runway families may depart without a DP and how it is phrased (CBT).
11. **`noise_windows`**: local-time windows with `sunday_end` where the SOP differs on Sundays.
12. **`assignment_rules`**: the DP-by-direction table as ordered rows. Noise rows first, then the SOP
    table top to bottom, then CBT refinements. Fields: `plan`, `direction`, `runway_families`, `classes`,
    `sid_family` (or `null` plus `non_dp_heading` for a heading-only row), `sector`, and `when` with any
    of `configs`, `not_configs`, `noise_window`, `rnav`, `exit_fixes`, `forced_transition`. The engine takes
    the first row whose conditions match **and** whose SID is compatible with the runway, the aircraft's
    RNAV capability, and the filed exit fix; write rows so a fall-through exists for every combination
    (the exhaustive engine test enumerates them and reports what is unreachable). A lesson from KSFO: do
    not add `rnav: false` gates on the fallback rows; the worksheets clear RNAV-capable heavies on the
    radar-vector SID too.
13. **`altitude_rules`**: the interim-altitude table, ordered, with `sid_families` where the SOP names
    SIDs. `when_top_altitude_published: climb_via` means the row applies only when the chart publishes no
    top altitude (the SOP's "when no TOC is published" wording; confirmed against the CBT). Set
    `expect_after_minutes` from the SOP.
14. **`notices`**: current operational notices that turn a SID off (`effect: {kind: sid_off}`), with
    `default_active`. The engine skips assignment rows for an off SID; scenarios drill both states.
15. **`phraseology`** toggles and **`phraseology_rules`**: copy the KSFO block verbatim. These are FAA JO
    7110.65 4-3-2 citations and are national; change the toggles only when the airport's trainers
    disagree with a default, during validation.

Prove it: `uv run craft-gen verify-sop --airport <ICAO>` passes and the loader accepts the file (the build
in step 6 reports loader errors by field).

## 3. `overrides.yaml`: per-SID facts the sources lack

One entry per chart name the charts API returns; the build lists the names it is missing. Each needs
`cifp_id` (the ARINC 424 procedure id, which the chart name does not carry) and `spoken`. Add:

- `kind` when CIFP cannot tell (`radar_vectors`, `vector_hybrid`).
- `runways`, `top_altitude`, `has_crossing_restrictions` for a radar-vector SID (nothing else supplies
  them) and where the SOP or CBT narrows the runways below what CIFP codes (KSFO: SSTIK 1L only, TRUKN 1R
  only off the 01s, because of turn direction).
- `crossing_restrictions_by_runway_family` when one runway's version of the SID has a restriction and
  another's does not (SFO5: the 01 side has a DME crossing, the 28 side does not), because that decides
  "climb via SID except maintain" versus "maintain".
- `route_phrasing` and `transitions_spoken_as_transition` for vector SIDs.
- `note` with the reasoning and the source, every time.

`fix_spoken` maps navaid identifiers to their spoken names; pronounceable five-letter fixes need no entry.

## 4. `routes.yaml`: the scenario library

Scenarios are drawn from this file, so its breadth is the game's variety.

- **`destinations`**: `icao`, `spoken`, `artcc` (the center, for LOA rules), `nct: true` for destinations
  inside contiguous NCT (TEC routes are obligatory only there; Reno and its satellites are not contiguous
  and stay `nct: false`), and `lat`/`lon` only for airports outside the CIFP (foreign). The build fills US
  coordinates from CIFP `PA` records and fails on a destination it cannot place.
- **`telephony`**: airline code → spoken callsign for the reveal.
- **`fleet`**: type, class (checked against vNAS `AircraftSpecs.json` EngineType; the build fails on a
  disagreement), wake category, service ceiling (for the "too high for type" amendment), equipment
  suffixes it files, airlines that fly it. Use the ICAO type designators pilots actually file; worksheets
  file `A32N`, which is `A20N` in vNAS, and that alias is still an open item.
- **`routes`**: keyed by `exit_fix` (where the aircraft leaves the SID), with the `tail` from that fix,
  the classes that fly it and plausible cruise altitudes. Take them from the worksheets and the route tool.
  Aim for at least one route per gate fix; the build warns on gate fixes no route reaches, and those fixes
  never appear in a scenario. KSFO shipped with 40 such warnings.

## 5. `tec.yaml` and `loa.yaml` (optional files)

Both are optional; a directory without them builds with empty tables.

**`tec.yaml`**: transcribe the route tool by hand (it is a Blazor app with no JSON API; wait a few seconds
for it to render before reading). One row per printed line: `destination`, `plan`, `classes`,
`runway_families` (`(1)`/`(28)` tags on the tool; empty means every departure runway of the plan), `route`
with the SID written as `FAMILY#` so an AIRAC bump does not stale it, `altitude_cap_feet` from the
trailing hundreds-of-feet figure, and `kind: adr` for assigned departure routes, which are advisory.
Every destination must exist in `routes.yaml`; the build also checks that the DP a row begins on is
published for a runway family the row departs from.

**`loa.yaml`**: `sources` (title, effective date, URL) and `rules`, each scoped by `artcc` and/or
`destinations`, with `rule.kind` one of `parity_rotated`, `even`, `odd`, `max`, `route`. Transcribe the
LOA text into `text`, not a paraphrase: the ZOA–ZSE rule the user remembered as "even altitudes" is in
the LOA a rotated course window, and the row carries the LOA's version.

## 6. Build, fix, commit

```sh
uv run craft-gen build --airport <ICAO>            # writes data/<icao>.json
uv run craft-gen build --airport <ICAO> --check    # must print "unchanged"
```

Integrity failures stop the build with the offending id and the fix. Work through them in order:
missing override entries, DP families no procedure has, exit fixes in no gate, runways CIFP does not list,
fleet types vNAS cannot class, destinations CIFP cannot place, TEC rows on an unpublished DP. Warnings
(SIDs no rule issues, gate fixes no route reaches) are allowed but list them in the plan.

Then:

1. Add `{ "icao": "<ICAO>", "file": "<icao>.json" }` to `data/airports.json`.
2. Run `pnpm -C web test`. The web suite validates every file in the index against the schema.
3. Extend the web tests that are hard-wired to `@data/ksfo.json` (the exhaustive engine enumeration and
   the schema index test) to loop over the index, so the new airport gets the same coverage.
4. If any chart parsed differently from the KSFO charts, check its pypdf text into
   `generator/tests/fixtures/chart_text/` with a test, so the regex change is pinned.
5. Commit `data/<icao>.json` with the YAML. CI runs `build --check` against it.

## 7. Worksheets and validation

1. `worksheets.yaml`: one row per trainer worksheet with the Google Doc id, `kind` (`phraseology` or
   `amendment`), the runway config the sheet declares, and which reading it drills.
2. `uv run craft-gen import-worksheets --airport <ICAO>` writes `fixtures/<icao>/worksheets/*.json` with
   `status: pending` and no `expected`. Expect stale SID versions (valid distractors), typos, and
   truncated rows in the source; record them in the plan rather than editing the fixtures.
3. Validation loop: `pnpm -C web propose <fixture-id>` prints the engine's clearance with citations. Go
   one fixture at a time with the trainer or trainee who owns the airport. A correction is a YAML edit
   plus a rebuild, never an engine edit; if it cannot be expressed as data, add the rule concept to the
   plan. When confidence is high, switch to the batch table for the rest. Each confirmed fixture gains
   `expected` and flips to `settled`.

## Lessons from KSFO worth carrying over

- The CBT was outdated (it described a retired SID). Date every secondary source and let the SOP win.
- The SOP's interim-altitude table applies only when the chart publishes no top altitude; a published top
  altitude means "climb via SID" (FAA Climb Via FAQ, P/CG TOP ALTITUDE, 7110.65 4-5-7). Do not encode the
  table as unconditional.
- `climbViaEligible` is computed, not transcribed: crossing restrictions **or** a published top altitude,
  and never for radar-vector or vector-hybrid SIDs. A SID with a published top and no restrictions
  (SNTNA2) is still climb-via.
- Only TEC routes are obligatory, and only within contiguous NCT. AAR/ADR routes are advisory.
- Operational notices arrive as chat messages, not documents. Record them as `notices` rows with the date
  and who relayed them.
- Some SOP rows are unreachable as written (KSFO: the late-night southbound NIITE row names a transition
  the SID does not have). Keep the row, cite it, and put the question in the plan for the trainers.
- Radar-vector fixes filed after a SID (RBL, SAC, OAK, SGD, EUGEN) have no CIFP transition to derive a
  direction from; they are hand-assigned to gates and the list grows during validation.
