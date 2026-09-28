# Page redesign

Index line: [MAIN.md](./MAIN.md) Wave 4. The mockup is [page-redesign-mockup.html](./page-redesign-mockup.html) (open it in a browser; `#form`, `#results` and `#test` switch its state). Screenshots and measurements are regenerated with `check:browser`, not kept in git.

## Decisions

- The direction below is accepted as a whole: a sticky toolbar, the strip bay (rail) beside the work column, and collapsible results.
- **Why line**: a new plain-English reason concept, not the remarks plus the rule text.
  - **Shape**: an optional `why` field on each rule row (SOP, phraseology, TEC, LOA), written for a student.
  - **Display**: the row that decided an element's verdict supplies it (the tier row for acceptable, half or longer-than-needed; the element's own row for wrong). Where that row has no `why`, the result row falls back to the remark.
  - **Authoring**: the agent drafts `why` for the rows that most often decide a non-correct verdict, and the user approves each in a review pass before it ships. A row without an approved `why` keeps the fallback.
  - **Grounding**: every `why` about how a clearance is issued is checked against FAA JO 7110.65, the source the clearance rules derive from (`docs/refs/7110.65/`). The reason it gives is the one the order states or directly implies, and the draft names the paragraph. A reason 7110.65 does not support is dropped or marked for the user, never inferred. A row whose source is not 7110.65 (the AIM, 14 CFR, a ZOA SOP or LOA, VATSIM policy) is checked against that source instead.
- **Phone toolbar**: it hides on scroll-down and comes back on scroll-up; the strip stays pinned.
- **Fonts**: Atkinson Hyperlegible Next and Mono, self-hosted. Their `woff2` files and OFL licence are vendored under `web/public/fonts/`. There is no npm dependency and no third-party request, and a system-font fallback is kept.

## Slices

Each slice is one brief, landed and browser-checked before the next. They share `web/src/ui/app.ts` and `web/src/styles.css`, so they run one after another.

- **R1 Shell** (landed): tokens and dark mode, fonts, the toolbar (segmented `Clearance | Amend` and `Pick | Type | Full route`, a Filters popover, New strip, and a copy-link icon by the strip), the rail and work layout, the strip holder, the phone strip without annotation columns, the ATIS summary line, phone toolbar hide-on-scroll, and `browser-check.ts`'s `stripTop`. Risks R1, R2, R3 (the toolbar selectors), R5, R8 and R9 below.
- **R2 Results** (landed): a summary score and element pills, On frequency moved up, collapsed correct rows (still expandable, R7), rows that lost credit expanded with labels, citations behind `<details>`, the action hierarchy, and the amendment box verdicts in the same row component. The Why row shows the existing remarks until R3. Risks R3 (the results selectors) and R4.
- **R3 Why**: the plain-English reason concept (schema, rows and generator), shown in the Why row.
- Test sets and what-if variants ([test-and-variants.md](./test-and-variants.md)) build on R1's toolbar slot and R2's action row.

## Audit

The audit below measured the page before the redesign. File and line references are to that tree; re-resolve them with `rg -n` before briefing.

## 1. Problems found

Numbers below are from `measure.log` (hash `s=1&a=KSFO`, typed answer submitted for the results case).

