# Route building before the vector-SID fallback

**User rule 2026-09-16 (SWA984, `SSTIK5 EBAYE AVE SADDE8` off 01L in 28/01).** Before replacing the
SOP's SID with the vector SID, the engine route-builds: it connects a published transition of the SID
the SOP assigns to the filed route through fixes that connect, and only when no chain exists does the
assignment table fall through to the vector-SID row. EBAYE is not an SSTIK5 transition, but SUSEY is,
and EBAYE always connects off SUSEY, so the answer is `SSTIK5 SUSEY EBAYE AVE SADDE8`, read "Sstik Five
departure, Susey transition, direct Ebaye, then as filed", not `GAPP7 EBAYE AVE SADDE8` with radar
vectors.

Source: the OAK Route Building Cheat Sheet (vZOA S1-OAK-5; Google Doc
`1rJm0csgkxlLMctyXmiPh-THOHpc4jxQDs9PYbGHO1Hs`, "Common Fixes", routes dated 2025-01-20, retrieved
2026-09-16; a copy of its text is in `.tmp/route-building-doc.txt`). Legend: `c` usually connects,
`ac` always connects, `f` destination. "DPs listed below assume SFOW flow, but the fixes can be used
with other compatible DPs depending on flow." Tips: "first try to make the minimum amount of changes
possible; a suboptimal route that is legal per SOPs and LOAs is not an unclean route."

## User decisions 2026-09-16

1. The connection table is a shared file every airport inherits: `generator/shared/route_connections.yaml`,
   keyed by fix, because the cheat sheet says the fixes work with any compatible DP.
2. Both strengths count: chains of `always` edges are searched first, then chains containing a
   `usually` edge; either beats the vector-SID fallback, and the reason names the strength used.
3. Any chain length: breadth-first from every published transition of the SOP's SID until a token
   already on the filed route is reached; fewest hops wins; ties broken by the chart's transition order.
4. The route box is graded on the full rebuilt string, and the reading is "Susey transition, direct
   Ebaye, then as filed": the chain fix after the transition is spoken "direct", and the then-as-filed
   join applies at the first filed token reached (`asFiledJoin` already does this for
   `SUSEY EBAYE AVE SADDE8` against `EBAYE AVE SADDE8`: join index 1, units "direct Ebaye").

