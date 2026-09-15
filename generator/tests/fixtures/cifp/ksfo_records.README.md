# `ksfo_records.txt`

Every KSFO SID (`PD`) and runway (`PG`) row of the FAA CIFP, checked in so the CIFP tests never touch
the network.

| field | value |
|---|---|
| AIRAC cycle | 2609 |
| effective | 2026-09-03 |
| source | `https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_260903.zip`, member `FAACIFP18` |
| captured | 2026-09-15 |
| filter | `line[6:10] == "KSFO" and line[12] in "DG"` |
| rows | 218 (210 SID legs, 8 runways), every row 132 characters |

Public domain: FAA Coded Instrument Flight Procedures data, published free of charge by the FAA
Aeronautical Information Services (AJV-A).

Regenerate after an AIRAC bump with `uv run craft-gen fetch-cifp --airport KSFO`, then re-apply the
filter above to the extracted `FAACIFP18`. SID versions change between cycles, so the tests assert
SID families and structure rather than exact versioned ids where a version bump would be routine.
