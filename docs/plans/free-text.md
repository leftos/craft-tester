# Free-text clearance entry

Wave 1 of [MAIN.md](./MAIN.md). The student types the whole spoken clearance as an **alternative to** the
dropdowns (user 2026-09-17: "the dropdowns stay and the student chooses"), so they practise without the
dropdowns' hints. The grader normalises both sides, aligns the text against the CRAFT elements of the
engine's reading, and grades each element green or red with its citation, next to a per-element diff of
what was said against what was expected.

## Decisions (user 2026-09-17)

1. **"Then as filed" where the route is read to the end is acceptable.** Where nothing follows the exit
   fix, the engine closes the route on "direct" (`TRUKN2 TRUKN` reads "Trukn Two departure, Trukn, direct.").
   A student who says "Trukn, then as filed" instead is credited acceptable, citing a new phraseology row.
2. **The full route read where the abbreviated form would do is acceptable**: it is longer than it needs
   to be, which is what `acceptable` already means (`A-EXPECT-REDUNDANT`, `A-FINAL`). It cites a new row.
3. **Strictness: values plus known variants.** An element is right when its values (fixes, airways,
   procedure, altitude, minutes, frequency, squawk, runway) are in place and its fixed words match the
   reading or a ruled variant (decision 12). Anything else is wrong.
4. **Filler words make an element acceptable, not wrong.** Examples: "climb via *the* SID", "cleared to
   *the* Seattle airport", "*your* departure frequency *will be* 120.9". The diff highlights the filler.
   A missing required word is still wrong.
5. **An element read out of CRAFT order is wrong.**
6. **The callsign is optional and not graded**: matched and skipped where it is there.
7. **C and T are graded too.** The clearance limit and the squawk are given in the dropdown form but can
   be left out of typed text, so text mode scores more elements than dropdown mode.
8. **Amendment mode is in the first cut.** The text box replaces the CRAFT form under the strip boxes, and
   the spoken procedure takes the place of the graded `R.sid` pick.
9. **Dictation is out of the first cut.** It has its own line in MAIN.md Singles.
10. **ICAO number pronunciations are accepted without a ding.** "Tree", "fife", "fower" and the rest of
    7110.65 2-4-16 TBL 2-4-1 read as the same digit as the plain word. **The exception is "niner", which
    is required**: "nine" said for a digit is **wrong** (user 2026-09-17). **A procedure's name is
    exempt**, because it is spoken as its chart name: "Coast Nine" and "Coast Niner" are both right.
11. **Group form only as a restatement** (user 2026-09-17, on 7110.65 2-4-17 b 2 (a)). A number the
    reading speaks digit by digit is right only in digit form ("one zero thousand"). The digits followed by
    their group form ("one zero ten thousand", "one zero thousand ten thousand") are acceptable but
    inefficient. The group form alone ("ten thousand") is wrong. Typed figures ("10,000") are right,
    because a typed number says nothing about how it would be spoken. Numbers the reading speaks in group
    form (airways, the callsign) take any form.
12. **One variant is fully correct: the facility word on a bare fix** ("Concord VOR, then as filed" where
    R-AS-FILED reads "Concord"). "Climb and maintain" and "radar vectors *to* (fix)" are filler. "Runway
    one right" without "expect" is missing a required word, so it is wrong (user 2026-09-17). With one
    variant, and that one a rule about fixes rather than a string swap, **no variants table is built**.
    The variant is a phraseology row the matcher cites. A table can come later if a second string-level
    variant is ruled.
13. **The input-kind switch sits in the header beside the mode switch and is remembered** (user
    2026-09-17): switching keeps the seed, new draws keep it (`i=text`), and a fresh visit restores it the
    way the filters are restored.
14. **A typed result row shows what was said for that element on every row, and the expected words only
    where the element is not fully correct** (user 2026-09-17). Filler is marked inside the said line,
    muted with a dotted underline.
15. **Enter submits the typing box** (user 2026-09-17): it wraps over several lines, but a clearance is one
    transmission, so a newline means nothing. The Submit button works too.

## Design

The explore map of 2026-09-17 found that `speakClearance` (`rules/speak.ts`) returns two flat strings,
that no spoken reading is graded anywhere, and that no fixture pins spoken text. The only spoken-text
corpus is the engine's own output, built through `spokenFor` (`ui/session.ts`) or
`web/scripts/propose.ts`.

- **Structured reading.** `SpokenClearance` gains `parts`, the abbreviated reading as one
  `{element, words}` per element in spoken order (`callsign`, `C`, `R.sid`, `R.route`, `A.phrase`,
  `A.expect`, `F`, `T`, `RWY`). It also gains `fullRouteWords`. The flat strings are rebuilt from the
  parts by `joinSpoken` and stay byte-identical.
