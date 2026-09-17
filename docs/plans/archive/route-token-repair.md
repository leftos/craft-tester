# Reading a filed route the pilot typed badly

Subplan of [MAIN.md](../MAIN.md) and [koak-v3.md](./koak-v3.md). The last two pending KOAK worksheet
fixtures, and their KSFO twins, file routes whose leading or middle tokens do not name what the engine
expects. Each needs a rule concept; the user ruled on all three questions 2026-09-17.

## The two plans

| fixture | filed route | today |
|---|---|---|
| `ws-{koak,ksfo}-amendment-practice-2-fft2015` | `CNDEL PORTE SUSEY EBAYE BURGL` / `PORTE8 PORTE SUSEY EBAYE BURGL` | KOAK unresolved (`CNDEL` is in no gate); KSFO proposes `WESLA5 PORTE SUSEY EBAYE BURGL` |
| `ws-{koak,ksfo}-amendment-practice-2-ual313` | `OAK6 MOGEE BVLQ124 BVL WAATS5` / `TRUKN2 MOGEE BVLQ124 BVL WAATS5` | `BVLQ124` is read as a fix and spoken "bravo victor lima quebec one two four" |

What the data says about the first: **PORTE is both a south gate fix and the `baseFix` of CNDEL5, WESLA5
and SSTIK5**, so the exit-fix walk stops on it and the clearance reads "Wesla Five departure, Porte, then
as filed" — naming a fix the SID already flies over. `SUSEY`, two tokens later, is a published transition
of all three.

## Decisions (user, 2026-09-17)

1. **Read the route from the first element that is not the SID's own structure.** FFT2015 becomes
   `CNDEL5 SUSEY EBAYE BURGL` at KOAK and `WESLA5 SUSEY EBAYE BURGL` at KSFO, spoken "…departure, Susey
   transition, then as filed".
2. **The simplification is a scored route amendment**, wherever it applies — not a warning tier, and not
   only alongside another route fault. A plan filed `WESLA5 PORTE SUSEY EBAYE BURGL` with the right SID
   still has its route box amended.
3. **A malformed route token is dropped and the route is built across the gap.** UAL313 becomes
   `OAK6 OAK MOGEE Q124 BVL WAATS5` (and `TRUKN2 MOGEE Q124 BVL WAATS5` at KSFO), which needs a
   `Q124 -> BVL` row beside the `MOGEE -> Q124` row already in `route_connections.yaml`; it is the route
   the user's own Common Fixes notes file to Salt Lake (`OAK6 OAK MOGEE Q124 BVL YUTES1`).

## Design (orchestrator, assumptions stated)

**What "the SID's own structure" is, from the data we have.** A SID document carries `family`, `baseFix`,
`transitions[].fix` and `restrictions[].fix` — there is no full leg-fix list. Testing against every SID rather
than the assigned one resolves the ordering problem: the SID is selected *from* the exit fix, so the walk has
to finish before the selection.

**The predicate is narrower than "names any SID's structure"** (corrected 2026-09-17, after a first brief
enumerated the corpus before editing and found that the broad form drops a leading token in **eight settled
fixtures**). The broad form contradicts a shared row already in the same file — `R-AS-FILED` reads "used when
the first filed fix after the SID is not one of its published transitions, **including the SID's own base
fix**" — and the settled `syn-trukn2-basefix-ccr-01r` asserts that very reading, its note saying "the flight
leaves TRUKN2 at its base fix, so the route is spoken 'then as filed'". (That fixture files
`TRUKN2 TRUKN FEVTA FEVTA1`; `TRUKN2 TRUKN CCR CCR2` in the table below is the settled
`ws-ksfo-phraseology-practice-2-n436ms`. Neither FEVTA nor CCR is a TRUKN2 transition, so both drop nothing.)

> A leading token is dropped only when the token names a SID's own structure **and the next surviving token
> is a published transition of that same SID**.

That is the user's own wording ("the element named is the first that follows, a published transition where the
route files one") and it separates every case in the corpus:

