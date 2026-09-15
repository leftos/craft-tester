# Plan index

Entry point for anyone continuing this work. Detailed design, data facts, and rationale: [craft-trainer-v1.md](./craft-trainer-v1.md).

## Current focus

- [x] 1. Scaffold: git, README, CLAUDE.md, ARCHITECTURE skeleton, this index, prek hygiene hooks, dependabot
- [ ] 2. Web scaffold: pnpm, Vite + TS (strict flags), oxlint/oxfmt, vitest, exact pins
- [ ] 3. zod schema for `AirportData` + `Fixture`, schema export script, sync test, `data/airports.json`
- [ ] 4. Generator scaffold: uv project, ruff/ty, `craft-gen --help`, cached HTTP
- [ ] 5. CIFP: cycle math, record slicing, SID grouping; 210 KSFO rows as fixture; hypothesis tests
- [ ] 6. Charts: API list, PDF download, text extraction; 12 chart-text snapshots
- [ ] 7. SOP transcription (`sop.yaml`, `overrides.yaml`, `routes.yaml`) + loader + hash/sentinel verify
- [ ] 8. Aircraft classes from vNAS
- [ ] 9. Merge + emit + integrity checks; first `data/ksfo.json`
- [ ] 10. Rules engine core + table tests + exhaustive enumeration test
- [ ] 11. Synthetic fixtures + fixture runner
- [ ] 12. `options`, `grade`, `speak`
- [ ] 13. Scenario generator (seeded)
- [ ] 14. UI: strip, ATIS, CRAFT form, results, seed in URL hash
- [ ] 15. CI + GitHub Pages; finalize README, ARCHITECTURE, CLAUDE.md
- [ ] 16. `import-worksheets`: seven Google Docs → pending fixtures
- [ ] 17. Validation loop, clearance mode (one at a time with the user, then batch)
- [ ] 18. TEC routes, LOA rules, equipment suffixes, destination coordinates, fleet ceilings
- [ ] 19. Amendment engine
- [ ] 20. Amendment scenario generator + UI + mode switch
- [ ] 21. Validation loop, amendment mode

## Blockers

None. Worksheets are public Google Docs (ids in the subplan); no browser needed to fetch them.

## Backlog

- [ ] Second airport (OAK or SJC) as a data-only addition to prove the boundary
- [ ] Callsign telephony table for the spoken reveal ("United twelve thirty-four")
- [ ] Scheduled workflow that re-runs the generator each AIRAC cycle and opens a PR

## Open questions (settled by the validation loops, recorded as data toggles)

See "Open questions" in [craft-trainer-v1.md](./craft-trainer-v1.md#open-questions-to-settle-from-the-worksheets-encoded-as-data-toggles-not-code).
