# `airport_records.txt`

The airport reference-point (`PA`) row of KSFO and of every `routes.yaml` destination that carries no
hand-entered `lat`/`lon`, checked in so the merge tests never touch the network.

| field | value |
|---|---|
| AIRAC cycle | 2609 |
| effective | 2026-09-03 |
| source | `https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_260903.zip`, member `FAACIFP18` |
| captured | 2026-09-15 |
| filter | `line[0] == "S" and line[4] == "P" and line[12] == "A"`, keeping KSFO and the 32 destinations |
| rows | 33, every row 132 characters |

The four foreign destinations (`RKSI`, `ESSA`, `MMMX`, `CYVR`) are not in the FAA file at all; their
coordinates are hand-entered in `airports/ksfo/routes.yaml`.

Public domain: FAA Coded Instrument Flight Procedures data, published free of charge by the FAA
Aeronautical Information Services (AJV-A).

Regenerate after an AIRAC bump with `uv run craft-gen fetch-cifp --airport KSFO`, then re-apply the
filter above to the extracted `FAACIFP18`.
