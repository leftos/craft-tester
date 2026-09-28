# Airway structure for conventional route rebuilds

User steer 2026-09-17: the RNAV element check (`R-RNAV-AIRWAY`, `R-RNAV-WAYPOINT`, the `rnav_element` fault) leaves a non-RNAV plan with no conventional route in the data. With the J and V airway structure the engine could rebuild one. The user named two sources to look at: yaat's handling of the vNAS `NavData.dat` and `zoa-reference-cli`, which can pull up any airway.

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
16,963 `SUSAER` rows, 1,243 route ids.
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

## Decided with the user

- **Rebuild onto a conventional route**: the route library's conventional row to the same destination first; otherwise a path over V airways below 18,000 and J above, from the assigned SID's exit navaid (the OAK VOR for a radar-vector departure) to the LOA or TEC entry fix or the destination.
- **Structure shipped to the browser**: only the airways the Bay files (named in `routes.yaml`, TEC and LOA rows and the fixtures), as `rnavWaypoints` does.
- **Grading**: a rebuilt route is accepted among alternatives: any legal conventional route the engine confirms takes full credit, and the rebuilt one is shown as the model answer, as the radar-vector navaid warning works today.

- **Data shape**: `airways` widens to one list, `{id, rnav, level, oneWay, stretches}`, with the three hand one-way rows of `shared/airways.yaml` merged in by id.
- **What ships**: V and J with their structure; Q and T as id plus RNAV flag, so the RNAV check reads data. Y keeps its prefix rule (the CIFP codes Y routes conventional).
- **No path**: ship more airways rather than fall back: the filed set is widened by connectivity (a V/J airway sharing a fix with a shipped one), to depth 2. Measured: depth 0 ships 20 V/J airways (+84 KB a file), depth 1 381 (+1.15 MB), depth 2 626 of the 634 US V/J airways (+1.7 MB a file); the user accepted depth 2 as measured.
- **Type box and route**: when a path exists, raising the type to an RNAV suffix and rebuilding the route are an alternative pair, both full credit, as the RNAV clash pairs today. The settled KOAK fixtures `rnav-elements-b738w-klas`, `amendment-practice-2-fdx3859` and `amendment-practice-3-pxt415` then gain a route alternative and go back to the user for a re-ruling.

## Mapped facts (explorer)

- CIFP airway rows: `[37]` subsection, `[40]=='E'` ends a stretch (178 mid-airway breaks, e.g. V6 ends at DPA and restarts at PSB), `[46]` direction restriction is blank in every row (one-way stays hand-maintained), `[88:93]` a second minimum altitude in 637 rows (believed the reverse-direction MEA), `[83:88]` can read `UNKNN`.
- 28 V/J airways are filed anywhere in the Bay data and fixtures; 23 exist in the CIFP (not J179, J195, J502, J517, J605) and form one component of 480 fixes that misses the LAS, DEN and SLC navaids. SFO sits on V25, V87, V150, V199 only, no J airway.
- A conventional library row to the same destination exists only for props/turboprops to NorCal fields, KLAX, KSAN and KPHX.
- The filed-airway set must also read LOA route tokens (J92, Q174 appear only there) and drop heading tokens (H090).

## Slices

- **A** has landed (`cifp/airways.py`, the widened `airways`, the RNAV check reading the Q/T flag). Next, **C**: the rebuild search (reusing `routeBuild.ts`'s breadth-first walk), the alternative pair in `rules/amend/engine.ts`, a grading tier in `grade.ts` and `ui/results.ts` distinct from the navaid-acceptable one, a rule row, and the three settled fixtures re-ruled. Open for C's brief: level at FL180, tie-break among equal paths, the exit navaid per SID kind, where the route stops, MEA use, and what a "confirmed conventional route" is for grading.
