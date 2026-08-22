# Rules

The standards this repository holds itself to, one topic per directory.

These are not style preferences. Each one exists because the alternative has a
cost that is paid later and by someone else — and each one that can be checked
mechanically **is** checked, by a hook in `.claude/hooks/` that refuses the edit
at the moment it is made rather than reporting it in a review three days later.

The split between the two is deliberate:

- The **rule** says *why*. It is the thing to read when a gate blocks you and the
  block does not obviously make sense, and the thing to change when the standard
  itself is wrong.
- The **gate** says *what*, in one line, at the moment it matters. It has no room
  for reasoning and does not try.

A gate that fires and a rule that explains it are the same decision at two
different distances. Where they disagree, the rule is right and the gate is a
bug.

## Topics

| Topic | What it covers |
| --- | --- |
| [architecture](architecture/) | Generated output versus authored source |
| [ci-cd-and-version-control](ci-cd-and-version-control/) | Branches, commits, pushes — the whole flow |
| [code-quality](code-quality/) | Comment language, debt markers, module structure, suppressions |
| [documentation](documentation/) | The CHANGELOG, README and docblocks |
| [error-tracking-and-logs](error-tracking-and-logs/) | Where logging goes and why not the console |
| [frontend](frontend/) | The shipping UI: real data, one icon set |
| [release-versioning](release-versioning/) | What a release is, and the five things that must agree |
| [security](security/) | Secrets, the Tauri surface, failing closed |

## Changing a rule

`.claude/rules/` is a protected surface: agent edits are refused unless the user
opens the window (`npm run unlock -- rules`, 30 minutes; several surfaces at once
is one command).

That is not because the rules are sacred. It is because a rule and the gate that
enforces it are one decision in two places, and an agent that can quietly relax
the first has dissolved the second without anything appearing to have happened.
Changing a standard is a decision worth making deliberately and out loud.
