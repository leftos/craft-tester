# Heading departures (non-DP rows)

**User decision 2026-09-16: build it now for KSFO**, not deferred to KOAK. Today an assignment row with
`sidFamily: null` and `nonDpHeading` (KSFO: `SFOW-NOISE-P-RWY`, SOP 2-4 e: noise window, runway 01,
non-RNAV props → runway heading, no DP) makes `selectSid` return unresolved, clearance mode throws the
draw away, and amendment mode cannot answer such a plan.

Sources: FAA JO 7110.65 4-3-2 c 3 phraseology "FLY RUNWAY HEADING"; 4-3-2 c 4 (a) "assign the route
filed by the pilot when a SID is not established"; OAK ATCT SOP 2-1 c phraseology as recorded in
[koak-v3.md](../koak-v3.md): "CLEARED TO (airport) AIRPORT, VIA TURN LEFT/RIGHT (heading) / FLY RUNWAY
HEADING, RADAR VECTORS (first fix/airway)…"; S1-SFO-0 CBT "No SID": departure without a SID is phrased as
radar vectors to the first filed fix (`sop.yaml` `no_sid.phrasing: radar_vectors_fix`).

## Design (assumptions stated; the user reviews the spoken form on the first proposal)

- **The heading is the procedure element, not a route shape.** `ResolvedClearance.sid` becomes
  `procedure: Cited<Procedure>` with
  `Procedure = { kind: 'sid'; id; family; spoken } | { kind: 'heading'; heading: 'runway heading'; spoken: 'fly runway heading' }`.
  The route element keeps its four shapes: a heading departure's route is `no_sid.phrasing` on the
  exit element (`radar_vectors_fix OAK`), so the student is graded on "radar vectors (fix)" as for a
  vector SID, and the procedure row (given in clearance mode, picked in amendment mode) carries the
  heading. Only `runway heading` is supported: the generator loader restricts `non_dp_heading` to that
  literal until a numbered heading (OAK's 270°) brings the turn-direction data (CIFP `PG` runway
  headings), so nothing is half-built.
- **Spoken** (**user rule 2026-09-16**: the heading is introduced by "via"): "(callsign), cleared to
  (destination) airport, via fly runway heading, radar vectors (exit element), then as filed. Maintain
  (interim). Expect (filed) (minutes) minutes after departure. Departure frequency …, squawk ….
  Expect runway …". Numbered headings, when they come with KOAK, read "via turn left heading (xxx)" /
  "via turn right heading (xxx)". The full-route form reads the route after the exit element as for
  any vector clearance.
- **Altitude**: the interim rows match with no SID family (`rowMatches` treats a heading departure as
  matching rows without `sidFamilies`); the phrase is always `maintain` (no procedure, so no crossing
  restrictions); the expect clause follows the row (`expectAfterMinutes`) and is never chart-redundant.
  KSFO: `SFOW-PT-5000` → "maintain 5,000".
- **Frequency**: the row's sector (`richmond`).
- **Runway**: unchanged (`explainRunway`).
- **Clearance mode draws them**: `drawScenario` composes the clean route with no procedure token when
  the clearance's procedure is a heading; the amendment engine then finds nothing to amend. The
  generator's "discarded rather than presented" comment goes.
