# `star_records.txt`

The first CIFP arrival (`PE`) row of every (airport, procedure) pair published by the 42 destinations
of `airports/ksfo/routes.yaml`, checked in so the STAR tests never touch the network.

| field | value |
|---|---|
| AIRAC cycle | 2609 |
| effective | 2026-09-03 |
| source | `https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_260903.zip`, member `FAACIFP18` |
| captured | 2026-09-15 |
| filter | `line[0] == "S" and line[4] == "P" and line[12] == "E"`, keeping the 42 destinations, then the first row of each (airport, procedure) pair |
| rows | 179, every row 132 characters |

## One row per (airport, procedure) pair, not all 4,927

Those 42 destinations publish 4,927 arrival rows between them, but `cifp/stars.py` reads only the
airport at `[6:10]` and the procedure identifier at `[13:19]`. The later legs of an arrival repeat
both and carry nothing else the parser looks at, so 179 rows exercise everything 4,927 would, and the
fixture stays small enough to read.

## Absent means two different things

27 of the 42 destinations appear here. The 15 that do not are absent for two unrelated reasons, which
`test_stars.py` pins separately:

* Not in the FAA file at all, which is every foreign destination: `CYVR`, `ESSA`, `MMMX`, `RKSI`.
  These have no airport reference point in `airport_records.txt` either.
* In the file, with an airport reference point, but publishing no arrival: `KACV`, `KGPZ`, `KJAC`,
  `KLVK`, `KMRY`, `KMYV`, `KOVE`, `KSAC`, `KTRK`, `KWVI` and `O88`.

Public domain: FAA Coded Instrument Flight Procedures data, published free of charge by the FAA
Aeronautical Information Services (AJV-A).

## Regenerating

After an AIRAC bump run `uv run craft-gen fetch-cifp --airport KSFO`, then from the repo root:

```sh
F=generator/cache/cifp/2609/FAACIFP18
DESTS="CYVR ESSA KACV KAPC KBFI KBLI KBOI KBUR KCRQ KDEN KFAT KGPZ KJAC KLAS KLAX KLGB KLVK KMCI KMRY KMYV KOAK KONT KOVE KPDX KRNO KSAC KSAN KSBA KSEA KSJC KSLC KSMF KSMO KSNA KTRK KUDD KVNY KWVI MMMX O88 PHNL RKSI"
pat=$(echo $DESTS | tr ' ' '|')
rg -N "^S.{3}P.($pat)..E" "$F" | awk '!seen[substr($0,7,4) substr($0,14,6)]++' > generator/tests/fixtures/cifp/star_records.txt
```

`O88` is blank-padded to `O88 ` in the file, so the alternation never matches it. That costs nothing:
Rio Vista publishes no arrival, and the pattern would match no row for it either way.