| filed | dropped | why |
|---|---|---|
| `PORTE8 PORTE SUSEY EBAYE BURGL` | `PORTE` | SUSEY is a WESLA5 transition; PORTE is its base fix |
| `CNDEL PORTE SUSEY EBAYE BURGL` | `CNDEL`, `PORTE` | SUSEY is a CNDEL5 transition; CNDEL is its family, PORTE its base fix |
| `TRUKN2 TRUKN CCR CCR2` | none | CCR is no TRUKN2 transition — `R-AS-FILED` governs, as the fixture says |
| `MOLEN9 MOLEN ALLBE R465 …` | none | ALLBE is no MOLEN9 transition |
| `COAST9 MCKEY LAX COMIX2` | none | LAX is no transition of the SID MCKEY belongs to |
| `SUNNE1 SUNNE KAYEX LOSHN …` | none | SUNNE1 publishes no transitions at all (PXT415, VOI5909 stand) |

**The heading path keeps the prefix.** Where the SOP issues no SID, nothing flies the aircraft over the
structure fix, so the drop must not reach the bare-heading proposal. `checkHeadingRoute` already builds from
the raw filed tail, so this needs no new code — only care not to swap it for the parsed tokens. The
built-on-heading branch does issue a SID and so does drop.

**An empty `restrictions[].fix` is not a match.** Five KOAK SIDs (COAST9, NUEVO8, OAK6, QUAKE2, SKYL1) carry
`{"altitudeDescription":"between","altitudeOneFeet":1400,"altitudeTwoFeet":2000,"fix":""}` — a chart-parse
artefact, recorded here as a data finding to chase separately.

**Where it lives.** `parseFiledRoute` in `rules/route.ts` already takes the whole airport document, and its
three callers (`rules/engine.ts`, `rules/amend/route.ts`, `rules/amend/arrival.ts`) all want the simplified
reading. `routeFromExitFix` keeps its `airportFaa`-only signature: `rules/speak.ts` calls it on a route that
has already been through the amendment, so it has nothing left to drop. `ParsedRoute` gains the dropped
tokens so the amendment reason can name them.

**Malformed tokens.** No ident in the NAS is longer than five characters except a procedure (`[A-Z]{3,5}\d`,
six), so the test needs no new data: a token that is neither a procedure token nor an airway token and is
longer than five characters names nothing.

**The test is "an ident too long to be one", not "a long token"** (corrected 2026-09-17, found by the Brief B
dispatch running it against the corpus). The plain length test also matches `(continued)`, the marker the
worksheet transcription leaves where the source PDF cuts a route off — seven fixtures carry it inside
`filedRoute`, five of them settled, and the plan record keeps the truncated tail "as transcribed" on purpose.
So a token is malformed only when it is **letters and digits only** and too long: `BVLQ124` qualifies,
`(continued)` (parentheses, lowercase) and `ANN…` (an ellipsis) are not claiming to be idents and pass
through. A token that is not even shaped like an ident is a transcription note, not a typo to repair.

**The repair runs on the heading path too**, unlike the structure drop above. The asymmetry is principled: a
structure fix is dropped because *a SID* flies the aircraft over it, and on a bare heading no SID does — but
a token that names nothing names nothing whatever clearance the flight gets, and leaving it would speak
"bravo victor lima quebec one two four" on exactly the plans the heading path serves.

**The gap is closed by the route builder** already in `rules/routeBuild.ts`, searching from the fix before the
dropped element to the fix after it; where no chain connects them the element is simply dropped and the two
fixes join direct.

**Citations.** Two new rows in `generator/shared/phraseology_rules.yaml`, since both are national reading
conventions rather than ZOA facts: one for reading past the SID's own structure, one for a route element
that names nothing.

**The `Q124 -> BVL` row is already checked-in data elsewhere** (verified 2026-09-17): the Salt Lake row of
both route libraries files that pair — KOAK `OAK MOGEE Q124 BVL YUTES2`, KSFO `MOGEE Q124 BVL BVL2` — so the
connection row states what the library already flies rather than a new claim. KSLC is not on the ZOA common
arrivals sheet (it lists ZLA fields only), so no arrival swap fires on UAL313 and its filed `WAATS5` stands,
which is what the user's answer keeps.

