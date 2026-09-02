# Changelog

Everything worth telling someone who uses Tablinum, newest first.

This file is written **as work lands**, not at release time. A changelog written
from `git log` answers "what changed in the code"; this one answers "what changed
for the person using the app". Only the second is worth reading, and only the
person making the change can write it.

Add an entry with `npm run changelog -- --added "..."` (or `--changed`,
`--deprecated`, `--removed`, `--fixed`, `--security`). Version headings are
written by `npm run release` alone — it is the only place the number is known,
because it also writes it into `package.json`, `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml` in the same step.

The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
versioning is [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A commit, push and release flow that runs from `npm`: `npm run branch`,
  `npm run commit`, `npm run push`, `npm run release`, plus `npm run verify` as
  the single gate all of them share.
- `npm run changelog` for recording a change the moment it is made.
- Agent guardrails: 29 write-time gates and a 7-stage Stop chain covering branch protection, secrets, the Tauri capability surface, debt markers, comment language and the CHANGELOG duty
- A Claude Code statusline showing branch, dirty-file count, context usage, rate-limit pace and session duration
- Choose the repository to read: pick a recent one, scan the folders you add, or open one through the native folder dialog
- The overview shows the opened repository's real totals and its newest commits with their line counts
- Each repository on the start page shows its commit count, lines of code, file count and a language bar
- The overview shows the languages with their share of the code and the authors with their share of the commits

### Changed
- The app opens with the repository picker instead of the scaffold status page
- The window opens at 1200×800 and cannot shrink below 900×600, so the repository picker has room
- Every page has a title bar with its actions on the right; the content sits as cards on the canvas
- The start page is one list of the repositories you added, by folder or one at a time, newest commit first; skeleton rows show while a scan runs
- Cards and the title bar carry a subtle glass material with tinted depth, in both themes
- The overview's commit table shows five commits at a time, loads five more per click, and shows the net line change per commit in colour

### Fixed
- Dates, relative times and numbers render in English regardless of the system language



## [0.1.0] - 2026-08-22

### Added

- First desktop build: a Git client on Tauri 2, React 19 and Vite, with the
  Tablinum mark and its generated icon set.
