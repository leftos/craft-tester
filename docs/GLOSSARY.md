# Glossary

Terms the docs, plans and commit messages use in a project-specific sense.

- **Accepted handling**: the second resolution of a special aircraft (`handling: 'accepted'`), made with its turboprop class. An answer that is right under it is graded right, citing `ZOA-CPS004-SPECIAL-AIRCRAFT`.
- **Coach mark**: one step of the first-run tour. The page dims except one control of the real trainer, and a card says what the control is and what to do. The step moves on when the student does it.
- **Local SOP (for a special aircraft)**: an airport whose `aircraftGroups` names the type, so its SOP defines that type itself and its SOP rows keep the type's own class under either handling (`localSop` on the fleet entry).
- **Performance class**: the class ZOA CPS-004 §3.1 handles a type with when that differs from its engine class, e.g. a C510 is a jet handled like a turboprop. Written as `performance_class` in `generator/shared/aircraft_types.yaml`.
- **Proposed handling**: the resolution the trainer shows as the answer (`handling: 'proposed'`). For a special aircraft it keys TEC rows with the jet class.
- **Share link**: a read-only link to a finished test set's results (`#/results/<id>`), made by a signed-in student so a mentor can see the summary without an account.
- **SID family**: a departure procedure's name without its version number (`OAK` for OAK7, written `OAK#` in SOP notation). AIRAC cycles bump the version, so rules, tests and fixtures compare SIDs by family.
- **SID version stamp**: a fixture's `sidVersions` field, which records the id and spoken name of each SID family it names, as they were when the fixture was written. The fixture runner maps those to the current cycle's versions.
- **Special aircraft**: the five types ZOA CPS-004 §3.1 lists (SF50, C510, E50P, E55P, DH8D). Each has a proposed and an accepted handling.
- **Synced store**: a browser store (solved strips, test sets, preferences) that writes to `localStorage` first and, while the student is signed in, also to the server, merging the two on sign-in.
- **Test set**: a run of N strips drawn from one set seed, taken against an optional clock with grades hidden until the set ends, then shown in one summary.
- **Variant**: a graded strip re-opened with one attribute changed (the aircraft class, the equipment suffix, RVSM), in amendment mode, so the student sees what that change would need amending.
