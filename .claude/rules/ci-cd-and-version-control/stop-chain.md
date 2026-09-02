# The Stop chain

Enforced by: `auto-verify`, `auto-clippy`, `auto-cargotest`, then
`web-marker-guard`, `language-guard`, `changelog-currency` and
`commit-reminder`, in that order.

## Why the end of a turn is a gate

The write-time gates judge one edit at a time. Some questions only have an
answer once the turn is over: does the tree still typecheck, does the Rust side
still lint, has the user-visible change been written down, is the verified work
committed. The Stop hook is where those are asked, because it is the last
moment at which the session still holds the context to answer them.

The chain runs sequentially and short-circuits on the first block. The order is
the contract:

| Rule | Fires when | Asks |
| --- | --- | --- |
| `auto-verify` | this session edited files | does `npm run verify` pass over them |
| `auto-clippy` | a `.rs` file moved | does clippy pass with `-D warnings` |
| `auto-cargotest` | a `.rs` file moved | do the unit tests pass (`--lib --bins`) |
| `web-marker-guard` | a web tool ran | does the reply name its source |
| `language-guard` | the reply has enough prose | is it German |
| `changelog-currency` | the change is user-visible | is there an Unreleased entry |
| `commit-reminder` | verified work is uncommitted | has it been committed |

`auto-verify` is first because everything after it assumes the tree is worth
acting on — a commit nudge on code that does not typecheck is worse than no
nudge. `commit-reminder` is last because its whole meaning is "everything
before me passed".

## The three automatic runs

They are scoped, not full. `auto-verify` passes the session's own edited files
to the verify script, so the cost is proportional to what changed rather than to
the size of the repository. On a green run the tracker is consumed, and the next
Stop verifies only what moved since.

The cargo rules pay their tens of seconds only when Rust actually changed;
on every other turn they cost one set lookup. Clippy runs before the tests
because a lint failure is cheaper to read and more specific than a test failure
caused by the same mistake, and the two serialise on the cargo target lock in
any case, so the order costs no wall-clock.

`-D warnings` is deliberate. A clippy warning that does not fail is a warning
nobody reads; the count grows until the tool is noise. Zero is the only number
that stays honest.

`--lib --bins` is deliberate too. Integration tests that launch a webview cannot
run unattended on every Stop, and a gate that is skipped when it is inconvenient
reports green for the wrong reason.

## Fail open on infrastructure, closed on findings

A verify run that cannot start — node missing, script missing, timeout — reports
`INCONCLUSIVE` and lets the Stop through. A run that starts and finds something
blocks. "The check did not run" and "the check passed" are the two outcomes that
must never look alike, and the telemetry keeps them apart even where the verdict
does not.

## Once per chain

After a block the Stop hook fires again with `stop_hook_active` set, and every
rule stands down. The agent has already been told; a second block would trap the
turn. The reminders are prompts, not walls.
