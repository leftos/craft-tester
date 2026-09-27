# Glossary

Terms the docs, plans and commit messages use in a project-specific sense.

- **Accepted handling**: the second resolution of a special aircraft (`handling: 'accepted'`), made with its turboprop class. An answer that is right under it is graded right, citing `ZOA-CPS004-SPECIAL-AIRCRAFT`.
- **Local SOP (for a special aircraft)**: an airport whose `aircraftGroups` names the type, so its SOP defines that type itself and its SOP rows keep the type's own class under either handling (`localSop` on the fleet entry).
- **Performance class**: the class ZOA CPS-004 §3.1 handles a type with when that differs from its engine class, e.g. a C510 is a jet handled like a turboprop. Written as `performance_class` in `generator/shared/aircraft_types.yaml`.
- **Proposed handling**: the resolution the trainer shows as the answer (`handling: 'proposed'`). For a special aircraft it keys TEC rows with the jet class.
- **Special aircraft**: the five types ZOA CPS-004 §3.1 lists (SF50, C510, E50P, E55P, DH8D). Each has a proposed and an accepted handling.