| # | Problem | Evidence |
|---|---|---|
| P1 | **The form starts below the first screen's fold on phone and two-thirds down on desktop.** Header 204 px (desktop) / 321 px (phone); strip and ATIS stack above the form. Form top: 540 px at 1280, 776 px at 390. | `d-clear-desktop.png`, `d-clear-phone.png` |
| P2 | **Page height.** Clearance form 1219 px at 1280 (scrolls on an 800 px screen); results 2218 px at 1280, 3569 px at 390. Amendment form 911 / 1582 px. | `d-typed-desktop.png`, `measure.log` |
| P3 | **Desktop wastes width.** `.page` is capped at 62rem = 992 px, leaving 288 px empty on 1280. The strip panel (142 px tall) sits beside a 280 px ATIS, so 138 px of dead space opens under the strip. | `d-clear-desktop.png` (gap under "Flight plan") |
| P4 | **The header is a flat row of seven equal-weight controls**, all styled as dropdowns with uppercase labels: airport, mode, answer, full route, time, configuration, New scenario. The configuration select stretches to ~600 px and forces a second row; "full route" is a bare checkbox sitting 11 px lower than its neighbours. Mode and input are dropdowns for what are two-way switches, so their current value is hidden until opened. | `d-clear-desktop.png` top; `.controls` in `styles.css:58-63`, `.field.checkbox` 84-89 |
| P5 | **No room for the two new features.** "Test" (plan says "next to New scenario") would join an already wrapping row; "What if…" has no slot in `actionRow` (`results.ts:405-412`). | `docs/plans/test-and-variants.md` |
| P6 | **The pinned strip is unreadable on phone.** It scales to 0.60 (537 → 324 px), so the 13 px strip type prints at ~7.8 px. Its three blank annotation columns (97 px) take 18% of the width. | `d-clear-phone-view.png` |
| P7 | **Results are one undifferentiated column of 8 bordered boxes**, each 74–247 px tall on desktop, 74–542 px on phone. Correct rows take as much room as wrong ones. The only scannable signal is a 4 px left border colour; the red "wrong" route row is the third box, first seen at y=946 (desktop) / 1366 (phone). | `d-typed-desktop.png`, `measure.log` `firstWrong` |
| P8 | **Citations dominate.** Citation lists total 489 px of the 1654 px results panel on desktop (30%), 1305 of 2777 px on phone (47%), printed in full under every row, correct rows included. | `measure.log` `citationsTotalH` |
| P9 | **The reading to compare against is at the bottom.** "On frequency" starts at y=1993 (desktop) / 3232 (phone), after all eight rows. | `d-typed-desktop.png` |
| P10 | **Retry and Next scenario are both primary.** No hierarchy between "go on" and "again". | `results.ts:408-409` |
| P11 | **Visual polish.** System font stack; every label is `0.72rem` uppercase tracked text (`styles.css:76-81, 150-155, 207-212, 345-351`); CRAFT headings sit at the bottom of their row while field labels sit at the top (`craft-group` `align-items: flex-end`), so each row reads as two misaligned baselines; hard-coded greys (`#eceff3`, `#fbfcfd`, `#eef2f8`) and no dark mode. | `d-clear-desktop.png` form rows |
| P12 | **Amendment box grid is 4 columns of mostly-disabled fields** (filed, answer, new value), with the "filed" copy duplicating the strip right above it. | `d-amend-desktop.png` |

## 2. Proposed layout

One idea carries the design: **the strip bay**. A controller works with the strip in a holder on the left and the clearance on the right; the page does the same. The strip sits in a dark holder rail, the only heavy object on the page; everything else is quiet.

### Desktop (≥ 900 px)

```
┌ toolbar, sticky, 56px ─────────────────────────────────────────────────────────────────┐
│ CRAFT trainer  [KSFO▾] [Clearance|Amend] [Pick|Type|Full route] [Filters ①]   [Test] [New strip] │
├──── rail 600px, sticky under bar ─────┬──── work, 1fr ──────────────────────────────────┤
│ Flight plan              Strip 4471 ⎘ │ Your clearance            (form)                │
│ ▐ strip paper at 1:1 in holder ▌      │   or                                            │
│ RTE full route line (when trimmed)    │ Results: score + pills, On frequency,           │
│ ATIS: configuration, departing, time  │   verdict rows, Next strip / Try again,         │
│ advisory                              │   What if it were filed [as a turboprop] …      │
└───────────────────────────────────────┴─────────────────────────────────────────────────┘
```

