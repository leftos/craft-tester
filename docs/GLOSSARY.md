# Glossary

Terms the docs, plans and commit messages use in a project-specific sense.

- **Accepted handling**: the second resolution of a special aircraft (`handling: 'accepted'`), made with its turboprop class. An answer that is right under it is graded right, citing `ZOA-CPS004-SPECIAL-AIRCRAFT`.
- **Box**: one of the three fields of a strip a student checks in Amend mode: aircraft type, altitude and route (`BOX.type`, `BOX.altitude`, `BOX.route`). The page calls them strip boxes.
- **Class words**: the words a reason uses for a class, from the airport's `class_words` in `sop.yaml` (`classWords` on the airport data); KOAK's `J` reads "jet or DH8D", as its SOP writes "J & DH8D".
- **Coach mark**: one step of the first-run tour. The page dims except one control of the real trainer, and a card says what the control is and what to do. The step moves on when the student does it.
- **Draw**: choosing a strip at random from a seed and the filters (`generateScenario`, `generateAmendmentScenario`). A draw the engine cannot clear is drawn again, up to 50 times.
- **Element**: one graded part of a CRAFT clearance (`C`, `R.sid`, `R.route`, `A.phrase`, `A.expect`, `F`, `T`, `RWY`). The code's word; the page says "part" or names the part.
- **Instructor ruling**: the source a rule row cites when a ZOA instructor decided the rule rather than a document stating it.
- **Local SOP (for a special aircraft)**: an airport whose `aircraftGroups` names the type, so its SOP defines that type itself and it reads as the class CPS-004 proposes for it in the SOP, TEC and tool rows under either handling (`localSop` on the fleet entry).
- **Obligatory (tool row)**: a tool row that states an altitude, and so is read exactly like a TEC row (`isObligatory`); every `tec` row is obligatory too.
- **Performance class**: the class ZOA CPS-004 §3.1 handles a type with when that differs from its engine class, e.g. a C510 is a jet handled like a turboprop. Written as `performance_class` in `generator/shared/aircraft_types.yaml`.
- **Proposed handling**: the resolution the trainer shows as the answer (`handling: 'proposed'`). For a special aircraft it keys TEC rows with the jet class.
- **Reading**: the engine's spoken form of the expected clearance, which a typed answer is graded against. The code's word; the page says "the expected clearance".
- **Recommended (tool row)**: a tool row with no altitude (`recommendedToolRoute`). The route box proposes it only where the box is amended anyway, and the box the engine would otherwise propose is also correct.
- **`routeAlsoCorrect`**: the route box graded correct beside the expected one, carried on the amendment engine's ok result and on a fixture's expected amendments.
- **Share link**: a read-only link to a finished test set's results (`#/results/<id>`), made by a signed-in student so a mentor can see the summary without an account.
- **SID family**: a departure procedure's name without its version number (`OAK` for OAK7, written `OAK#` in SOP notation). AIRAC cycles bump the version, so rules, tests and fixtures compare SIDs by family.
- **SID version stamp**: a fixture's `sidVersions` field, which records the id and spoken name of each SID family it names, as they were when the fixture was written. The fixture runner maps those to the current cycle's versions.
- **Special aircraft**: the five types ZOA CPS-004 §3.1 lists (SF50, C510, E50P, E55P, DH8D). Each has a proposed and an accepted handling.
- **Synced store**: a browser store (solved strips, test sets, preferences) that writes to `localStorage` first and, while the student is signed in, also to the server, merging the two on sign-in.
- **Test set**: a run of N strips drawn from one set seed, taken against an optional clock with grades hidden until the set ends, then shown in one summary.
- **Tool row**: a `kind: tool` row of `tec.yaml`, the ZOA route tool's route to a field outside NCT (KAPC, KSTS, KCCR). Obligatory or recommended according to whether it states an altitude.
- **Training stage**: the vZOA S1 module a student is working on (S1-OAK-1 to S1-SFO-4, or All topics). New strip and new tests draw and grade only what the modules up to it have taught; a setting a later module unlocks is shown greyed, "at" that module.
- **Variant**: a graded strip re-opened with one attribute changed (the aircraft class, the equipment suffix, RVSM), in amendment mode, so the student sees what that change would need amending.
