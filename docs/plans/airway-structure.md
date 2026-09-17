# Airway structure for conventional route rebuilds

User steer 2026-09-17: the RNAV element check ([rnav-route-elements.md](./archive/rnav-route-elements.md)) leaves a
non-RNAV plan with no conventional route in the data. With the J and V airway structure the engine could
rebuild one. The user named two sources to look at: yaat's handling of the vNAS `NavData.dat` and
`zoa-reference-cli`, which can pull up any airway.

## Survey (Explore agent, 2026-09-17, verified against the files on disk)

**vNAS `NavData.dat` (yaat).** Raw protobuf discovered from `https://configuration.vnas.vatsim.net/`
(`navDataUrl`, `navDataSerial`), cached at `%LOCALAPPDATA%\yaat\cache\NavData.dat`, parsed by generated code
from `X:\dev\yaat\src\Yaat.Sim\Proto\nav_data.proto`. The airway model is `Airway { id, repeated fixes }`
and `Fix { id, location }`: no MEA/MAA, no high/low level, no conventional/RNAV flag, no navaid-vs-waypoint
kind. The set is global (3,906 airways) and 224 ids collide with foreign routes: `J1` appears twice (a
50-fix Central-American route first), `V6` three times. yaat indexes with first-wins `TryAdd`
(`NavigationDatabase.cs:1822`), so a bare-id lookup can return the wrong continent. VATSIM-operated endpoint
with no stated redistribution terms.

**zoa-reference-cli.** Python; `zoa airway <ID>` reads the FAA CIFP `SUSAER` records
(`src\zoa_ref\airways.py:199-261`), groups by sequence, sorts, attaches coordinates, and optionally reverses
for a W→E / N→S display order. Its MEA/MAA fields are declared but never filled from the ER rows; the `mea`
command reads NASR `AWY.txt` instead. Its id regexes drop the 38 oceanic `AR*`/`BR*` ids of the current cycle
and it finds the sequence by regex search rather than the fixed column. Worth reading for the sort and
direction logic, not copying.

**CIFP `ER` records (what the generator already downloads).** `generator/cache/cifp/2609/FAACIFP18` holds
16,963 `SUSAER` rows, 1,205 route ids (V 462, T 210, Q 181, J 172, Y 69, A 24, B 23, L 27, M 28, G 5, R 4).
Column layout, 0-based, confirmed against live rows:

```
SUSAER       V6          0100OAK  K2D 0V    OL                        02200085     04000     17500                         706272405
[13:18] route id   [25:29] sequence   [29:34] fix ident   [34:36] ICAO region   [36] fix section (D navaid, E waypoint)
[38] continuation  [39:43] waypoint description   [44] route type (O conventional, R RNAV)   [45] level (H high, L low)
[70:74] outbound course (tenths)   [74:78] leg distance (tenths NM)   [78:82] inbound course   [83:88] MEA   [93:98] MAA
```

Samples: `J1` 17 rows `OH`, `J501` 11 rows `OH` (18000/45000), `Q1` 11 rows `RH`, `T257` 40 rows `RL`
(06300/17500), `V137` 22 rows `OL`.

## Recommendation

Parse the `ER` section in `generator/src/craft_generator/cifp/` next to the SID, STAR, navaid and waypoint
parsers: one `records.py`-style dataclass, group by id, sort by sequence. Same file, same AIRAC cadence, same
public-domain licence, no new fetch or cache. It gives, in one pass, what neither alternative does: ordered
fixes plus level, conventional-vs-RNAV and MEA/MAA, which the engine needs to build a legal conventional
route and altitude. NASR `AWY.txt` (per-segment MOCA) is a second download and a second format; add it only
if MOCA ever matters.

The `R` route-type flag also answers the RNAV element check's airway rule from data instead of the Q/T/Y
prefix, and the one-way oceanic airway table for the R464 parity rule (MAIN.md) can come off the same
records if the direction restriction column proves populated.

## Open with the user before any engine change

- **What "rebuild onto a conventional route" means**: from which navaid off the assigned SID (its transition
  fixes are navaids on conventional SIDs; the OAK VOR for a radar-vector departure), along which airways, to
  which LOA or TEC entry fix or the destination. That is a graph search over the airway structure, with a
  preference order (the route library's conventional rows first, a shortest-path over V/J otherwise) and a
  level constraint (J above 18,000, V below).
- **How much of the structure to ship** to the browser: every airway the Bay files (the fixes of routes
  named anywhere in the document and the fixtures, as `rnavWaypoints` does), or the whole ZOA-adjacent set.
- **Whether a rebuilt route is graded as the single answer** or accepted among alternatives, as the
  radar-vector navaid warning is today.
