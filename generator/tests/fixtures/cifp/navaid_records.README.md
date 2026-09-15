# `navaid_records.txt`

Every VHF navaid and NDB row the KSFO document names, plus the four identifiers the file publishes
twice, checked in so the navaid and merge tests never touch the network.

| field | value |
|---|---|
| AIRAC cycle | 2609 |
| effective | 2026-09-03 |
| source | `https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_260903.zip`, member `FAACIFP18` |
| captured | 2026-09-15 |
| filter | `line[0] == "S" and line[4] == "D"`, keeping the 53 identifiers KSFO routes name and `AA`, `HLE`, `NEL`, `ST` |
| rows | 61 over 57 identifiers, every row 132 characters, sorted by identifier |

The four repeated identifiers are the collision rules: `ST` is an NDB in region `K3` and another in
`TI`, so the US region wins; `HLE` and `NEL` are a VHF navaid and an NDB of the same name, so the VHF
record wins; `AA` is two NDBs named differently, so the identifier is dropped. Five rows come from
the `CAN` customer area rather than `USA` - `ANN`, `BKA` and `MDO` are Alaskan, `YXC` and `YZT`
Canadian - which is why the parser applies no area filter.

Public domain: FAA Coded Instrument Flight Procedures data, published free of charge by the FAA
Aeronautical Information Services (AJV-A).

Regenerate after an AIRAC bump with `uv run craft-gen fetch-cifp --airport KSFO`, then re-apply the
filter above to the extracted `FAACIFP18`.
