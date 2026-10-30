# Home page, accounts and first-run tour for the CRAFT trainer

## Context

Today the trainer opens straight onto a random strip. Airport, mode, answer method, filters and tests all live in the toolbar, and nothing explains the screen to a first-time student. The owner wants:

- a home page to pick the airport (remembered), the mode, and practice, timed test or untimed test;
- a link for every step (e.g. practice at KOAK in Amend, start a new KSFO clearance test, continue one);
- a first-time interactive tutorial.

The owner chose cross-device progress, which needs a server. So the app moves from GitHub Pages to the leftos.dev droplet, with an API beside it.

## Decisions (interview, 2026-10-30)

| question | answer |
|---|---|
| link scheme | path-style hash for the new pages (`#/`, `#/KOAK/amend/practice`, `#/KSFO/clearance/test/10x20`, `#/tutorial`); strip and test links keep their key=value form (`#s=…&a=…&m=amend&x=…`) unchanged |
| bare URL | always opens home, last choices preselected, with Continue for an unfinished test |
| home holds | airport, mode, practice/test (strip count and time), answer method, filters behind "More options", unfinished/finished tests list, tour link, copyable link for the session being set up |
| home layout | one page (mock lane A) |
| tutorial | coach marks over the real trainer on a fixed demo strip, each step waiting for the student's action (mock lane A) |
| cross-device | server with VATSIM Connect sign-in |
| syncs | tests, practice history, preferences |
| sign-in | optional: anyone can use it with browser storage; signing in syncs and merges what the browser holds |
| sharing | a finished test gets a read-only results link the student can send a mentor |
| API host | small Node + SQLite service on the leftos.dev droplet, behind nginx at `/craft-tester/api/` |
| app host | the static build moves to `https://leftos.dev/craft-tester/`; Pages redirects there |

Mocks: `docs/plans/canvases/home-layout/index.html`, `docs/plans/canvases/tutorial-style/index.html`.

