---
name: craft-tester-nextup
description: Profile for the user-level `nextup` skill in the craft-tester repo — loaded by `nextup` at its step 0 for this project's plan order. Not a loop of its own; invoke `/nextup`.
---

# craft-tester profile for `nextup`

The generic loop is the user-level `nextup` skill; this file supplies only what is craft-tester-specific.

siblings: none
linear: craft-tester

## Plan and tracker

- The plan lives in Linear: every task is a Linear issue in team CRAFT, per `~/.claude/docs/plan-operations.md`; `docs/plans/MAIN.md` is its generated snapshot, never edited by hand. Project order, which is the order the queue is worked: `Airway structure for conventional rebuilds`, `Destination amendment box`, `KSFO worksheet settlement`, `What-if variants`, `Singles`, `Cleanup`. A design for open work stays in `docs/plans/<name>.md`, linked from its project's content.
- A steer or a finding the item does not fix gets an **add**, in the project whose files it shares, else in `Singles`.
- Tracker: **triage** as plan-operations says (GitHub issues reach the team through Linear's sync; an untriaged one is top-level with no project), each placed in the project that shares its files, else in `Singles`; a Dependabot PR goes to `Cleanup`.
- Commands, gates and the rules a contributor would break are in `CLAUDE.md`. Land by commit and push on `main`.
