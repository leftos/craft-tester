# Training stages

Design for CRAFT-57: a student picks the vZOA S1 module they are working on, and New strip and new tests draw and grade only what the modules up to it have taught. Owner rulings are recorded in the CRAFT-57 description; this file holds the design they settle into. Mock of the placement (lane A approved): `docs/plans/canvases/training-stage/index.html`.

Branch: `feat/training-stage`. Depends on CRAFT-28 (the runway-grading switch), landed on `main` first.

## The stage list

One list, in course order. A thing locked "at X" is open at X and at every stage after it; "All topics" opens everything and is the default for a student who never picked a stage.

| Order | Id | Title (shown as "{id} {title}") |
|---|---|---|
| 1 | S1-OAK-1 | Clearances Introduction |
| 2 | S1-OAK-2 | Clean Clearances |
| 3 | S1-OAK-3 | Taxiing |
| 4 | S1-OAK-5 | Unclean Clearances |
| 5 | S1-OAK-6 | Miscellaneous Topics |
| 6 | S1-SFO-1 | Flight Data & Clearance SFOW |
| 7 | S1-SFO-4 | SFOE |
| 8 | All topics | (no title) |

The modules that change nothing (S1-OAK-4, S1-OAK-7, S1-OAK-P, S1-SFO-2, S1-SFO-3) are not in the list. The SFO stages come after every OAK stage, so a student on the SFO track has all of KOAK open.

## The gates

Course gates, the same at every airport (`generator/shared/training_stages.yaml`):