Related, booked separately: CRAFT-27 (KOAK no-DP heading draws), CRAFT-28 (turn off runway grading; its switch belongs under home's "More options").

## What exists today (explored)

- **Routing.** `startApp` (`web/src/ui/app.ts:944`) reads `location.hash` once, builds a session and calls `mount` (`app.ts:813`). Every `update` overwrites the hash through `writeHash` (`replaceState`, `app.ts:157`). Nothing listens to `hashchange` or `popstate`, so back and forward do nothing. The hash readers in `web/src/scenario/filter.ts` split on `&`, so a `#/…` hash reads as defaults and fails nothing.
- **Stores.** `solved.ts`, `preferences.ts` and `testSet.ts` each wrap `Pick<Storage,'getItem'|'setItem'>`. None can list what it holds, the airport is never remembered, and most of their zod schemas are not exported.
- **Tests.** `app.test.ts` `mountHash` sets `location.hash` and awaits `startApp`. `browser-check.ts` passes a `#/KOAK/amend/practice` hash through unchanged.
- **Fixtures.** No fixture matches the mock's JSX2811 strip. `ws-koak-phraseology-practice-1a-swa1740` is settled clearance-mode: SWA1740 to KLAX, CNDEL SUSEY, climb via, 135.1. `ws-koak-amendment-practice-1a-jsx201` is a settled amendment fixture that is correct as filed.
- **Droplet** (`X:\dev\leftos.dev`). It runs nginx and certbot only, with no Node or systemd app.
  - `/lang-tutor/` is a `^~` `proxy_pass` location, the template for the API (`server-setup.sh:63-74`).
  - The static regex location (`:98-101`) makes `.js` and `.css` immutable for 30 days. A location with its own `add_header` loses the server-level security headers.
  - Cloudflare sits in front, so API responses need `Cache-Control: no-store`.
  - The live nginx file is not the symlink the script makes (leftos.dev `docs/plans/MAIN.md:13`).
- **Legal.** The leftos.dev privacy policy says "No cookies" (`privacy-policy.html:40`) and that YAAT1 is the only service storing personal data (`:33`). The data-protection page says data is processed in "only two places" (`:35-40`). Both need a craft-tester section, modelled on YAAT's (`privacy-policy.html:137-150`).
- **Prior art.** VATSIM Connect sign-in exists only in C# (`X:\dev\yaat-server\src\Yaat.Server\Auth\VatsimAuthService.cs`, `AuthEndpoints.cs`). It uses PKCE S256 with state, the `full_name vatsim_details` scopes and `api/user`, sets its own HttpOnly session cookie, and is tested against a stub upstream. We port the flow, not the code.
  - lang-tutor is a plain Node `server.mjs` with cookie sessions, CSRF and vitest. It is the shape to follow for the HTTP layer.

## Approach

The work comes in four milestones. M1 and M2 ship on GitHub Pages as they stand. M3 moves the app to leftos.dev and stands up the server. M4 turns on accounts.

The Linear project is "Home, tour and accounts". Its issues by step:

- M1: steps 1 to 4 are CRAFT-29 to CRAFT-32.
- M2: steps 5 to 7 are CRAFT-33 to CRAFT-35.
- M3: steps 8 and 9 are CRAFT-36 and CRAFT-37, step 10 is CRAFT-39, and step 11 is CRAFT-40. The owner's client registration is CRAFT-38, which blocks CRAFT-37 and CRAFT-39.
- M4: steps 12 and 13 are CRAFT-41 and CRAFT-42.

### M1: Router and home page (static)

1. **Router** (new `web/src/ui/router.ts`): a pure `routeOf(hash)` returns one of these routes.
   - `home`
   - `practice {icao, mode, settings}`
   - `newTest {icao, mode, n, minutes, settings}`
   - `continueTest {icao, mode, setSeed}`
   - `tutorial {part}`
   - `results {shareId}` (M4)
   - `strip`: any hash not starting with `#/`, handled by today's path, unchanged

   Optional settings ride after a `?` in the existing key=value form (`#/KSFO/clearance/test/10x20?i=text&t=night`), read by the `*FromHash` readers in `filter.ts`. An empty hash is `home`.
   - `startApp` becomes a dispatcher that routes on load and on `popstate`/`hashchange`.
   - Leaving home for a session is `pushState`, so Back returns home. In-session `writeHash` stays `replaceState`.
   - `mount` gets a teardown (the set clock interval, document listeners), so routes can swap.
   - Practice and test links rewrite to today's `#s=…` and `x=…` forms once the session starts, so a strip link stays what it is now.
2. **Store listing.** `SetStore` gains `list()`, which widens its storage pick to `length`/`key` and parses the base-36 seed back out of each `craft-tester:set:` key.
   - A new `HomeStore` in `preferences.ts` remembers the airport, mode, format, test size and time.
   - Export the stored-value zod schemas from `solved.ts`, `preferences.ts` and `testSet.ts`. M3 reuses them as the API's wire format.
3. **Home page** (new `web/src/ui/home.ts`), as mock lane A:
   - the Continue banner;
   - airport, mode and format cards;
   - strips and time when Test is chosen;
   - Answer by;
   - "More options" holding the time and configuration filters;
   - Start;
   - the live link with Copy, written as `#/…`;
   - "Your tests" from `SetStore.list()`, with Continue or Results;
   - "Take the tour".

   Phone and desktop layouts use the tokens in `styles.css`.
4. **Trainer changes.**
   - The brand becomes a Home link.
   - The Test popover's Start and the set summary's buttons gain "Home".
   - The toolbar keeps its airport, mode and answer switches.
   - `onAirport` and `onMode` save to `HomeStore`, so home reopens on what the student last used.

### M2: First-run tour (coach marks)

5. **Fixed scenario sessions.**
   - Add `newSessionFrom(airport, scenario, …)` beside `newSession` (`state.ts:368`), so a session can run on a given `Scenario` rather than a seed.
   - The tour imports the two fixtures above through a new `@fixtures` alias (in `vite.config.ts` and `tsconfig.json`), passed through `withCurrentVersions` (`rules/fixtureVersions.ts`) so an AIRAC cycle never breaks it.
   - The tour's expected picks come from the fixture's settled `expected`, never from hand-written text.
6. **Coach-mark engine** (new `web/src/ui/tour.ts`). It draws a spotlight and a card over a `data-tour` anchor.
   - Each step is data: `{anchor, title, body, advance: 'next' | {pick: PickKey} | 'submit'}`.
   - A wrong pick shows why it is wrong, using the same `reason` and `wordDiff` the results view uses.
   - It offers Back, Skip and Next, keyboard focus, and Escape to exit.
   - On a phone the card sits above or below the anchor, whichever side has room.
7. **Tour content.**
   - The clearance part runs over KOAK `swa1740`: the strip, the ATIS, then C, R procedure, R route, A, the expect clause, F, T, expect runway, Submit, and the results.
   - The Amend part runs over `jsx201`: the three boxes, "correct as filed", and the carry-on into the clearance.
   - A last step covers home's Test card.
   - `#/tutorial` and `#/tutorial/amend` start each part. The tour opens itself on a first visit to home, with no hash and `tourSeen` unset, and Skip or Finish sets `tourSeen`.

### M3: Server and the move to leftos.dev

8. **New `server/` half** (Node 24, TypeScript, pnpm, oxlint, oxfmt and vitest, matching `web/`).
   - It uses plain `node:http` and the built-in `node:sqlite`, with `zod` shared from `web/src` through an alias. That adds no new runtime dependency beyond zod.
   - Endpoints, all under `/craft-tester/api/`:
     - `GET /auth/login`
     - `GET /auth/callback`
     - `POST /auth/logout`
     - `GET /me`
     - `GET` and `PUT /docs/:kind/:key`
     - `GET /docs/:kind?since=` (`kind` is one of `solved`, `set`, `pref`)
     - `POST /shares`
     - `GET /shares/:id`
   - The schema has three tables:
     - `users(cid, name, created)`
     - `docs(cid, kind, key, json, updated_at)`
     - `shares(id, cid, set_key, snapshot_json, created)`
   - Each `PUT` validates its body with the exported web schema for its `kind`. `updated_at` comes from the server, and the last write wins.
9. **VATSIM Connect**, ported from yaat-server: PKCE S256, a state cookie, scopes `full_name vatsim_details`, and a `GET api/user` call.
   - The session is a random id in an HttpOnly, Secure, SameSite=Lax cookie scoped to `/craft-tester/`, stored server-side. The VATSIM access token is not kept.
   - Mutating requests need an `X-Craft-CSRF` header the page echoes from `/me`.
   - Tests run the whole flow against a stub upstream, as yaat-server's `VatsimAuthServiceTests` do.
   - VATSIM's dev sandbox serves local development.
10. **Droplet** (outward-facing, so each step is confirmed with you as it runs):
    - Node 24 LTS.
    - A `craft-tester-api` systemd unit running as its own user and bound to `127.0.0.1:8787`, with its database at `/var/lib/craft-tester/craft.db`.
    - A nightly `sqlite3 .backup` with 14 copies kept.
    - Secrets in `/etc/craft-tester/env`, copied from `G:\My Drive\Private Config\craft-tester\secrets\server\.env` with `dotenv-keys ssh-set`, never through the context.
    - nginx gets `location ^~ /craft-tester/api/` (`proxy_pass`, the forwarded headers, `no-store`), and a `/craft-tester/` static location that restates the security headers.
    - The nginx, legal-page and homepage-card edits belong to the leftos.dev repo, so they go to its inbox as one request (`cross-repo-coordination`).
11. **Deploy**: new `tools/deploy.ps1` and `tools/deploy.sh` in this repo. They build `web/` and `server/`, then tar over ssh with the host key pinned in leftos.dev's `deploy-known-hosts`.
    - The web build goes to `/var/www/leftos.dev/craft-tester/`, with old hashed assets cleared first.
    - The server goes to `/opt/craft-tester/`, followed by `pnpm install --prod` and a unit restart.
    - `pages.yml` is replaced by a one-file Pages site that sends any old URL to `https://leftos.dev/craft-tester/` with its hash kept.
    - A `deploy.yml` workflow is not in scope; deploys run by hand at checkpoints.

### M4: Accounts in the app

12. **Sync layer** (new `web/src/ui/sync.ts`): every store stays local-first.
    - When signed in, each `save` also queues a `PUT`, retrying with backoff and holding a queue in localStorage while offline.
    - On sign-in, the app pulls every doc, merges by key (the newer `updated_at` wins, and a set keeps the union of answered strips), then pushes what only the browser held.
    - Sign-out keeps local data.
13. **Signed-in UI.**
    - "Sign in with VATSIM" and the CID with Sign out sit on home and in the toolbar.
    - "Your tests" reads the server list.
    - A finished test's summary gains "Share results". It posts a snapshot (the set record plus each strip's attempt) and copies `…/#/results/<id>`.
    - That route renders the summary read-only with `setSummary` and `renderSetSummary`, with no account needed to view it.

