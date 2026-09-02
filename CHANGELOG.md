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
- Agent guardrails: 28 write-time gates and a 7-stage Stop chain covering branch protection, secrets, the Tauri capability surface, debt markers, comment language and the CHANGELOG duty
- A Claude Code statusline showing branch, dirty-file count, context usage, rate-limit pace and session duration
- Choose the repository to read: pick a recent one, scan the folders you add, or open one through the native folder dialog
- The overview shows the opened repository's real totals and its newest commits with their line counts

### Changed
- The app opens with the repository picker instead of the scaffold status page
- The window opens at 1200×800 and cannot shrink below 900×600, so the repository picker has room


## [0.1.0] - 2026-08-22

### Added

- First desktop build: a Git client on Tauri 2, React 19 and Vite, with the
  Tablinum mark and its generated icon set.
