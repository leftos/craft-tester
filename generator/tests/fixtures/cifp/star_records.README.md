# `star_records.txt`

The CIFP arrival (`PE`) rows the parser reads for the 42 destinations of `airports/ksfo/routes.yaml`,
checked in so the STAR tests never touch the network.

| field | value |
|---|---|
| AIRAC cycle | 2609 |
| effective | 2026-09-03 |
| source | `https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_260903.zip`, member `FAACIFP18` |
| captured | 2026-09-17 |
| filter | `line[0] == "S" and line[4] == "P" and line[12] == "E"`, keeping the 42 destinations, then the first row of each (airport, procedure, route type) triple, and of each (airport, procedure, enroute transition) |
| rows | 839, every row 132 characters |

## The rows the parser reads, not all 4,927

Those 42 destinations publish 4,927 arrival rows between them, but `cifp/stars.py` reads four
fields: the airport at `[6:10]`, the procedure identifier at `[13:19]`, the route type at `[19]` and
the transition identifier at `[20:25]`. Two rows that agree on all four tell the parser the same
thing, so the file keeps the first of each group: one row per route type of a procedure, which is
what its RNAV flag is read from, and one per enroute transition (route types `1` and `4`), which is
what its transition list is read from. 839 rows exercise everything 4,927 would, in file order, so
the document built from this fixture matches the one built from the live file - which
`test_build_matches_committed_data` compares against `data/ksfo.json` byte for byte.

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
rg -N "^S.{3}P.($pat)..E" "$F" |
  awk '{k=substr($0,7,4) substr($0,14,6) substr($0,20,1); if (substr($0,20,1) ~ /[14]/) k=k substr($0,21,5)} !seen[k]++' \
  > generator/tests/fixtures/cifp/star_records.txt
```

`O88` is blank-padded to `O88 ` in the file, so the alternation never matches it. That costs nothing:
Rio Vista publishes no arrival, and the pattern would match no row for it either way.
