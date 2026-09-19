# Plan record, 2026-09-17 → 2026-09-18

The landed entries of [MAIN.md](../MAIN.md) as they stood when the 2026-09-18 hygiene pass shortened them
(index at `1c4837d`). Design and rationale live in [ARCHITECTURE.md](../../ARCHITECTURE.md) ("Free-text
grading", "TEC routes", "Amendment mode"); the subplans named below sit beside this file.

- [x] v2: free-text clearance entry — the student types the whole clearance as an alternative to the
  dropdowns, graded element by element with what was said, filler marked; the header's "answer" switch is
  remembered; both modes — 2026-09-17 ([archive/free-text.md](./free-text.md), ARCHITECTURE.md
  "Free-text grading")
- [x] Amendment results: the score line counts the strip ("flight plan checks / amendments") and the
  clearance ("CRAFT clearance elements") apart; a route box missing the airport navaid reads `preferred:`
  and `acceptable (airport navaid)`; each box verdict reads its amendment's `why:`; the amend form's rows
  share a grid — 2026-09-17
- [x] The corrected strip and the CRAFT clearance follow the student's plan: every box graded correct as
  written, every other box as the engine corrected it (`studentPlan`, `clearedPlan`) — 2026-09-17
- [x] Cleanups: `selectControl` sets its value after its options; `clearedPlan` caches per view and answers — `59fe3dc`
- [x] Worksheet corrections (`corrections:` in `worksheets.yaml`); N436MS files its TEC route — `4135d64`
- [x] A TEC route overrides the SOP's departure (user rulings 1–12): the row choice from data, the sector
  per DP (SOP 2-2 a), noise and notices still winning, the draw and the importer moving a flight to its TEC
  SID's runway (`RWY-TEC`), on-request draws matching the importer, and `--overwrite-settled` downgrading
  only changed fixtures — `5e46ff8`, `e7333d2`, `e7b6245`
  ([archive/tec-override.md](./tec-override.md), ARCHITECTURE.md "TEC routes")
- [x] Radar vectors direct and `RH`/`RV`/`Hnnn` in TEC routes: KOAK's `RH RV` rows to KSFO and its Hayward
  rows, SFO and HWD as north-gate stand-ins (Richmond), and a TEC row grammar in the build that replaces the
  "rows that name no fix" guard — `210fad9`
- [x] Tester feedback, AJ Norell: a near-miss spelling is the word (`S-SPELLING`: one edit for five to
  eight letters, two beyond, none below; a real word of the reading, the lexicon or a row is read as typed;
  numbers stay exact), a typed row's `expected:` marks the words never said, the flight-plan panel is pinned
  at every width, and `check:browser` takes `scroll:<px>` with a viewport shot — `93d164f`
- [x] A typed clearance without its expect clause keeps its F: among the alignments with the most matches
  the one with the most adjacent matches wins, so "Departure frequency" stays whole instead of lending
  "Departure" to "…after departure" (found while checking AJ's feedback; failing tests first) — `8fdd6f0`
- [x] A results row says what was wrong (user steer on AJ's feedback): a typed row marks wrong, misplaced and
  near-miss words in `you said:` and names the kind of miss in a remark line; a dropdown row marks the words
  that differ between the pick and the clearance; strip boxes unchanged. The remark labels are matcher
  constants, not YAML rows (they name what the matcher saw; the deciding rule is still cited) — `ae2218d`
- [x] Typed names (user reports, 2026-09-18; [archive/typed-names.md](./typed-names.md)): a typed
  identifier reads the same in any case (`nimi6`, `kmcc oak6`) — `b3d2405`; a destination carries its full
  FAA name (read in the clearance), a `short` name (kept by the amendment reasons, so no settled reason
  moved) and `also` names, and a typed clearance may say any of them as the name itself ("Sacramento
  Metro") — `17c68b7`, `7763420`; a number typed in pieces is one number where the pieces spell a number
  the reading says ("squawk 00 six two") — `7763420`; "radar vectors to join Victor six airway"
  (`R-RV-AIRWAY`), and a navaid or five-letter fix spelt in the phonetic alphabet is fully right
  (`R-NAVAID`, 7110.65 2-5-2 a 1) — `4cc29fe`