- **Toolbar** (replaces `.app-header`): one row, grouped left to right by how often it changes. Airport select; mode and answer as segmented buttons (current value always visible); **Filters** is a button with a count badge opening a small popover (`<details>` or a `popover` element) holding time and configuration, so the 600 px configuration select leaves the row. **Test** is a secondary button beside the primary **New strip** (renamed from New scenario, so it matches "Next strip" in results and "Strip 4 of 10" in a test).
- **Full route folds into the answer switch** as a third option: `Pick | Type | Full route`. Ticking full route already forces typed input (`app.ts:506-512`, `onInput` :513-520), so the checkbox is a hidden third state today; a segmented switch shows it.
- **Scenario link** leaves the header and becomes a copy-link icon beside the strip heading (desktop) and a "Copy link" button in the results actions (phone). The raw hash text is no longer printed.
- **Rail** (`position: sticky; top: 56px; max-height: 100vh - 56px; overflow: auto`): strip at scale 1 (rail content width 552 px ≥ 537 px), ATIS under it. In amendment mode the rail holds the filed strip, the box verdicts and the amended strip; it scrolls on its own if taller than the viewport.
- **Work column** holds exactly one of: CRAFT form, typing box, amendment boxes, results, unresolved panel, test summary.
- Page max width 1320 px; no outer cards. Sections are separated by rules and the rail tint, not by bordered boxes.

Measured in the mockup (`shoot.log`): desktop form view is **800 px tall, no scroll** (form top 80 px vs 540 now); desktop results **1411 px** (vs 2218), first wrong row at y=507 (vs 946).

### Phone (< 900 px)

```
┌ toolbar, sticky, 2 rows, 100px ─────┐
│ [KSFO▾] [Clearance|Amend]  [New strip] │
│ [Pick|Type|Full route] [Filters ①] [Test] │
├ pinned strip rail, 113px ───────────┤
│ strip without annotation columns, 0.83 scale │
│ ▸ ATIS 28 RT  Dep 28L 28R  0033L Sat  1 advisory │  (tap to expand)
├─────────────────────────────────────┤
│ form / results, full width          │
```

- Strip drops the three blank annotation columns (`c5–c7`, 97 px) on phone and bleeds to the gutter: scale 0.83 (text ~10.8 px) instead of 0.60 (~7.8 px).
- ATIS collapses to a one-line `<details>` summary under the strip; the full ATIS opens in place.
- Measured in the mockup: form top 229 px (vs 776), form page 1060 px (vs 1794), results 2080 px (vs 3569).

### Test and What-if

- **Test**: the toolbar button opens a popover: count (5 / 10 / 20), time (10 / 20 / 30 / untimed), Start. While a test runs the toolbar is **replaced** by a dark test bar: "Strip 4 of 10", a row of progress squares, a large mm:ss clock, End test. Mode, answer and filters are locked for the run (the plan fixes them at start), so hiding them removes the temptation and the ambiguity. The summary view renders in the work column. Mockup state `#test` (`mockup-test-1280.png`).
- **What if…**: a chip row under the results actions, "What if it were filed [as a turboprop] [as /G] [as non-RVSM]", shown only for the variants `variantScenario` accepts. Dashed chips read as "try another", distinct from the two solid action buttons.

## 3. Results view

Mockup: `mockup-results-1280.png`, `mockup-results-390.png`, `mockup-results-1280-dark.png`.

1. **Summary first.** A large `6/8 correct` score, one sentence of tails beneath it (from the same counts `scoreLine` computes: wrong, half, longer than needed, airport navaid), and a row of **element pills** in CRAFT order (`C ✓`, `R route ✗`, `A expect ~`…), each linking to its row. The wrong pill is outlined and bold. A student sees what to fix without scrolling.
2. **On frequency moves up**, directly under the summary, with the read-aloud button. It is the model answer; the rows below explain the differences from it.
3. **Correct rows collapse to one line**: letter, element name, what was said (muted), a "Correct" tag. No citations shown.
4. **Rows that lost credit expand** into a tinted block with a verdict tag in words and a symbol (`✗ Wrong`, `~ Longer than needed`, `½ Half credit`, `Acceptable (airport navaid)`), never colour alone, and a two-column definition list:
   - `You said` — the answer runs, with the existing marks kept (`.wrong` strike, `.filler` dotted, `.misplaced` wavy, `.spelling`).
   - `Reads as` / `Shorter` / `Preferred` / `Full credit` — the existing `correctionPrefix` words become the row label instead of a `prefix:` inside the sentence; missed words keep `strong.missed`, drawn as a red underline on a light chip.
   - `Why` — the remarks line (`remarksLine`) plus, for a box, `reason`. See risk R6 on how much plain-language "why" the data can give.
   - `N rules applied` — the citation list behind a `<details>`, closed by default.