- **Normaliser.** Lowercase the text and drop punctuation. A run of numbers, whether figures
  (`120.9`, `10,000`, `FL320`, `1234`) or words (digit words in plain or ICAO form, "thousand",
  "hundred", "point", group forms), becomes one number token. That token records its value and how it was
  said (digit by digit, group form, figures, "nine" rather than "niner"). A fix matches by its identifier
  or its spoken name. Anything the normaliser does not recognise is kept as a plain word.
- **Segmentation.** Each element is found by its anchor words: "cleared to", "departure" or "via",
  "climb via" or "maintain", "expect … after departure" or "will be your final", "departure frequency",
  "squawk", "expect runway". The route is the stretch between the procedure and the altitude. Order is
  graded as the fewest elements out of place: the found elements are laid out in the reading's order, and
  those outside the longest in-order run are wrong.
- **Per-element verdict.**
  - Values compared first: a wrong or missing value is wrong.
  - Fixed words next, after the equivalences: a listed variant is right. Extra words are acceptable
    (filler), and so are "nine" and decisions 1 and 2. A missing element is wrong ("not heard").
  - Each verdict cites the element's own rows plus the row that decided the tier.
- **Grades and results.** Text mode grades `C`, `R.sid`, `R.route`, `A.phrase`, `A.expect`, `F`, `T` and
  `RWY`. The results view shows said-against-expected per element, with the filler marked.
- **State.** A hash part `i=text` carries the input kind. Switching kind keeps the seed, and it stays out
  of `hasFilterParams`. The `Attempt` store keeps the typed text, and a revisit re-grades from it.

## Steps

- [x] 1. **Structured reading**: `SpokenPart`, `parts`, `fullRouteWords` and `joinSpoken` in
  `rules/speak.ts`, with every existing reading byte-identical — `845d5f8`, 2026-09-17
- [x] 2. **Normaliser**: `rules/text/normalise.ts` (`normaliseSpoken`, `lexiconFor`). Text becomes
  words and number tokens that record the value and how it was said (figures, digits, group form,
  "nine"), and every settled clearance fixture's reading reads back to its squawk and frequency —
  `39a1929`, 2026-09-17. Its limits, all unexercised by the corpus: a figures piece opens a run of its own,
  so "3 thousand 5 hundred" reads as 3000 and 500; a decimal with a multiplier does not parse; `hundred`
  without `thousand` takes exactly one value before it
- [x] 3. **Matcher and grader, clearance mode** — `rules/text/grade.ts` `gradeText`, 2026-09-17 (3a
  `ed5e69f`: the seven rows, `RedundantExpect` with its kind, `speakExpect`, the restated reading, C and T
  as elements; 3b `875f11a`: the matcher). Every settled clearance fixture's own reading grades all eight
  elements correct
- [ ] 4. **Results view**: said against expected per element, with the filler highlighted. An element read
  out of order before the clearance limit shows the whole leading stretch as said, callsign included
  (`Squawk three three four two, United three twenty`); the diff should show only the element's own words
- [ ] 5. **UI**:
  - the input-kind switch in both modes and the text box;
  - the `i=text` hash part;
  - `Attempt` and revisit storing text;
  - in amendment mode, the spoken procedure in place of the `R.sid` pick
- [ ] 6. **Docs and browser check**: a "Free-text grading" section in ARCHITECTURE.md, and
  `check:browser` on phone and desktop in both modes

## Engineering calls in step 3b (not user rulings; the user may overrule any)

- **Alignment.** Elements are found by a longest-common-subsequence alignment of the typed tokens with
  the reading's tokens, over up to six candidate readings. The candidates are the base reading, the full
  route, "then as filed" at a route's end, and the redundant expect clause. The base reading wins ties.
- **Stray expect clause.** An expect clause said where the reading has none is cut out before alignment,
  so its "departure" cannot pair with F's.
- **Tier rows.** An element wrong because a word or value is missing cites only its own rows (plus
  `S-ORDER` where out of order). Tier rows (`S-FILLER`, `S-GROUP-FORM`, `S-NINER`, `R-FACILITY-WORD` and
  the candidate rows) appear only on an element whose every word matched.
- **"Nine".** "Nine" for a digit is wrong only where the reading's own number says "niner". Decision 10's
  procedure-name exemption therefore covers any number the engine itself speaks as "nine": a chart name
  (Molen Nine, Coast Nine), a STAR number, an airway group.
- **Unmatched text.** A text that matches nothing is ignored like a callsign: every element is
  "(not heard)".
- **Leading stretch.** An element said before the clearance limit is out of order, and the rest of that
  stretch is the callsign.

## Open points

None. The three raised at step 2 were ruled 2026-09-17: decisions 10, 11 and 12.
