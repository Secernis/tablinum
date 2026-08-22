# Tablinum

A Git client for the desktop: Tauri 2, React 19, Vite, TypeScript, Rust.

The detailed standards live in [`.claude/rules/`](.claude/rules/), one topic per
directory, and most of them are enforced by a hook in `.claude/hooks/` that
refuses the edit rather than reporting it later. This file is the short version:
the flow, the surfaces, and where to look when something blocks you.

## Language

Chat, explanations and commit bodies in **German**. Code, identifiers, comments,
commit subjects and CHANGELOG entries in **English**. Technical terms keep their
original form inside German sentences.

## The flow

```
npm run branch -- <name>       open a feature branch (nothing is committed on main)
npm run verify -- --files ...  the one gate: types, secrets, markers, changelog, versions
npm run changelog -- --added   document it while you still know what it means
npm run commit -- --inspect    what is dirty, grouped
npm run commit -- --files <path...> --type <type> --message "..." --yes
npm run push                   verify, then push
node scripts/release.mjs <version> --run
```

Raw `git commit`, `git push` and `git tag` are blocked. Each script does
something the bare command cannot, and the raw version produces a result that
looks identical having skipped all of it.

## A commit is one reason to revert

Four tests, all of which have to hold:

1. One reason — exactly one decision, fix or feature
2. The subject needs no "and"
3. Every touched file follows from that one reason
4. It stands on its own: compiles, verifies, no half-migration

Several separate pieces of work is not a reason to wait — one atomic commit per
piece.

## The CHANGELOG is written as work lands

Not at release time. A changelog written from `git log` answers "what changed in
the code"; this one answers "what changed for the person using the app", and only
the person who made the change can write that.

`npm run changelog -- --none "..."` is a real answer for a refactor or a test.
Never hand-write a version heading — `npm run release` owns those, because it
also writes the number into three other files.

## Protected surfaces

Five surfaces are closed to agent edits. The user opens a 30-minute window from
their own terminal:

| Surface | What it covers | Unlock |
| --- | --- | --- |
| `rules` | `CLAUDE.md`, `.claude/rules/**` | `node .claude/hooks/tab-unlock-rules.cjs` |
| `design` | `DESIGN.md` | `node .claude/hooks/tab-unlock-design.cjs` |
| `hooks` | `.claude/hooks/**` | `node .claude/hooks/tab-unlock-hooks.cjs` |
| `brand` | `src/lib/brand/`, `src/brand.css`, `public/`, `src-tauri/icons/` | `node .claude/hooks/tab-unlock-brand.cjs` |
| `configs` | tsconfig, vite/tauri config, capabilities, settings | `node .claude/hooks/tab-unlock-configs.cjs` |

Ask for the window and say what you want to change and why. Running the unlock
yourself is the same as there being no lock.

There is one further user-run confirmation, for a different question:

```
node .claude/hooks/tab-confirm-commit.cjs
```

It authorises ONE commit to include paths the edit tracker cannot vouch for —
files written through a script or a shell redirect, or before the hooks were
live. Single-use and valid for ten minutes. Ask for it only after saying WHICH
paths and WHY; running it yourself defeats the gate it belongs to.

## When a gate blocks you

The block says *what*, in one line. The rule in `.claude/rules/` says *why*, and
it is the thing to read when the block does not obviously make sense.

If the rule is wrong, say so — that is a real outcome, and changing the standard
is better than working around it. What is never right is finding the spelling
that gets past the gate.

After touching anything under `.claude/hooks/`, run the end-to-end suite:

```
node .claude/hooks/gate-smoke.test.cjs
```

`npm run verify -- --all` runs it too, so a gate layer that stopped gating cannot
reach a push or a release.

## Known limits of the enforcement layer

Stated because a guard whose gaps are undocumented reads as stronger than it is:

- **Bash writes are not gated.** The content rules see `Edit`, `MultiEdit` and
  `Write`. A file written through a shell redirect or a script bypasses all of
  them, including `surface-protect`.
- **The edit tracker starts when the hooks do.** Session ownership is recorded
  from the first tool call under a live hook configuration, so files written
  before that are invisible to the commit and changelog reminders — and get
  reported as belonging to someone else.
- **Reminders fire once per Stop chain.** After a block the agent has decided; a
  second one would trap the turn. They are prompts, not walls.
- **`secret-read` covers files, not the environment.** `env` and `printenv` are
  out of scope, and a script that reads `.env` internally is invisible from
  outside. The write prohibition is the load-bearing half.