5. **Actions**: `Next strip` primary, `Try this strip again` secondary, then the What-if chips.
6. Row order stays in CRAFT order (it mirrors the transmission); the pills give the "worst first" scan.
7. The revisit view keeps its spoiler, around the same body.
8. Amendment results: the box verdicts (`renderBoxVerdicts`, `amendForm.ts`) use the same row component, shown in the rail between the two strips while clearing and at the top of the work column in results.

## 4. Visual direction

- **Type**: Atkinson Hyperlegible Next (UI) and Atkinson Hyperlegible Mono (strip, runway ids, score, rule ids), one family designed for low-vision legibility, which suits reading fixes and numbers under time pressure. Scale on a 16 px base: 13 / 14 / 16 / 18 (h2) / 40 (score, mono) px; weights 400 / 700. Sentence-case labels everywhere; no uppercase tracked labels.
- **Colour tokens** (light / dark), all as `:root` custom properties; dark under `prefers-color-scheme` guarded by `:root:not([data-theme="light"])`, plus `:root[data-theme="dark"]`:

  | token | light | dark | use |
  |---|---|---|---|
  | `--ground` | `#e8ecf0` | `#131a21` | page |
  | `--surface` | `#ffffff` | `#1b242d` | toolbar, controls |
  | `--rail` | `#dfe4ea` | `#18212a` | strip bay |
  | `--ink` / `--ink-2` | `#16202b` / `#566371` | `#e2e8ee` / `#9ba7b3` | text / secondary |
  | `--rule` | `#cbd3dc` | `#2d3945` | dividers |
  | `--accent` | `#1d5ea8` | `#7fb0ea` | primary action, pressed segment, CRAFT letters |
  | `--holder` | `#2b3642` | `#0b1117` | strip holder, test bar |
  | `--paper` / `--paper-line` / `--paper-ink` | `#eeebe0` / `#bfbbae` / `#111` | `#e3dfd0` / same / same | strip (paper stays paper in dark) |
  | `--ok` / `--ok-soft` | `#1a7440` / `#e4f2e9` | `#62cc8e` / `#173424` | correct |
  | `--bad` / `--bad-soft` | `#b3261e` / `#fbe9e7` | `#ff8a80` / `#3a1d1b` | wrong |
  | `--long` / `--long-soft` | `#8a5300` / `#fbf0dc` | `#f0b35a` / `#372a14` | acceptable / longer, advisories |
  | `--half` | `#6a4ea6` | `#b9a3f0` | half credit (today `--half` `#a16207` is nearly the same amber as `--warn`) |

- **Spacing**: 4 px base (`--s1`…`--s6` = 4, 8, 12, 16, 24, 32). Radius 6 px on controls, 4 px on tags, 3 px on the holder, none on sections.
- **Focus**: 2 px `--focus` outline with 2 px offset on every control. No entrance motion.
- **Fonts delivery**: Google Fonts `<link>` in `web/index.html`, or self-hosted via `@fontsource` (a new dependency; needs justification per repo rules). A system-font fallback keeps the layout if either fails.

## 5. Files and CSS areas each change touches

