# Branch, commit, push

Enforced by: `branch-protection`, `branch-create-guard`, `bash-gates`,
`commit-explicit-paths`, `commit-scope`, `commit-reminder` (Stop). The rest of
the Stop chain is described in [stop-chain.md](stop-chain.md).

## Nothing is committed on `main`

`main` is what a release is cut from and what a clone lands on. Work done
directly on it has no reviewable boundary, cannot be abandoned without rewriting
history, and turns every "let me just try something" into a change to the
published line.

```
npm run branch -- add-ssh-support     →  feat/add-ssh-support
npm run branch -- --list              what exists, and how far each has drifted
```

Uncommitted work comes along when the branch is created — which is usually what
you want, because the branch is normally opened once the work has already
started.

Exempt on any branch: `CLAUDE.md`, `.claude/**`, `memory/**`. Those configure the
tooling; they do not ship.

## One branch at a time

Branches are cheap to create and expensive to finish. Six half-done branches are
six things that each need rebasing against a moving `main`, six sets of context
to reload, and no way to tell which was abandoned. The cost is not the branch, it
is the accumulated decision debt.

Finish, merge, or explicitly abandon the current one before opening the next.
That takes seconds while the context is still loaded and an afternoon once it is
not.

## A commit is one reason to revert

All four tests have to hold. They are one idea from four angles, and a commit
that fails any of them fails the others too:

1. **One reason.** Exactly one decision, fix or feature.
2. **No conjunction.** If the subject needs "and" to describe it, it is two
   commits.
3. **Bounded blast radius.** Every touched file follows from that one reason.
4. **It stands on its own.** Compiles, verifies, no half-migration.

The test that matters is the revert. A commit bundling two changes cannot be
reverted for one of them — undoing the mistake takes the good change with it, and
that is discovered under time pressure, months later, by someone who was not
there.

```
npm run commit -- --inspect
npm run commit -- --files <path...> --type <type> --scope <name> --message "..." --yes
npm run commit -- --files ... --dry-run
```

### `type(scope): title`, always

Types: `feat` `fix` `perf` `refactor` `revert` `docs` `test` `chore` `ci`
`build` `style`. The type is what a reader trusts to decide whether a commit
could have broken something, so a `feat` whose diff is only documentation is
refused.

The scope is **required**. It names which part of the system the commit touches,
and it is the field someone filters on months later while hunting the change that
broke one area. A history where only some commits carry one cannot be filtered at
all, because a missing scope and a different area look identical.

It was optional in the first version of this script, and the first commit the
channel produced is the argument against that: `chore: add the agent guardrail
layer` — correct in form, passing every other check, and naming no part of the
system.

The vocabulary is not a fixed list. `npm run commit -- --inspect` shows the
scopes the repository already uses, and a new one is allowed with a one-line
notice — enough for the author to notice they are inventing a synonym for
something that already has a name.

Subjects are English, imperative, lowercase, no trailing period, under 72
characters. Bodies are optional and worth writing for `feat` `fix` `perf`
`refactor` `revert`, where the reason cannot be reconstructed from the diff; they
may be German — they explain, and explanation is for whoever is here.

**Several separate pieces of work is not a reason to wait.** Make one atomic
commit per piece. Only genuinely half-finished work is left behind, and then say
which part and why.

## Commit only what you changed

The working tree can hold changes from more than one source: a parallel session,
the user's own editor, a generator. `git add -A` sweeps them all in, and the
result is a commit whose message describes one change and whose diff contains
three — attributed to whoever ran the command.

Files are named explicitly and staged one at a time. `-A` and `--all` are
refused — that is the only refusal on this path, and it is there because naming
the paths IS the act of deciding what the commit is.

### The index counts too

`git commit` takes the whole index, not just what the call named. So a file
staged earlier — by a `git add` from an unrelated moment — would ride along
inside a commit whose message describes something else.

`npm run commit` refuses that, naming the staged files it did not expect. It
deliberately does **not** reset the index: a staging decision someone made on
purpose is not the script's to discard. Add them to `--files` if they belong, or
`git restore --staged <path>` if they do not.

### What is guided rather than gated

Ownership is not enforced. An earlier version of this rule refused any path the
session's edit tracker could not vouch for, and it was removed on 2026-08-22.

The tracker sees `Edit`, `MultiEdit` and `Write` — not a file written by a
script, not a shell redirect, not anything from before the hooks were live. It
therefore called a large share of perfectly ordinary work "foreign" and needed a
confirmation ceremony to undo its own blind spot. A gate whose false positives
outnumber its catches teaches people to route around it, and that costs more than
the case it was built for.

What replaced it asks a question that can actually be answered: not *who wrote
this file*, but *what is about to end up in this commit*.

The Stop reminder still reports files outside the edit record, and says only
that — it no longer claims they belong to someone else.

## Push once it is green

```
npm run push
```

Runs the full verify gate, then pushes. The point at which code leaves the
machine is the last point at which a problem is still cheap; after that it is in
someone else's clone and someone else's CI.

A green verdict is stored against the commit sha for four hours, so a push that
fails in transport does not pay for the gate twice. Its price: a dirty tree is
refused rather than warned about, because the verdict describes a commit and
uncommitted changes are not in one.

`--skip-checks` exists, prints exactly what it skipped, and is not a normal
answer.

## Destructive commands are the user's

`git reset --hard`, `git clean -fdx`, `git push --force`, `rm -rf`, history
rewriting. These destroy work that has no other copy. They are not forbidden —
they belong to the person who can see what is about to disappear.

Say what you would run and why, and let them decide. If the goal was a clean
state: `git stash` keeps the work, `git restore <path>` is scoped to one file.

## `--no-verify` is never the answer

A failing check is information. If it is right, fix what it found; if it is
wrong, fix the check. Both are cheaper than a commit that quietly did not pass,
because the second one is discovered by whoever trusted the green.
