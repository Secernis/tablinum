# Debt markers

Enforced by: `todo-tags` (write time), the `todo-tags` sensor (verify).

## Why a grammar

An untagged marker is a note to nobody. It carries no kind, no owner and no
expiry, so it survives every cleanup pass by default — and the file of them only
ever grows. After a year nobody can tell which ones still matter, so none of them
get read, so all of them stay.

A tag forces the writer to say WHICH KIND of debt this is. The date-bearing kinds
force a decision by a deadline instead of at nobody's convenience.

```
TODO(<tag>): text
TODO(<tag>, YYYY-MM-DD): text
```

## The tags

| Tag | Means | Date | Blocks a release |
| --- | --- | --- | --- |
| `production` | must be resolved before this ships to users | optional | yes |
| `security` | a known weakness | **required** | yes |
| `legal` | licence, trademark or compliance follow-up | optional | yes |
| `bug` | a known defect with a workaround in place | optional | no |
| `hack` | a deliberate shortcut, kept honest by being named | optional | no |
| `perf` | a known slow path | optional | no |
| `feature` | planned work | **required**, max +90 days | no |

A date already in the past is a violation, not a note: the deadline passed, so
the marker is overdue rather than planned. That is the point — it comes back and
asks.

## The keyword is uppercase

Uppercase, never lowercase or mixed. One spelling, or the lowercase form becomes
the escape hatch that empties the rule and the sweep can no longer count the debt
it exists to track.

`FIXME`, `XXX`, `HACK` and `TBD` are refused outright. They are the same thing
with less information: write the tagged form and say which kind it is.

## Writing a good one

The text answers *what would have to be true to remove this*, not *what is
missing*.

| | |
| --- | --- |
| Good | `TODO(hack): re-parses the whole status output per keystroke; fine under 500 files, replace with an incremental parser if that stops holding` |
| Bad | `TODO(hack): optimise later` |
| Good | `TODO(security, 2026-11-01): the repo path is not validated before being handed to the git process` |
| Bad | `TODO(security, 2026-11-01): security` |

## Where it does not apply

Generated output, dependency trees, vendored code, and `.claude/**` — the rule
documents describe the grammar, several of them by showing what it refuses.

The pattern only matches a marker in marker POSITION: followed by `:` or `(`, or
standing as the first word of a comment. A bare mention mid-sentence is the word,
not a marker — which is why this page can discuss it at all.
