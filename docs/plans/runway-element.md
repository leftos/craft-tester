# Expect-runway element

User steer 2026-09-15 (playtest): the ATIS panel showed the exact departure runway ("departing 28L"),
which gives away the 1L/1R split. A real ATIS in 28/01 advertises "departing runways 1L, 1R"; the
student must pick the runway. The pick is graded as a seventh element, "expect runway", with citations.
It is not part of CRAFT as the 7110.65 defines it, so it is **not** spoken in the reveal (open question
below).

## Design

- **Truth stays in the scenario.** `scenario.departureRunway` remains the runway the flight departs
  from; the generator draws it (class default → on-request draw → direction preference → first runway)
  and the worksheet importer mirrors that. The engine keeps reading it for the runway family. What is new
  is that the engine *explains* it: `explainRunway(scenario, airport, class, direction)` returns
  `Cited<string>` whose citations name the mechanism that produced the runway.
- **Mechanism rows are data.** Four rows in `sop.yaml` `phraseology_rules` (the table the engine cites
  by id, as `C-DEST` already does), ids fixed by convention:
  - `RWY-CLASS-DEFAULT`: the configuration departs this class from this runway by default (28R at Echo
    for P/T in 28/01; user review 2026-09-15, N483KA)
  - `RWY-ON-REQUEST`: SOP 2-1 e, oceanic / Far East / cargo may be issued 28L/R when 01 is advertised;
    a cargo or heavy filing a 28-only SID, or a strip remark requesting the 28s, is honoured
  - `RWY-DIRECTION`: S1-SFO-0 CBT "28/01 1L or 1R?": right turn (northbound) → 1R, left turn
    (southbound) → 1L, allowing simultaneous parallel departures; the same table splits the 28s and
    the SFOE families
  - `RWY-FIRST`: the configuration departs one runway of the family, so that is the runway
  Each `runwayConfigs[]` row gains `source` ("SFO ATCT SOP 1-7") so the configuration itself is citable
  as `{id, source, text: name}`.
- **Remarks make the request visible.** `Scenario.remarks?: string`; the generator writes
  `REQ RWY 28` (the requested family) when its on-request draw fires; the strip shows a `remarks` row
  when present. The importer writes none: a worksheet plan that gets the 28s files a 28-only SID, which
  is the implied request.
- **ATIS advertises the runways in normal use**: distinct runways of `departureRunways` rows with empty
  `onRequestFor` and empty `defaultForClasses` (28/01 → 01L, 01R; 28 SO → 28L, 28R).
- **Form**: element `RWY`, heading "expect runway", one dropdown listing every distinct runway of the
  configuration's `departureRunways` (28/01 → 01L, 01R, 28L, 28R). Graded by string equality with
  `scenario.departureRunway`; labels are the bare runway. Placed after F in the form and the results.
- **Fixtures unchanged**: `scenario.departureRunway` is already the expectation; the fixture runner and
  `ExpectedClearance` do not change.

## Steps

- [x] 1. Data + schema + generator (landed 2026-09-15): `sop.yaml` `runway_configs[].source`, four `RWY-*`
  rows; `schema.ts` `RunwayConfigSchema.source`, `ScenarioSchema.remarks` optional; `sop/model.py`,
  `sop/load.py`, `merge.py`, tests; `pnpm -C web schema:export`; `craft-gen build`; `data/ksfo.json`
- [x] 2. Engine + grading (landed 2026-09-15; `labels.test.ts` still hand-lists the elements without `RWY`, fold into step 3): `rules/runway.ts` `explainRunway`; `ResolvedClearance.runway:
  Cited<string>` replaces the bare `departureRunway`; `ClearanceElement` gains `RWY`; `PlayerPicks.runway`;
  `options.ts` `runways`; `grade.ts` `gradeRunway`; `toExpectedClearance` unchanged; `propose.ts` prints
  the runway line with citations; tests. Also: `PlayerPicks` gains a field, so `ui/solved.ts` must
  validate a stored value with a zod `PlayerPicksSchema` on load and treat a mismatch (an older build's
  picks without `runway`) as nothing remembered
- [x] 3. Generator remark + UI (landed 2026-09-15; 73 of seeds 0..999 file `REQ RWY 28`): `generate.ts` sets `remarks` on the on-request draw;
  `strip.ts` remarks row; `atis.ts` advertised runways; `craftForm.ts` runway group; `labels.ts` `RWY`;
  `state.ts` pick; `session.test.ts`; browser re-check
- [x] 4. Docs: `ADDING_AN_AIRPORT.md` (config `source`, `RWY-*` rows), `ARCHITECTURE.md` (2026-09-15)

## Open question for the user

- Should the reveal speak the runway at all (e.g. "…, expect runway one right" before the departure
  frequency), or stay silent as the 7110.65 CRAFT form does? Default: silent.
