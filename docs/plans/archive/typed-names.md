# Typed names, joined numbers, spelt identifiers, the joined airway — record (2026-09-18)

Frozen from `docs/plans/MAIN.md` when the work landed (`b3d2405`, `17c68b7`, `7763420`, `4cc29fe`). The
behaviour is described in ARCHITECTURE.md "Free-text grading" and ADDING_AN_AIRPORT.md (`destinations`);
this file keeps the reports, the survey of VCR and the user's rulings.

Browser check 2026-09-18 (Playwright, desktop, `s=6,a=KOAK,d=KSMF,i=text`): "n500yz cleared to sacramento
metro airport nimi6 departure radar vectors to join victor six airway sierra alpha charlie direct maintain
3000 departure frequency 120.9 sqawk 34 seven seven expect runway 28r" graded 8 of 8, the route read in
full acceptable. `s=1,a=KOAK,d=KMCC`: "cleared to kmcc oak6 depature" put `oak6 depature` on R.sid as
right and left C missing only "airport".

Not done: `x-ray` typed with a hyphen is not read as X (`xray` is). On a KSEA-bound clearance a typed
`sea` is the field's alias "Sea-Tac", not the SEA VOR.

## The items as they stood

- [x] **Airport spoken names.** "cleared to sacramento metro airport" graded acceptable with `metro` as an
  extra word against `expected: cleared to Sacramento airport`. The user points at how
  `C:\Users\Leftos\source\repos\vatsim_control_recs\` (VCR) names airports as the source to pull from
  - Surveyed 2026-09-18: VCR's `data/airport_names.csv` holds display names (`Sacramento Intl`,
    `Las Vegas - Harry Reid`) built from FAA NASR `ARPT_NAME` through spaCy; the same FAA name is in the
    CIFP `PA` record the generator already caches (columns 94–123, `SACRAMENTO INTL`). Neither has "Metro"
  - **User rulings 2026-09-18:** (1) the other names a student may say are hand rows in
    `shared/destinations.yaml` (`also:`), not an import; (2) any listed name is fully correct, with no
    "extra words" remark; (3) the engine speaks the **official** name ("cleared to Sacramento
    International airport"), and the short name becomes an alias; (4) the full FAA name always, also
    where it is a dedication or a compound (Harry Reid International, Oakland San Francisco Bay);
    (5) **the amendment reasons keep the short name** — the full names moved the reason text of 15 settled
    fixtures, so each row carries an explicit `short:` (the old `spoken`), the reasons read it, and no
    settled reason moves. A typed clearance may say `spoken`, `short` or any `also` name
  - Landed so far: `also` through schema, generator and both data files (uncommitted, branch
    `typed-names`). Left: `short` the same way and into the reason builders (`rules/amend/altitude.ts`
    and any other site composing prose from `destination.spoken`); then the grader's name axis, where
    "Sacramento airport" ties the official reading on matches and must still win as the name itself
- [x] **A typed departure is accepted by its code, as the dropdown offers it.** "nimi6 departure" was graded a
  miss against `Nimitz Six departure` (`missed: "Nimitz" · not in the reading: "nimi"`); a student who picks
  from the dropdown picks `NIMI6`, so the typed box must take it too
  - **User steer, same day: typed text is compared case-insensitively, everywhere.** "We can't be failing
    people based on the capitalization of words." Today `normalise.ts` expands an identifier through the
    lexicon only when typed in capitals (`CAPITALISED_IDENTIFIER`), so `NIMI6` reads "Nimitz Six" and
    `nimi6` reads "nimi 6". The capitals rule goes: `nimi6`, `sac`, `ksmf` expand as `NIMI6`, `SAC`, `KSMF`
    do. The one thing to keep safe is a typed word that is both a lexicon key and a word of the reading
  - **Second report, same day (KOAK → KMCC):** "cleared to kmcc oak6 depature" put `kmcc oak` on C as
    words not in the reading and left R.sid with "6 depature", `missed: "Oakland"`. Same cause: neither
    lower-case code expanded, so both fell in the gap after "cleared to". Check this exact text once the
    case rule lands: `oak6` must land on R.sid as "Oakland Six"; C then misses only the word "airport",
    which S-FILLER already rules a miss (7110.65 4-3-2: the word "airport" must follow the name)

- [x] **A number typed part in figures, part in words is one number** (user report, same day): "sqawk 00 six
  two" read `wrong value: said "00 six two", expected "zero zero six two"`. Cause: in `normalise.ts` a run
  that opens on figures takes the figures alone (`figuresRunLength`), so `00` and `six two` are two number
  tokens and neither is `0062`. The split is deliberate and must stay — "expect 10000 one zero minutes"
  is two numbers — so the join belongs in `gradeText`, driven by the reading: adjacent typed number
  tokens whose values concatenate to a number the reading says are read as that one number

- [x] **A navaid spelt phonetically** (user report, same day): "radar vectors sierra alpha uniform direct"
  against `radar vectors Sausalito VOR, direct` read `missed: "Sausalito VOR" · not in the reading: "sierra
  alpha uniform"`. The matcher does not see that the three words spell `SAU`. The repo rule is that fixes
  are spoken by name, never spelt, so the tier is a ruling to take to the user (right, acceptable with its
  own remark, or wrong but named as "spelt, say the name"); either way the normaliser has to read a run of
  phonetic-alphabet words that spells a lexicon key as that identifier
  - **User rulings 2026-09-18:** fully correct, no remark — 7110.65 2-5-2 a 1 gives "the name or phonetic
    alphabet equivalent (location identifier) of a NAVAID when using it in a routing" as equals ("V6
    Victor Whiskey Victor (Waterville) V45 Jackson"); and the same for a five-letter fix spelt letter by
    letter, which goes beyond the paragraph on the user's say. `R-NAVAID`'s text gains the alternative
    (YAML + build). Design: in `normalise.ts` a run of two or more phonetic-alphabet words is read
    longest-first as a lexicon key (then expanded like the typed identifier), else a run of exactly five
    as the fix's word; "victor"/"tango" before a number stay the airway word. Goes out after the grader
    step, which holds the tree

- [x] **"Radar vectors to join Victor six airway"** (user steer, same day, on a KOAK → O88 reading that said
  "radar vectors to join Victor six, then as filed"): an airway the flight is vectored to join is followed
  by the word "airway"; an airway that connects two fixes inside the route takes no such word ("Oakland
  VOR, Victor six, Sacramento VOR" stays). Row text is `R-RV-AIRWAY` (YAML + build); the reading is
  `speak.ts`. A typed answer then needs the word like any other required word (`S-FILLER`: a required
  word left out is a miss), and "airway" said after a connecting airway stays filler