5. **User decision 2026-09-16 (scope)**: the connection search runs only to keep a SID the pilot
   filed that the SOP prefers but that does not serve the filed exit fix (SWA984: filed `SSTIK5 EBAYE`,
   SSTIK5 kept via SUSEY). It does not run for a plan that files a SID the SOP does assign (LXJ351's
   `GAPP7 EHF`, settled as correct) or no DP at all (KAL65 `RBL J1 …`, settled as `SFO5 RBL` / `GAPP7
   RBL`): fewest changes wins, and those settled fixtures stand. Concretely, `buildRoute`'s connection
   candidates are the unserved SIDs whose family is the family of the filed procedure token; the forced
   transition (NIITE# GOBBS) is a separate mechanism and applies whatever was filed.

## Data

`generator/shared/route_connections.yaml`, transcribed from the cheat sheet (one row per arrow; `to`
may be an airway, which the join rule then reads as "(airway) (next fix)"):

```yaml
source: "OAK Route Building Cheat Sheet (vZOA S1-OAK-5), Common Fixes, routes dated 2025-01-20; retrieved 2026-09-16"
connections:
  # Common S/SW fixes
  - { from: YYUNG, to: TILLT, connects: usually }
  - { from: YYUNG, to: LAX,   connects: usually }
  - { from: MCKEY, to: TILLT, connects: usually }
  - { from: MCKEY, to: LAX,   connects: usually }
  - { from: KTINA, to: CISKO, connects: always }
  - { from: CISKO, to: RDHOT, connects: usually }
  - { from: SUSEY, to: EBAYE, connects: always }
  - { from: EBAYE, to: BURGL, connects: usually }
  - { from: EBAYE, to: AVE,   connects: usually }
  - { from: KAYEX, to: LOSHN, connects: always }
  - { from: LOSHN, to: BOILE, connects: usually }
  - { from: LOSHN, to: CLASN, connects: usually }
  - { from: LOSHN, to: EHF,   connects: usually }
  - { from: NTELL, to: Q174,  connects: usually }
  # Common N/NE fixes
  - { from: DEDHD, to: RBL,   connects: usually }
  - { from: ORRCA, to: Q120,  connects: usually }
  - { from: SAC,   to: Q120,  connects: usually }
  - { from: MOGEE, to: Q122,  connects: usually }
  - { from: MOGEE, to: Q124,  connects: usually }
  - { from: TIPRE, to: Q126,  connects: usually }
  - { from: SYRAH, to: Q128,  connects: usually }
  - { from: SYRAH, to: Q130,  connects: usually }
  - { from: LIN,   to: J84,   connects: usually }
  # Common W (oceanic) fixes
  - { from: ALCOA, to: R463,  connects: usually }
  - { from: BEBOP, to: R464,  connects: usually }
  - { from: CINNY, to: A220,  connects: usually }
```

Not transcribed: `GRTFL fPDX/EUG` and `AMAKR/ENI nw-bound oceanic` (destinations, not connections) and
`SKYL#.AVE` (a transition of an OAK DP, not a connection). Known limitation, recorded here and not
fixed in this plan: `isAirwayToken` recognises `J`, `V`, `Q`, `T` airways only, so `R463`, `R464` and
`A220` read as fixes to the engine; oceanic routes are not in the route library, so nothing reaches
them today.

Emitted as `routeConnections: [{ id, from, to, connects, source, text }]` on every airport document;
`id` is `CONN-<from>-<to>`, `text` is "<from> always|usually connects to <to>" (loader-derived, so a
row is citable like every other rule). Shared phraseology row `R-ROUTE-BUILD` (source: the cheat sheet
and the user rule; text: "Before the vector-SID fallback, route-build: keep the SID the SOP assigns by
connecting one of its published transitions to the filed route through fixes that connect, fewest
changes first; a legal suboptimal route is not an unclean route") is cited on the amendment.

## Engine

- `sidSelection.ts`: export `unservedSids(ctx, exitElement, direction, scenario, airport): Sid[]` — the
  SIDs of the applicable assignment rows ahead of the row `selectSid` takes, which the flight can fly
  from its runway with its equipment but which do not reach its exit element (today those rows go into
  `incompatible` and the walk continues). Same loop as `selectSid`, sharing its helpers; stops at the
  first fully compatible row.
- `rules/amend/build.ts` (new): `buildRoute(parsed, candidates, airport): BuiltRoute | undefined`,
  with `BuiltRoute = { sid, transition, chain: string[], joinIndex, strength: 'always' | 'usually', rows: RouteConnection[] }`.
  For each candidate SID in row order: breadth-first over the connection graph from each transition
  fix (in chart order) to any token of `parsed.tokens`; first over `always` edges only, then over all
  edges; the first hit is the fewest-hop chain. The rebuilt tokens are
  `[sid.id, transition, ...chain, ...parsed.tokens.slice(joinIndex)]` where `chain` is the fixes strictly
  between the transition and the joined token.
- `rules/amend/route.ts` `expectedRoute`: when no TEC route applies, call `buildRoute` before
  defaulting to `[clearance.sid.value.id, ...filed.tail]`; a built route wins. `routeReason` for a built
  route: "<filed SID or 'the route files no departure procedure'> …; the SOP assigns <SID> from <rwy> in
  <config>, and <exit fix> is not one of its transitions, but <transition> is and <from> <always|usually>
  connects to <to> (route building), so the SID is kept". Citations: the assignment row the SID came
  from, each connection row on the chain, `R-ROUTE-BUILD`.
- The corrected plan then resolves through `resolveClearance` unchanged (exit element SUSEY → SSTIK5
  Susey transition) and `resolveAmendedClearance` reads it under the join rule.

## Generator

`sop/load.py` `load_route_connections(path)` with a `RouteConnection` model (`from_fix`, `to`, `connects`,
strengths `always|usually`; a `(from, to)` pair stated twice is rejected); `BuildInputs.route_connections`;
`merge.py` emits `routeConnections` and adds every `from`/`to` token to the navaid-name lookup (so a VOR on
a chain, `RBL`, `SAC`, `LIN`, `EHF`, `LAX`, `AVE`, is spoken by name; the build fails on an unnamed one as
for any checked data); `cli.py` and `tests/conftest.py` wire the file; `schema.ts` `RouteConnectionSchema`
+ `routeConnections` on `AirportDataSchema`; `schema:export`; rebuild.

## Forced transition (user decision 2026-09-16, folded in here)

`when.forcedTransition` on an assignment row (KSFO: `SFOW-NOISE-S-NIITE-GOBBS`, SOP 2-4 e, 0100L–0500L
southbound off runway 01 → NIITE# GOBBS) is honoured as a route amendment. In `unservedSids` terms the
row's SID does not serve the filed exit fix, and route building resolves it without the connection
table: the rebuilt route is `[sid.id, forcedTransition, ...parsed.tokens]`, the filed route flown from
its first fix after the forced transition (filed `SSTIK5 YYUNG …` → `NIITE4 GOBBS YYUNG …`), cited to
the row. Reading under the join rule: "Niite Four departure, Gobbs transition, direct Yyung, then as
filed". A row with a forced transition is tried before the connection search, in row order like any
other. The corrected plan must then resolve to NIITE4 GOBBS in `resolveClearance`, and there is a
catch: GOBBS is a **north** gate (`sop.yaml` `gates.north`), so `directionOf(exitFix)` on
`NIITE4 GOBBS YYUNG …` says north, the southbound noise row (`direction: south`) does not match, and the
northbound night row `SFOW-NOISE-N-NIITE` would select NIITE4 for the wrong reason. Rule (assumption
stated, not asked): a forced transition is a noise-abatement detour, not the direction of flight, so
the direction of a route whose exit fix is the forced transition of a row whose family the filed
procedure token belongs to is the direction of the next gate fix on the route (YYUNG → south). That
goes in `engine.ts` beside `directionOf` (a small `flightDirection(route, airport)` reading
`assignmentRules[].when.forcedTransition`), and the exit element for `selectSid` stays GOBBS so the
S-GOBBS row's NIITE4 serves it. Clearance mode draws such plans already carrying `NIITE4 GOBBS`: the
clean-draw composition in `scenario/generate.ts` (`filedRoute: \`${sid.id} ${route.tail}\``) must insert
the forced transition after the SID token when the selected row carries one (the selection's row is
not on `ResolvedClearance`; expose it, or re-read the row by the clearance's SID citations), and the
draw's amendment-engine verification then passes.

## Drill (user decision 2026-09-16: inject the fault)

Amendment-scenario fault `dropped_transition` (`scenario/amend.ts`): for a drawn plan whose route reads
`<SID> <transition> <fix> …` where `<transition> → <fix>` is a connection row, or where `<transition>`
is the row's forced transition, drop the transition so the plan files `<SID> <fix> …`; the engine must
rebuild it back. Only where the library draws such a route (after the rows land, check whether any
library tail starts on a connection target or a forced-transition draw exists; if neither does, the
fault is dead data, left out and recorded here for the user).

## Steps (implementer briefs after the will-be-your-final brief lands, since both touch `speak.ts`
tests, `schema.ts` and the data)

1. [x] Generator + schema + data — landed 2026-09-16: `generator/shared/route_connections.yaml` (26
   rows), `load_route_connections`, `RouteConnection`, `BuildInputs.route_connections`, `routeConnections`
   emitted with ids `CONN-<from>-<to>`, connection endpoints on the checked navaid-name set, schema and
   export. Finding for step 3: the build's "gate fixes with no route in the library" warning already lists
   most connection endpoints (AVE, BOILE, CISKO, EBAYE, EHF, KAYEX, LIN, LOSHN, MCKEY…), so no library
   route leaves the DP at a connection target today and the `dropped_transition` fault likely has no
   drawable plan; step 3 confirms and reports it.
2. [x] Engine — landed 2026-09-16: `unservedSids` (`sidSelection.ts`), `buildRoute`/`builtTokens`
   (`amend/build.ts`, BFS over `always` edges then all, one edge minimum, filed-family guard, forced
   branch), `route.ts` `builtExpectation`/`builtReason`/`builtCitations`, `flightDirection` (`rules/route.ts`,
   a forced transition is a detour not a direction), clean draws adopt the engine's route when only the
   route box changed (`generate.ts` `withBuiltRoute`), shared row `R-ROUTE-BUILD`. SWA984 settled; the
   LXJ351 and KAL65 fixtures stand (scope decision 5). Original spec: `unservedSids`, `build.ts`, `route.ts` changes, `R-ROUTE-BUILD` row; tests: SWA984 rebuilt to
   `SSTIK5 SUSEY EBAYE AVE SADDE8` with the SSTIK row, `CONN-SUSEY-EBAYE` and `R-ROUTE-BUILD` cited; a
   two-hop chain (KAYEX → LOSHN → BOILE) with `usually` named; a plan whose exit fix connects to nothing
   still falls back to GAPP#; a `usually` chain beats the fallback; `always` chain preferred over a shorter
   `usually` one? — no: fewest hops within the `always` search first, then all edges, as decided.
   `speak.test.ts`: the SWA984 abbreviated reading. Proving: `pnpm -C web test rules`, then the full gate.
3. Settle SWA984 (`fixtures/ksfo/worksheets/amendment-practice-1a-swa984.json`) with the proposal; the
   drill fault if the library draws it; docs (`ARCHITECTURE.md` rules table, `ADDING_AN_AIRPORT.md`
   shared files, `CLAUDE.md` "Rules are data").
