# The CHANGELOG

Enforced by: `changelog-awareness`, `changelog-version-heading`,
`changelog-currency` (Stop), `changelog-schema` (verify).

## What it is for

A changelog written at release time is written from `git log`. A git log answers
**what changed in the code**. A changelog answers **what changed for the person
using the app**. Those are different documents, and only the second one is worth
reading.

The second one can only be written by whoever made the change, on the day they
made it. Every week that passes turns a real entry into a reworded commit
subject, because the reason is gone and only the diff is left.

So: write it as work lands.

```
npm run changelog -- --added   "Repository list shows the current branch"
npm run changelog -- --fixed   "Cloning over SSH no longer fails when the key has a passphrase"
npm run changelog -- --changed | --removed | --deprecated | --security
npm run changelog -- --pending
```

## Writing an entry

From the user's side, in English, one line per user-visible change.

| | |
| --- | --- |
| Good | `Cloning over SSH no longer fails when the key has a passphrase` |
| Bad | `refactor ssh auth handler` |
| Good | `The diff view keeps its scroll position when you switch files` |
| Bad | `fix: scroll state in DiffPane` |

The test: could someone who has never seen this codebase tell, from the entry
alone, whether the new version does something for them? If the answer needs the
diff, the entry is a commit subject wearing a bullet point.

## The six categories

Keep a Changelog, and the set is closed. A free-text category is how a changelog
degenerates into a commit log with headings.

| Category | What goes in it |
| --- | --- |
| `Added` | A capability the user did not have before |
| `Changed` | Existing behaviour that now works differently |
| `Deprecated` | Still works, is going away, here is what to use instead |
| `Removed` | Gone |
| `Fixed` | A defect the user could hit |
| `Security` | A weakness that was closed |

`Added` and `Deprecated` imply at least a MINOR release. Everything else is a
PATCH unless a human says otherwise — a breaking change is a judgement about the
product's contract with its users, and no heuristic over category names is
entitled to make it.

## Version headings belong to the release

Never hand-write a version heading. The number is only known once
`npm run release` has decided it — from the pending entries and the bump they
imply — and the same run writes it into `package.json`,
`src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.

A hand-picked heading claims a release nothing backs and puts four files out of
sync. Nothing fails: the file still parses, the number still looks plausible, and
the app reports a version that matches no tag. It is discovered by someone trying
to reproduce a bug from a version that never coherently existed.

Removing or reformatting an existing heading stays free.

## Nothing to say is a real answer

A refactor, a test, a build fix — genuinely nothing a user would notice. Saying
so is a decision, not an omission:

```
npm run changelog -- --none "internal refactor of the git status parser"
```

It records the declaration for the session, so the Stop-time reminder can tell
"considered and declined" from "forgotten". What it is not is a way past the
reminder — if the change turns out to be user-visible after all, add the entry.

## Shape

```
# Changelog

## [Unreleased]

### Added
- ...

## [0.2.0] - 2026-08-22        <- written by the release, never by hand

### Fixed
- ...
```

`# Changelog` at the top. An Unreleased section always present. Version headings
carry their release date, descend newest-first, and appear once each. Categories
in canonical order, never empty.

`npm run verify` checks all of it, because the release cut reads this file — a
shape it cannot parse is a release it cannot describe.