- **Amendment mode**: `checkRoute` expects `[…tail]` with no procedure token for a heading clearance,
  so a plan that files a SID where the SOP says runway heading gets a route amendment (reason: "the SOP
  sends a non-RNAV prop off 01 in the noise window on runway heading with no DP", citing the row); the
  procedure dropdown gains "fly runway heading (no DP)"; `gradeProcedure` compares kind and family or
  heading.
- **Fixture schema**: `ExpectedClearance.sidFamily: z.string().nullable()` plus
  `heading: z.literal('runway heading').optional()`; `toExpectedClearance` maps the union. Existing
  fixtures are unchanged. A synthetic fixture for the C172 off 01L at 2300L filing `OAK V6 SAC` to KMYV
  settles the first proposal once the user confirms the spoken form.
- **Phraseology row** (shared): `R-HEADING`, source "FAA JO 7110.65 4-3-2 c 3; OAK ATCT SOP 2-1 c",
  text "FLY RUNWAY HEADING, RADAR VECTORS (first fix) — a departure the SOP sends off without a DP is
  cleared on the runway heading and vectored to the first filed fix; no procedure is named".
- **Propose / results / reveal**: the procedure line prints "fly runway heading (no DP)".

## Steps (after route building lands; implementer briefs)

1. [x] Landed 2026-09-16: `ResolvedClearance.procedure: Cited<Procedure>` (`sid | heading`), `SidSelection.procedure`
   (`SelectedProcedure` carries the chart record for the SID case), `selectSid` selects the heading for a
   `sidFamily: null` row (only `runway heading`; the generator loader rejects any other value),
   `resolveAltitude` keys a heading to the rows without `sidFamilies` and always says `maintain`,
   `phraseRoute` takes `noSid.phrasing`, the speaker reads "via fly runway heading", the fixture schema
   takes `sidFamily: null` + `heading`, shared row `R-HEADING`, `propose` prints "fly runway heading (no
   DP)". Left to step 2: clearance-mode draws still discard heading clearances; amendment mode reports
   the route box unresolved for one and lists no heading in the procedure dropdown. Finding: a heading
   clearance whose exit element is an airway would phrase `radar_vectors_fix` on the airway; step 2
   should use the airway shape there. Original spec: types, engine, speak, altitude, propose: the `Procedure` union, `selectSid` returning a heading
   selection for a `sidFamily: null` row (with its row and sector), `resolveAltitude` for no SID,
   `phraseRoute` on `no_sid.phrasing`, `speakClearance`, `toExpectedClearance`, `schema.ts` fixture
   change + export, the shared `R-HEADING` row + rebuild, generator literal check on `non_dp_heading`.
   Tests: the C172 case resolves and speaks as above; a jet off 01 at night is unaffected; the row with
   a value other than `runway heading` fails the loader. Proving: `pnpm -C web test rules`, generator gate.
2. [x] Landed 2026-09-16: `drawScenario` composes a heading clearance's route as the library tail with no
   procedure token (the discard is gone); `checkRoute` for a heading clearance (`checkHeadingRoute`)
   expects the filed tail, or the TEC route where one applies, and amends a filed SID down to it with
   the reason "the SOP sends a non-RNAV piston off 01L in the noise window on the runway heading with no
   departure procedure" citing the row and `R-HEADING`; the procedure dropdown ends with "fly runway
   heading (no DP)" (value `HEADING_PROCEDURE_PICK = 'runway heading'`, exported from `rules/grade.ts`
   beside the grader, while `HEADING_PROCEDURE_LABEL` stays in `rules/types.ts`); `gradeProcedure` marks
   the heading right only against a heading clearance; a heading clearance leaving on an airway takes
   `radar_vectors_airway`. Fixture `syn-heading-c172-night-kmyv` (pending) proposes "November one seven
   two sierra papa, cleared to Marysville airport, via fly runway heading, radar vectors Oakland VOR,
   then as filed. Maintain five thousand. Departure frequency one two zero point niner, squawk four six
   two zero. Expect runway one left." Findings: the night sweep yields one heading draw in 200 seeds,
   because a heading needs the 01/01 configuration (`trainingWeight` 4 of 100; props take 28R in 28/01),
   so meeting the case more often is a data question; the amendment reason hard-codes "in the noise
   window", true of the only row that can produce it today (`SFOW-NOISE-P-RWY`), and a future non-DP row
   outside a window would need the wording keyed on the row. Original spec: UI and generators: `craftForm` procedure row/dropdown, results labels, `drawScenario` composition,
   `checkRoute` and `gradeProcedure` in amendment mode, the synthetic fixture (pending until confirmed),
   `check:browser` on the C172 draw (`s=<seed>,d=KMYV` with a night time filter). Proving: full gate.
3. [x] Landed 2026-09-16. Docs: `ARCHITECTURE.md` graded-elements paragraph, `ADDING_AN_AIRPORT.md` step 12 (`non_dp_heading`
   is `runway heading` only), MAIN.md.

Left open: the user confirms the spoken form above, then the fixture is settled. Numbered headings
("via turn left/right heading (xxx)") come with KOAK's data ([koak-v3.md](../koak-v3.md)).