**Folded in, owed by an earlier step:** `AIRWAY_TOKEN` in `rules/route.ts` matches `[JVQTY]\d+` while
`rules/speak.ts` matches `[A-Z]\d{1,3}`, so R463, R464 and A220 are airways to the speaker and fixes to the
routing logic; the two definitions become one. (The `!AIRWAY_TOKEN` guard inside `isSidToken` is unreachable
under either regex — three letters versus one — so it goes with the merge.)

**Dropped 2026-09-17:** a third step meant to extend the `R-ROUTE-BUILD` row to the SID's end fix. The row
already reads "one of its published transitions, **or the fix the SID itself ends on**" and cites the PXT415
ruling; the koak-v3 note claiming otherwise was stale.

## Steps

- [x] **Brief A** — landed 2026-09-17 (`3117367`, merged `e041058`): `structureNames` /
  `liesOnStructureBefore` / `structurePrefixLength` in `rules/route.ts` applied inside `parseFiledRoute`
  (signature of `routeFromExitFix` unchanged), `droppedStructureTokens` on `ParsedRoute`,
  `withoutStructure` in `rules/amend/route.ts` removing the run where it sits so the airport navaid still
  produces no amendment, the shared row `R-SID-STRUCTURE` cited on the amendment, and one `AIRWAY_TOKEN`
  definition (`^[A-Z]\d{1,3}$`) that `rules/speak.ts` now imports. Suite 1,082 green, both builds
  `--check` unchanged. The first dispatch came back `underspecified` with no edits (27 calls), having
  enumerated the fixture corpus before writing code; its finding is the narrowed predicate above.
  Follow-up noted, not a blocker: `builtExpectation` does not carry `dropped`, so a route that is both
  built and had a structure prefix would drop it without citing `R-SID-STRUCTURE`; no plan in the corpus
  does both.
- [x] **Brief B** — landed 2026-09-17 (`5a86e63`, merged `1736564`): `isMalformedToken` in `rules/route.ts`,
  `walkTo` as the one breadth-first search with `connectFixes` as its fix-to-fix entry point and
  `connectionCitations` as the one path to a chain's citations, the repair on the assigned-tail, built and
  heading paths alike, the shared row `R-ROUTE-TOKEN` cited with the connection rows crossed, and the
  `Q124 -> BVL` row. Suite 1,097 green, both builds `--check` unchanged. Its first report was
  `underspecified` on the `(continued)` clash above.
- [x] Settle the four fixtures — **settled by the user 2026-09-17**, both pairs as proposed. **KOAK now has
  no pending fixture at all**; KSFO is at 33, all in the paused step-21 loop.

## Landed

Both concepts are in. What the four plans now answer:

| plan | type | route | spoken |
|---|---|---|---|
| FFT2015 KOAK | — | `CNDEL5 SUSEY EBAYE BURGL` | "Candle Five departure, Susey transition, then as filed. Climb via SID." |
| FFT2015 KSFO | — | `WESLA5 SUSEY EBAYE BURGL` | "Wesla Five departure, Susey transition, then as filed. Climb via SID except maintain three thousand." |
| UAL313 KOAK | `B752/L` | `OAK6 OAK MOGEE Q124 BVL WAATS5` | "Oakland Six departure, radar vectors Mogee, Queue one twenty-four, Bonneville VOR, then as filed. Climb via SID except maintain FL190." |
| UAL313 KSFO | `B752/L` | `TRUKN2 MOGEE Q124 BVL WAATS5` | "Trukn Two departure, Mogee transition, Queue one twenty-four, Bonneville VOR, then as filed. Climb via SID." |

FL330 stands on both UAL313 plans: `/Q` is in no FAA table, and the `/L` it corrects to is RVSM-approved.
KOAK UAL313's missing `OAK` after `OAK6` rides along in the scored route correction rather than standing as
its own `R-RV-NAVAID` warning, since the box is amended anyway (user accepted 2026-09-17).

## Findings to chase separately

- Five KOAK SIDs carry a restriction row with an empty `fix` (above) — a chart-parse artefact in
  `data/koak.json`, so `generator/src/craft_generator/chart_text.py` or the restriction parser emits a row it
  should drop.