| Gate | Locked until | What locked means |
|---|---|---|
| runway | S1-OAK-3 | runway grading off (CRAFT-28's switch), shown locked at Not graded |
| amendment | S1-OAK-5 | Amend mode locked; draws are clearance mode |
| fullRoute | S1-OAK-5 | the Full route answer locked |
| night | S1-OAK-6 | draws are by day; Either and Night locked in the Time control |

The same file lists when an airport itself opens (`airports`: KSFO at S1-SFO-1; an airport not listed is open at every stage), so every airport's data can say which others are locked: a strip page loads only its own airport's file, and the toolbar's airport switch has to label the rest.

Airport gates (`generator/airports/{icao}/training.yaml`), each optional; anything an airport does not list opens with the airport:

| Field | KOAK | KSFO |
|---|---|---|
| `configs` (by `plan` or `id`) | plan OAKE at S1-OAK-6, plan SFOE at S1-OAK-6 | plan SFOE at S1-SFO-4 |
| `sids` (by family) | OAK, CNDEL, COAST at S1-OAK-1; NIMI, NUEVO, SKYL at S1-OAK-2 | not listed |
| `otherSids` (every family `sids` does not name) | S1-OAK-6 | not listed |
| `noSid` (a departure with no SID: a heading) | S1-OAK-6 | not listed |
| `runways` | 33 at S1-OAK-6 | not listed |

Both files are emitted into `data/{icao}.json` under `training`, and the build fails when a named SID family, configuration plan or id, or runway is not in the airport's data, or an `at` names no stage. KOAK's west configuration is the data's `SFOW` (the syllabus calls it OAKW). SID families are matched by family, never by version (the syllabus names NIMI5, NUEVO8, SKYL1; the data has NIMI7, NUEVO9, SKYL2).

The east SIDs the syllabus lists for S1-OAK-6 are covered without naming them: HUSSH, SALAD, SLNT and SUNNE fire only in KOAK's night noise windows (night gate), KATFH and QUAKE only in OAKE and SFOE (configs gate), and every family `sids` does not name opens at `otherSids`.

## How a stage applies

- **Settings are clamped, never overwritten.** The remembered settings (time, configuration, mode, answer method, runway grading, airport) stay as stored. Each control shows the nearest allowed value when the stored one is locked (Time: Day; Configuration: Any; Mode: Clearance; Answer: the abbreviated reading in the remembered input kind; Runway: Not graded; Airport: the first open airport of the index), with the locked options visible, greyed, and labelled "at {stage id}". Picking a later stage, or All topics, brings the stored value back.
- **The stage rides in the filter.** `ScenarioFilter` gains an optional `stage` (absent means All topics), so it reaches every draw path, the hash and a test set's record the way the forced destination does, and it is never saved with the remembered filter.
- **Who clamps.** New strip, a new test, a filter, mode or airport change, and a practice or test link with no `st=` part clamp the page's settings to the viewer's stage, the airport included: at a closed airport the strip or test opens at the first open one. A strip link, or a practice or test link with an `st=` part, opens as written. Under a stage, saving a filter change saves only the member the student changed, so a clamped member keeps its remembered value, and opening a strip keeps home's remembered airport or mode only while the stage locks it. With no stage, all of this is as it was.
- **The draw.** Configuration and time are filtered before the draw (`pickConfig`, `pickTime`); a configuration filter of Any means any open configuration. The SID is picked by the SOP assignment engine, so the SID, no-SID and runway gates are a check after the draw: a drawn clearance whose SID family, no-SID departure or runway is still locked is redrawn, as an amendment draw with no fault to inject is. Amend mode's wrong SIDs in a filed plan are not gated: only the cleared answer is.
- **Links open as written.** A strip link and a test set carry the stage they were drawn under as `st={stage id}` (absent for All topics), so the same seed draws the same strip for anyone who opens it. The viewer's stage governs New strip and new tests only: on a page opened from a link, New strip draws under the viewer's stage with the page's settings clamped to it. A `SetRecord` stores the stage; one without it reads as All topics.
- **Where the stage is picked.** A "Training" row first on home, above Airport; on a strip page, at the top of the Filters popover. It is remembered per browser (`craft-tester:training-stage`), not per airport.

## Worked examples

- S1-OAK-1, KOAK, SFOW by day: a B738 cleared on CNDEL is drawn; a C172 the SOP puts on NIMI is redrawn (NIMI at S1-OAK-2); a heading departure off runway 33 is redrawn (no SID and runway 33 at S1-OAK-6). The runway row is not asked; Amend and Full route are greyed "at S1-OAK-5"; Night and Either are greyed "at S1-OAK-6"; the OAKE and SFOE configurations are greyed "at S1-OAK-6"; KSFO is greyed "at S1-SFO-1".
- S1-OAK-2: the C172 on NIMI is drawn; the runway row is still not asked.
- S1-OAK-3: the runway row is asked and graded; Amend is still locked (not a non-example of "everything up to and including": Amend is at S1-OAK-5).
- S1-OAK-6: everything at KOAK is open, nights and the east configurations included; KSFO is still locked.
- S1-SFO-1: KSFO opens in 28/01, 28 RT, 28 SO and 01/01, clean and amended, by day or night; 10/10, 19/10 and 19/19 are greyed "at S1-SFO-4". KOAK is fully open.
- A student remembered Night and plan OAKE at KOAK, then picks S1-OAK-2: the Time control shows Day and the Configuration control shows Any; picking All topics shows Night and OAKE again.
- A mentor at All topics sends a strip link drawn at S1-OAK-1 (`…&st=S1-OAK-1`): the student, at S1-OAK-6, opens the same strip; their New strip draws under S1-OAK-6.

## Parts

1. CRAFT-57 part 1, the stage table in generator data: the two YAML files, the loader, the build checks, `schema.ts` and `schema:export`, rebuilt `data/koak.json` and `data/ksfo.json`, generator tests.
2. CRAFT-57 part 2, the stage in the draw, links and storage: a pure web module that answers "is this open at this stage" and clamps settings, the gates in `pickConfig`, `pickTime` and after `drawScenario`, the `st=` part, the stage store, the `SetRecord` field, and a test that every stage, airport and mode it opens draws a strip across a fixed seed range.
3. CRAFT-57 part 3, the controls: locked options in `selectControl`, `segmentedControl` and home's cards, the Training row on home and in the Filters popover, the toolbar airport switch, and a browser check on phone and desktop.