### Docs, plan and glossary (with the work)

- `docs/ARCHITECTURE.md`:
  - a "Server" half;
  - routes and the router in the Web table;
  - the hosting decision in "Why it is built this way";
  - Task Index rows for "change routing or page load" and "add a synced store".
- `CLAUDE.md`: the new server commands, the deploy command, and the leftos.dev URL in place of Pages.
- `docs/GLOSSARY.md`: coach mark, home, share link, synced store.
- Book in Linear: one project, "Home, tour and accounts", with milestones M1 to M4 and one issue per numbered step above.
  - `branch: feat/home-tour` covers M1 and M2, and `feat/accounts` covers M3 and M4.
  - Commit the two mocks with their screenshots (`docs/plans/canvases/home-layout/`, `docs/plans/canvases/tutorial-style/`, about 150 KB) in the plan commit.

### Needed from you, before M3

- Register a VATSIM Connect OAuth client, with callback `https://leftos.dev/craft-tester/api/auth/callback`, and a dev-sandbox client for local runs. Put both in `G:\My Drive\Private Config\craft-tester\secrets\server\.env`.
- Say yes, when asked during M3, to each droplet change: installing Node, the unit, nginx, the first deploy.

## Verification

- **M1**
  - Unit tests: `routeOf` over every route, including malformed paths and legacy hashes; `SetStore.list` over a Map-backed storage; `HomeStore`.
  - `app.test.ts`: `mountHash('#/')` renders home; `#/KOAK/amend/practice` lands on a strip whose hash is `#s=…&a=KOAK&m=amend`; Back after a pushState returns home; an old `#s=…` link renders exactly as before.
  - `check:browser` on `phone` and `desktop`: home, a practice deep link, a test deep link, and Continue.
  - Then the web gates: `pnpm -C web lint && pnpm -C web fmt:check && pnpm -C web typecheck && pnpm -C web test`.
- **M2**
  - A DOM test walks the whole clearance tour on `swa1740`, picking the fixture's expected values. Each step advances, a wrong pick does not, and Skip sets `tourSeen`.
  - `check:browser` shots of steps 1 and 4 on phone and desktop, compared against the approved mock.
- **M3**
  - `pnpm -C server test` covers the OAuth flow against the stub, the session cookie flags, CSRF refusal, schema refusal of a bad doc, last-write-wins, and the share snapshot and read.
  - On the droplet: `curl -I` checks headers and `no-store` on `/craft-tester/api/me`. The old Pages URL redirects with its hash.
- **M4**
  - Unit tests for the merge rules and the offline queue.
  - By hand on two browsers with the sandbox client: start a test signed in on one, then Continue on the other at the same strip. Share a finished test, and open the link signed out.
