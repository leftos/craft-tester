# `airway_records.txt`

The CIFP enroute airway (`ER`) rows of every airway `data/ksfo.json` ships, plus the few airways the parser tests read by name, checked in so the airway tests and the golden build test never touch the network.

| field | value |
|---|---|
| AIRAC cycle | 2609 |
| effective | 2026-09-03 |
| source | `https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_260903.zip`, member `FAACIFP18` |
| captured | 2026-09-28 |
| filter | `line.startswith("SUSAER")`, keeping every row of each airway id in `data/ksfo.json`'s `airways`, and of `V6`, `J501`, `Q1`, `T257`, `V137` and `J108` |
| rows | 10,425 of 637 airways, every row 132 characters |

## Why every row of every shipped airway

`test_build_matches_committed_data` builds the KSFO document from the checked-in fixtures and compares it with `data/ksfo.json` byte for byte. The build ships the V and J airways the airport files widened by `AIRWAY_REACH_DEPTH` to every V or J airway sharing a fix with a shipped one, each with all its fixes, so the fixture needs every row of every airway the committed file holds. Rows of an airway the build does not ship change nothing: the widening only ever walks from a shipped airway to another shipped one.

The named airways cover the parser tests: V6 breaks at DPA (sequence 0910) and restarts at PSB (0920), J501 is conventional and high, Q1 is RNAV and high, T257 is RNAV and low, V137 carries a second minimum altitude, and J108's TCS row an MEA coded `UNKNN`.

Public domain: FAA Coded Instrument Flight Procedures data, published free of charge by the FAA Aeronautical Information Services (AJV-A).

## Regenerating

After an AIRAC bump, rebuild `data/ksfo.json` first (`uv run craft-gen build --airport KSFO`), then from `generator/`:

```sh
uv run python -c "import json; ids = {r['id'] for r in json.load(open('../data/ksfo.json', encoding='utf-8'))['airways']} | {'V6', 'J501', 'Q1', 'T257', 'V137', 'J108'}; rows = [l.rstrip('\r\n') for l in open('cache/cifp/2609/FAACIFP18', encoding='ascii') if l.startswith('SUSAER') and l[13:18].strip() in ids]; open('tests/fixtures/cifp/airway_records.txt', 'w', encoding='ascii', newline='\n').write('\n'.join(rows) + '\n')"
```
