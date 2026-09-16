# Plan index

Entry point for anyone continuing this work: open items in full, one line per landed step. The full
record of every landed item and the user decisions behind it is frozen in
[archive/2026-09-16-plan-record.md](./archive/2026-09-16-plan-record.md); design, data facts and
rationale are in [craft-trainer-v1.md](./craft-trainer-v1.md). When an item lands, replace it here with
one line and move its record to the archive.

## Current focus

- [x] 1–13. Scaffolds, schema, CIFP, charts, SOP transcription, aircraft classes, merge/emit, rules engine, synthetic fixtures, `options`/`grade`/`speak`, seeded scenario generator — landed by 2026-09-15 (archive)
- [ ] 14. UI: strip, ATIS, CRAFT form, results, seed in URL hash — landed 2026-09-15 and steered through 2026-09-16 (archive: result rows, revisit spoiler, expect-runway element, time and configuration filters, C dropped, clean draws and R.sid dropped, "(no prefix)" shape, read-only CRAFT rows, published-top "climb via SID", the acceptable-but-inefficient verdict). Left:
  - [ ] Found 2026-09-16: `phraseology.nonStandardInterimExpectMinutes` (3) is in the schema and data but no engine module reads it; the engine takes every delay from `altitudeRules[].expectAfterMinutes`, so the "three minutes when a non-standard interim altitude is issued" half of the `A-EXPECT` text cannot happen. Either wire it (which rows count as non-standard?) or drop the field and the sentence; user to decide
  - [ ] Playtest observations for the user: the standing `SFO-SEGUL-OFF` notice is in force on 80% of scenarios (`NOTICES_OFF_CHANCE`); seed `f` puts a heavy UPS A306 filing `TRUKN CCR CCR2` (no 28-only SID) on 28L in 28/01 with the remark `REQ RWY 28` (the generator's on-request draw does not require a 28-only filed SID the way the importer does), and the engine then issues GAPP7 radar vectors TRUKN, maintain 3,000, because TRUKN is no SNTNA2 transition and TRUKN# is off the 28s only in 28 RT (a trainer might amend to SNTNA2 instead: amendment mode)
- [ ] 15. CI + GitHub Pages (workflows landed, pinned SHAs, actionlint + zizmor clean); finalize README, ARCHITECTURE, CLAUDE.md at the end
- [x] 16. `import-worksheets`: seven Google Docs → 70 pending fixtures (18 phraseology + 52 amendment) — landed (archive holds the source findings: UAL313 `/Q` and `BVLQ124`, four truncated rows)
- [x] 17. Validation loop, clearance mode: all 18 phraseology plans settled 2026-09-15 (archive holds the decision record: SOP-over-CBT rows, expect-clause modes, navaid names and facility words, full-route grammar, airway reading, on-request 28s, the ZOA CRAFT Phraseology reference, 28R for GA, worksheet import rules, the CIFP arrivals check, route library vs TEC, the CIFP parser survey and audit). Left open from it:
  - [ ] Heading departures are "(via) turn left/right heading (xxx)" ("via turn right heading 315"), for the non-DP heading rows (v1 does not clear them; needed when they are)
  - [ ] Filed altitude below a SID's published top altitude (TBM9 filed 11,000 on TRUKN2, top FL190): the engine issues "climb via SID except maintain (filed)" per 7110.65 4-3-2 c 4, with no expect clause (landed in `c89f636`; confirm with the user in the loop)
  - [ ] SFO5 off the 01s: the override says the 01 side has a crossing restriction (SFO 6 DME at or above 3,000), so the engine says "climb via SID except maintain"; the 28 side has none, so "maintain". Confirm with the user on the first worksheet example
  - [ ] `when.forcedTransition` (NIITE# GOBBS row) is in the schema and data but no engine module reads it; late-night southbound jets fall through to SSTIK#. Related finding from step 10: the row is dead data as written, because NIITE4 has no south transition, so honouring it means amending the route (an amendment-mode concept); user to decide
  - [x] CIFP audit finding (2026-09-16, archive item 17 "Stop hand-rolling CIFP parsing"): `navaids.py` and `airports.py` lacked the continuation-record guard (`line[21] in {"0","1"}`) that the procedure parsers apply at column 38. Landed 2026-09-16 with tests: before the guard a VHF limitation continuation row for OAK parsed as a second navaid named "Limitation" and the differing-names rule dropped the Oakland VOR entirely, and an airport continuation row raised `ValueError` from the coordinate parser; both checked-in fixtures hold only primary rows; `build --check` byte-stable
- [x] 18. TEC routes, LOA rules, equipment suffixes, destination coordinates, fleet ceilings — landed (archive)
- [ ] 19. Amendment engine — landed 2026-09-15, see [amendment-engine.md](./amendment-engine.md). Left: confirm with the user that the amended expect clause keeps its "(minutes) minutes after departure" tail (`efbc8cd` speaks it: "expect amended flight level two seven zero one zero minutes after departure")
- [x] 20. Amendment scenario generator + UI + mode switch — landed 2026-09-15, see [amendment-mode.md](./amendment-mode.md); its step D holds the open questions for the user that step 21 consumes
- [ ] 21. Validation loop, amendment mode: 52 pending worksheet amendment plans, one at a time with the user, as step 17 was; SWA2021 stays unresolved since its KPDX `DEDHD LMT OCITY#` route left the library (the Portland LOA never allowed it)

## Inputs to fold into the rules

- [ ] OAK notices for the second-airport backlog: "OAK QUAKE SID: OFF — issue 270 HDG RV first fix for 12/10 jet departures, CFG OAKE"; "OAK SUNNE SID: OFF — issue 120 HDG RV first fix for jet 30 departures, CFG SFOW noise abatement"

## Blockers

None. Worksheets are public Google Docs (ids in the subplan); no browser needed to fetch them.

## Backlog

- [ ] **v2, user steer 2026-09-15: free-text clearance entry** so students practise without dropdown hints. The student types (or dictates) the full spoken clearance; the grader normalises both sides (digits ↔ number words, "flight level three two zero" ↔ "FL320", punctuation, optional words such as "airport") and aligns the text against the CRAFT elements of `speakClearance` so each element is still graded green/red with its citation, plus a per-element diff showing what was said versus expected. Needs a tolerant matcher (per-element regex or token alignment), a decision on how strict wording is (accept "climb via the SID"? "then as filed" vs "direct"?), and the same seed/URL sharing as v1. Plan as a subplan before starting. The acceptable-but-inefficient verdict (step 14, 2026-09-16) is where two spoken-only readings belong once text is graded: "then as filed" after a bare exit fix, and a full route spelled out where the abbreviated form would do; the user decides whether they are acceptable or wrong
- [ ] **v3, user steer 2026-09-15: KOAK as the second airport** — see [koak-v3.md](./koak-v3.md). Prep done 2026-09-15: OAK ATCT SOP v1.7 downloaded and hashed, 17 DP charts cached, SOP 2-2 tables read, the new rule concepts listed (type-specific class for DH8D, heading departures, hybrid SIDs that are climb-via eligible, continuation charts, approach category, optional noise rows), five OAK worksheets (2 phraseology, 3 amendment) and the S1-OAK-1/2/5 module texts read, the user's "Common Fixes" notes folded in. Next: `generator/airports/koak/worksheets.yaml` + import, CIFP SID inspection, then the rule-concept work
- [ ] Scheduled workflow that re-runs the generator each AIRAC cycle and opens a PR

## Open questions (settled by the validation loops, recorded as data toggles)

See "Open questions" in [craft-trainer-v1.md](./craft-trainer-v1.md#open-questions-to-settle-from-the-worksheets-encoded-as-data-toggles-not-code).
