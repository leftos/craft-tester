# `waypoint_records.txt`

The enroute and terminal waypoint row of every five-letter fix the KSFO document and its fixtures
file, plus the four rows the waypoint tests read, checked in so the waypoint and merge tests never
touch the network.

| field | value |
|---|---|
| AIRAC cycle | 2609 |
| effective | 2026-09-03 |
| source | `https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_260903.zip`, member `FAACIFP18` |
| captured | 2026-09-17 |
| filter | `line[0] == "S"` and either `line[4:6] == "EA"` or `line[4] == "P" and line[12] == "C"`, keeping the 84 five-letter identifiers the KSFO data and fixtures file, plus `COLLI`, `AAAME` and `AAERO` |
| rows | 78, one per identifier, every row 132 characters, sorted by identifier |

One row per identifier is enough because no two enroute rows of the cycle disagree on the type of an
identifier. Sixty-one identifiers are published as enroute waypoints and carry their enroute row;
fifteen - `CIITY`, `DPEAK`, `GNNRR`, `HABUT`, `KAMPR`, `MACHU`, `PRNCS`, `SAHEY`, `SNTNA`, `SPOON`,
`SSTIK`, `TARVR`, `TRUKN`, `WAGES` and `WESLA` - are published only as terminal waypoints of one
airport and carry that row. Nine the file does not publish at all (`BALUB`, `BENOK`, `BIKSI`,
`BUSKO`, `DITOR`, `KANSU`, `NOMEX`, `NULAR`, `SEGUN`, all on routes to foreign fields) are simply
absent, which is what a fix with no waypoint type looks like to the merge. `ALANN`, `ALLBE` and
`ALCOA` come from the `PAC` customer area rather than `USA`, which is why the parser applies no area
filter, and `NTELL` (`W`), `ALTAM` (`C`) and `COLLI` (`R`) are the three type letters the tests name.

Two rows are here for the tests alone. `AAAME` is a KOAK terminal waypoint, the row shape whose
airport sits at `[6:10]` and whose subsection sits at `[12]`. `AAERO` is a real enroute row with its
continuation number edited from `0` to `2`: the 2609 cycle publishes no waypoint continuation record
at all - all 70,085 rows are continuation `0` - so a row the continuation guard must skip has to be
made rather than copied.

Public domain: FAA Coded Instrument Flight Procedures data, published free of charge by the FAA
Aeronautical Information Services (AJV-A).

Regenerate after an AIRAC bump with `uv run craft-gen fetch-cifp --airport KSFO`, then re-apply the
filter above to the extracted `FAACIFP18` and re-edit the `AAERO` continuation number.