| Change | Files (line refs from the current tree) |
|---|---|
| Tokens, dark mode, type | `web/src/styles.css` `:root` 1-22, `body` 24-29, headings 36-52, every hard-coded grey (`#eceff3` 102/118/398/452, `#fbfcfd` 471, `#eef2f8` 586/604, `#a9b2c0` 139); `web/index.html` (font link) |
| Toolbar | `web/src/ui/app.ts` `renderHeader` 239-265, `modeControl`/`inputControl`/`fullRouteControl` 162-205, `filterControls` 208-236, `shareControl` 126-132, `Actions.onInput`/`onFullRoute` 83-89 and handlers 506-520; `web/src/ui/dom.ts` (new segmented-control helper next to `selectControl`/`checkboxControl`); CSS `.app-header`, `.controls`, `.field`, `.field-label`, `.field.checkbox`, `.share*` 54-162 |
| Rail + work layout | `app.ts` `renderApp` 410-417 and `renderPanels` 323-369 return rail and work nodes separately; `web/src/ui/amendPanels.ts` `Panels` type and `amendingPanels` / `clearingPanels` 211-235 / `resultPanels` 241-271 / `revisitPanels`; CSS `.layout`, `.panel`, `.panel.strip`, `.panel.atis`, full-width panel list 164-198, phone media query 634-656 |
| Strip holder, phone strip | `web/src/ui/strip.ts` `renderStrip` 369-385 (heading row + link, holder wrapper), `scaleToFit` 336-353 (reads the constant 537 px; must read the laid-out grid width once annotation columns hide), `annotationCells` 296-306; CSS `.strip-paper`, `.strip-grid` 224-242, `.strip-full-route*` 338-358 |
| ATIS | `web/src/ui/atis.ts` `renderAtis` 90-98 (add phone summary line); CSS `.atis-rows` 200-217, `.notices` 360-379 |
| CRAFT form rows | `web/src/ui/craftForm.ts` `renderGroup` 317-336, `renderCraftForm` 383-404 (letter + name split, "N left to pick" hint); `web/src/ui/labels.ts` (new letter/name split beside `elementLabel`, which propose and tests keep using); CSS `.craft-group`, `.craft-given` 381-405 |
| Typing box | `web/src/ui/textForm.ts` (panel heading only); CSS `.panel.typed` 407-422 |
| Amendment boxes | `web/src/ui/amendForm.ts` (box grid and box verdicts, `scoreLine` call at 229); CSS `.amend-boxes`, `.amend-box`, `.amend-filed` 425-460 |
| Results | `web/src/ui/results.ts` `renderVerdict` 313-328, `answerLine`/`expectedParagraph`/`pickedAnswer`/`pickedExpected` 250-302 (prefixes become labels), `citationList` 128-134 (into `<details>`), `resultsBody` 396-402 (summary + pills + reveal first), `actionRow` 405-412 (primary/secondary, What-if slot), `renderRevisit` 434-445; CSS `.score`, `.verdict*`, `.citations`, `.reveal`, `.spoken*`, `button.icon`, `.actions` 462-627 |
| Test bar and summary | new `web/src/ui/testSet.ts` (per plan); toolbar swap in `app.ts`; CSS new `.testbar` |
| What-if chips | `results.ts` `actionRow`; `ResultsProps` gains the variant list and handler |
| Browser check | `web/scripts/browser-check.ts` 137-139 (`stripTop` selector and meaning); `CLAUDE.md` "Browser checks" paragraph |

## 6. Risks

**R1. `stripTop` and the pinned strip.** `browser-check.ts:137-139` records `.panel.strip`'s top in the viewport, and `CLAUDE.md` says it is `0` while pinned. In this design the rail (not `.panel.strip`) is sticky, under a sticky toolbar, so a pinned strip reads `stripTop` ≈ 80 (desktop: 56 bar + 24 rail padding) and ≈ 108 (phone: 100 bar + 8), never 0. Options: keep `.panel.strip` as the element and redefine "pinned" as "unchanged between scroll 0 and the scroll offset", or record `stickyOffset` and the bar height. Either way the `CLAUDE.md` sentence and any recorded expectations change. In amendment mode two strips share the rail; on phone only the amended (or, while amending, the filed) strip should pin, and `querySelector('.panel.strip')` picks the first, so the check must choose one explicitly.

**R2. Phone vertical budget.** Toolbar 100 px + pinned strip 113 px = 213 px of an 844 px screen stay pinned (25%), versus 111 px today. Mitigation: hide the toolbar on scroll-down and show it on scroll-up, or pin only the strip. Needs a decision.

