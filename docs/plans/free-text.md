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
   reading or a variant listed as data. Anything else is wrong.
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
    is required** (user steer 2026-09-17), so "nine" in its place is dinged. The steer said "ding", not
    which tier; it is recorded here as **acceptable**, the tier the user chose for filler, until step 3
    is briefed.

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
- [ ] 3. **Matcher and grader, clearance mode.** This step includes:
  - segmentation, the order rule and the per-element verdicts;
  - new shared phraseology rows for decisions 1, 2, 4, 5 and 10;
  - the variants table as shared YAML, with its schema and generator loader;
  - a kind on `redundantExpect`, which today carries none, so the acceptable expect wording cannot be
    rebuilt
- [ ] 4. **Results view**: said against expected per element, with the filler highlighted
- [ ] 5. **UI**:
  - the input-kind switch in both modes and the text box;
  - the `i=text` hash part;
  - `Attempt` and revisit storing text;
  - in amendment mode, the spoken procedure in place of the `R.sid` pick
- [ ] 6. **Docs and browser check**: a "Free-text grading" section in ARCHITECTURE.md, and
  `check:browser` on phone and desktop in both modes

## Open points, settled when the step that needs them is briefed

- [ ] "Ten thousand", the group form. 7110.65 2-4-17 b 2 (a) note allows it "for added clarity", as a
  restatement. Is it right, or acceptable, when the digit form is not said? The normaliser records the
  form (`group`); the verdict is step 3's
- [ ] The first rows of the variants table: which wordings are equivalent (right) rather than filler
  (acceptable). (step 3)
- [ ] The tier for "nine" in place of "niner", recorded as acceptable above, and **whether it applies to a
  procedure's number**: the data speaks KOAK's COAST9 as "Coast Nine" (its chart name), so the engine's
  own reading of it sets `saidNine`. (step 3)
