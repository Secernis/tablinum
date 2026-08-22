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

```
npm run unlock -- hooks rules      open both
npm run unlock -- all              open everything
npm run unlock -- --close hooks    close one
npm run unlock                     what is open right now
```

| Surface | What it covers |
| --- | --- |
| `rules` | `CLAUDE.md`, `.claude/rules/**` |
| `design` | `DESIGN.md` |
| `hooks` | `.claude/hooks/**` |
| `brand` | `src/lib/brand/`, `src/brand.css`, `public/`, `src-tauri/icons/` |
| `configs` | tsconfig, vite/tauri config, capabilities, settings |

Ask for the window and make the ask answerable: name the surface, the file, and
what you want to change about it. Running the unlock yourself is refused
(`unlock-channel`) — a guard the guarded party can lift is not a guard. Reading
the state (`npm run unlock` with no arguments) stays open to you, so ask for the
right thing rather than guessing.

Committing needs no window. It is guided rather than gated: the only refusal is
`-A` / `--all`, because naming the paths is the act of deciding what the commit
is.

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
  them, including `surface-protect` — and including a hand-forged unlock flag
  under `.claude/hooks/state/`. `unlock-channel` guards the unlock COMMAND; it
  cannot guard every way of writing a file.
- **The edit tracker starts when the hooks do, and never sees a script's
  writes.** Ownership is recorded from `Edit`/`MultiEdit`/`Write` under a live
  hook configuration. Files outside that are absent from the record for reasons
  that say nothing about who wrote them, which is why nothing gates on it.
- **Reminders fire once per Stop chain.** After a block the agent has decided; a
  second one would trap the turn. They are prompts, not walls.
- **`secret-read` covers files, not the environment.** `env` and `printenv` are
  out of scope, and a script that reads `.env` internally is invisible from
  outside. The write prohibition is the load-bearing half.