**R3. DOM-structure tests that would break** (from `rg querySelector` over `web/src/ui/*.test.ts`, list in `.tmp/design/test-selectors.txt`):
- `app.test.ts` `field(root, 'answer')` select at 264, 305, 323, 336, 348, 414, and `checkbox(root, 'full route')` at 300, 302, 308, 321, 327, 335, 345, 388, 403, 413 (helpers at 48-49 look up `label.field` + `.field-label` text; `checkbox` at 81). The three-way answer switch replaces both controls: **every one of these ~16 call sites breaks** and needs a `segment(root, 'Answer by', 'Full route')` helper.
- `app.test.ts:123` `buttonNamed` finds buttons by exact text; `'Retry'` at 292 breaks when it becomes "Try this strip again". Any lookup of "New scenario" / "Next scenario" would break the same way (none found by `rg`).
- `app.test.ts` selectors that survive if class names are kept on the new elements: `.panel.craft` (6), `.panel.results` (3), `.panel.results .verdict` (285: expects 8; 470: expects 11), `.panel.results .reveal .spoken` (286), `.panel.results .score` (293: asserts the score text), `.panel.results.revisit` (431, 436), `.panel.amend` (194, 228, 233, 239, 495), `.panel.typed` (279, 281, 456), `${panel} button.primary` (74: **the submit must stay the first `button.primary` in the panel**), `section.panel.strip` + `h2` text `Flight plan` (135-136, 346-362: **keep the strip's heading as an `h2` inside `section.panel.strip`**), `.strip-remarks`, `.strip-cell.c1.r2`, `.strip-route-line`, `.amend-box.${box}`.
- `results.dom.test.ts`: `.answer` textContent `'you said: Climb via SID✓'` (159), `'you said: (no prefix)'` (237), `'you said: correct as filed'` (245) and `.expected` text (151) break once the "you said:" / "expected:" prefixes become separate labels; `.reveal .spoken-box` + `h3` (129-131) break if the reveal heading changes element; `.answer .wrong`, `.filler`, `.spelling`, `.misplaced`, `strong.missed`, `p.remarks` survive if the run markup is kept.
- `results.test.ts`: 24 `verdictLines` / `scoreLine` assertions. Keep both functions' string output as is (the test-set summary will reuse `scoreLine`) and build the new summary and labels beside them, and these pass unchanged.
- `strip.dom.test.ts`: `.strip-route`, `.strip-full-route*` survive; `textForm.dom.test.ts` (`textarea`, `button.primary`) survives.
- `amendForm.test.ts`, `craftForm.test.ts`, `atis.test.ts`, `labels.test.ts` test data functions, not DOM, and survive if `craftGroups`, `atisRows` and `elementLabel` keep their output.

**R4. `fixtures.test.ts` reason wording.** The results redesign moves where reason and remark text render but must not rewrite them; the "Why" line reuses the existing strings.

**R5. `scaleToFit` and the ResizeObserver** assume a fixed 537 px paper; hiding columns on phone changes the paper width, so the scale must read the grid's laid-out width. The sticky rail also needs `overflow: auto`, which makes the rail (not the page) the scroll container for tall amendment rails; check `sticky` still behaves in Safari.

**R6. "Why" needs data.** The mockup's one-sentence "why" for clearance elements is written by hand. Today only strip boxes carry a `reason`; clearance elements carry remarks (`missed: "transition, direct"`, `extra words: via the`) and citation text. Shipping the design with remarks + the first citation's `text` needs no data change; a genuine plain-language why per element is a new rule concept and goes through the plan first (repo rule "Rules are data").

**R7. Collapsing correct rows hides their citations.** A student who wants to know why a correct answer was correct opens the row; make collapsed rows expandable rather than dropping the rules.

**R8. Merging full route into the answer switch** changes `Actions` (`onInput` + `onFullRoute` → one handler) and how `preferences.ts` stores are written; the hash (`i=text&r=full`) and the stores can stay as they are.

**R9. Font loading.** A Google Fonts link adds a third-party request to a static trainer; self-hosting adds a dependency. System fallback is set so a blocked font only changes the look.
