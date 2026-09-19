# Full route clearance mode

AJ Norell asked for it 2026-09-18 and the user agreed: "I should have a proper full route clearance mode",
then defined it the same day: "the same as our current clearances, but with a checkbox so that the student
can require themselves to be graded on the full route clearance."

## Rulings (user, 2026-09-18)

1. **Typed answers only.** The dropdown form's route element is one transition-fix pick
   (`rules/options.ts`), so it cannot hold a full route; only the typed grader knows a full reading. The
   checkbox sits beside the answer switch; ticking it while on dropdowns flips the answer to typed.
2. **With the box ticked a "then as filed" reading is wrong**, cited to a new national row. `R-FULL-ROUTE`
   and `R-THEN-AS-FILED-END` keep their meaning with the box off.
3. **Both modes.** In amendment mode the amended route is read to its end in place of the
   `R-THEN-AS-FILED` join.
4. **The strip shows `FRC` as the first remark** while the box is ticked (7110.65 4-3-3 b).

Orchestrator decisions, stated to the user and not objected to: the choice is remembered per browser and
carried in the link, as `i=text` is; selecting Dropdowns unticks the box, so no hidden state survives.

## The citation

The plan item guessed 4-3-2; both paragraphs are in **4-3-3, Abbreviated Departure Clearance**
(`docs/refs/7110.65/chap04_sec03.md:273` and `:333-334`; letters confirmed in `7110.65BB.txt:9964`, `:10029`):

- 4-3-3 b: "When 'FRC' or 'FRC/(fix)' appears on a flight progress strip, the controller issuing the ATC
  clearance to the aircraft must issue a full route clearance to the specified fix, or, if no fix is
  specified, for the entire route."
- 4-3-3 g 1: "When a filed route will require revisions, the controller … must either: 1. Issue a FRC/FRC
  until a fix."

The row, after `R-FULL-ROUTE` in `generator/shared/phraseology_rules.yaml`:

```yaml
  - id: R-FRC
    source: "FAA JO 7110.65 4-3-3 b and 4-3-3 g 1; user ruling 2026-09-18 (full route clearance mode)"
    text: "FRC as the first remark on the strip means a full route clearance is necessary: with no fix named the controller reads the entire route, element by element to its end, and THEN AS FILED is not spoken. A reading that hands any part of the route over as filed is wrong"
```

"FRC until a fix" (`FRC/(fix)`) is out: the user ruled the shortened reading wrong, and nothing draws a fix.

## Design

- **The grader takes the reading it is held to.** `gradeText` gains a required fifth parameter,
  `routeReading: 'abbreviated' | 'full'` (exported type `RouteReading`). `speak.ts` is untouched: a
  `SpokenClearance` already carries both readings. Under `'full'`, where the two readings differ, the full
  reading is the first candidate (ties go to it) and is fully right with no remark; the abbreviated one still
  competes so the miss is recognised, and winning it grades `R.route` wrong, cites `R-FRC`, and leaves the
  remark `"then as filed" said on a full route clearance — read the route to its end`. Where the readings
  are the same, the reading closed on "then as filed" (`end`) grades the same way instead of acceptable.
  The row's `expected:` is the full route in every case.
- **One flag in the settings.** `SessionSettings.fullRoute`, hash part `r=full` written after `i=text`; a
  hash carrying `r=full` opens typed. Preference key `craft-tester:full-route`. A full-route attempt is
  remembered under its own solved key (scope `:text:frc`), since the same typed text grades differently.
- **The strip** prepends `FRC` to whatever remarks the flight filed (`FRC REQ RWY 28`), on every strip drawn
  while the box is ticked, without touching the scenario.
- **The reveal** shows one box, the full reading, under "On frequency"; read-aloud speaks that.
- **`check:browser`** learns `check:<label>`, which ticks the checkbox of that accessible name.

## Steps

Brief 1 — the row and the grader (`generator/shared/`, `generator/tests/test_sop_load.py`, `data/*.json`,
`web/src/rules/text/grade.ts` and its test, the two call sites passing `'abbreviated'`):

- [ ] 1. `R-FRC` in `phraseology_rules.yaml`, `SHARED_PHRASEOLOGY_IDS`, both airports rebuilt
- [ ] 2. `gradeText(…, routeReading)`, the candidates, tiers, remark and `expected:` under `'full'`

Brief 2 — the switch (`scenario/filter.ts`, `ui/state.ts`, `ui/preferences.ts`, `ui/solved.ts`, `ui/dom.ts`,
`ui/app.ts`, `ui/amendPanels.ts`, `ui/strip.ts`, `ui/results.ts`, `scripts/browser-check.ts`):

- [ ] 3. The setting, the hash part, the preference, the solved key
- [ ] 4. The header checkbox, wired to both graders
- [ ] 5. `FRC` on the strip; the reveal's single box
- [ ] 6. `check:<label>` in the browser check, then a phone and a desktop run in both modes

Orchestrator after brief 2: ARCHITECTURE.md "Free-text grading" and the `ui/` row, CLAUDE.md's
`check:browser` paragraph (`check:` and `r=full`), MAIN.md, this file to `archive/`.
