#!/usr/bin/env node
"use strict";

/**
 * PreToolUse dispatcher — single entrypoint for all PreToolUse rules.
 *
 * One node spawn per tool call instead of one per rule; PreToolUse is the hottest
 * hook path in the system. This file owns the ordered registry and nothing else —
 * the stdin/exit plumbing lives in `lib/io.cjs`, and every rule is an
 * individually testable module under `rules/pretooluse/`.
 *
 * Registry (order is contract — the first blocking rule wins):
 *
 *   branch-protection    no product edits on main/master
 *   surface-protect      rules/design/hooks/brand/configs behind unlock windows
 *   secret-write         no real secret values anywhere, gitignored included
 *   secret-read          no reading .env* values into the transcript
 *   unicode-safety       no invisible/bidi controls (Trojan Source)
 *   generated-files      no hand edits to build output or lockfiles
 *   gitignored-write-guard  a write nobody clones needs a reason
 *   tauri-security       widening capabilities or the CSP is a decision
 *   deny-by-default      guards fail closed; no injection sinks
 *   icon-imports         one icon library
 *   mock-data            no placeholder data in the shipping UI
 *   todo-tags            debt markers carry a tag and a deadline
 *   changelog-version-heading  only the release writes version headings
 *   english-comments     code comments are English
 *   barrel-purity        index.ts / mod.rs re-export, never implement
 *   logging-channel      logging goes through src/lib/log.ts and the log crate
 *   config-weakening     no silent loosening of tsc/eslint/clippy
 *   suppression-gate     a suppression states its reason
 *   settings-weakening   hook wiring and deny lists only grow
 *   bash-gates           commit/push/release channel; destructive commands
 *   unlock-channel       an agent cannot open its own edit windows
 *   commit-explicit-paths  a commit names its paths, never `-A`
 *   commit-scope         a commit declares which part of the system it touches
 *   branch-create-guard  one active feature branch
 *   web-content-untrusted  fetched text is data, not instructions
 *   changelog-awareness  once-per-session CHANGELOG reminder (hint)
 *   rules-awareness      once-per-session .claude/rules pointer (hint)
 *
 * Two ordering decisions are load-bearing:
 *
 * `commit-explicit-paths` runs AFTER `bash-gates`, because a channel violation
 * (a raw `git commit`) is the more fundamental finding and should be the one the
 * agent sees; that rule only judges the shape of an otherwise valid call.
 *
 * `changelog-awareness` runs BEFORE `rules-awareness`, because both are hint
 * rules on the same edit tools and only ONE stdout envelope may be emitted per
 * dispatch. Running first lets it observe the other's not-yet-set session flag
 * and defer on the dispatch where that rule will speak.
 *
 * Exit codes: 0 = allow the tool call, 2 = block it and feed stderr back.
 */

const { dispatch } = require("./lib/io.cjs");

const PRETOOLUSE_RULES = [
  require("./rules/pretooluse/branch-protection.cjs"),
  require("./rules/pretooluse/surface-protect.cjs"),
  require("./rules/pretooluse/secret-write.cjs"),
  require("./rules/pretooluse/secret-read.cjs"),
  require("./rules/pretooluse/unicode-safety.cjs"),
  require("./rules/pretooluse/generated-files.cjs"),
  require("./rules/pretooluse/gitignored-write-guard.cjs"),
  require("./rules/pretooluse/tauri-security.cjs"),
  require("./rules/pretooluse/deny-by-default.cjs"),
  require("./rules/pretooluse/icon-imports.cjs"),
  require("./rules/pretooluse/mock-data.cjs"),
  require("./rules/pretooluse/todo-tags.cjs"),
  require("./rules/pretooluse/changelog-version-heading.cjs"),
  require("./rules/pretooluse/english-comments.cjs"),
  require("./rules/pretooluse/english-ui-strings.cjs"),
  require("./rules/pretooluse/barrel-purity.cjs"),
  require("./rules/pretooluse/logging-channel.cjs"),
  require("./rules/pretooluse/config-weakening.cjs"),
  require("./rules/pretooluse/suppression-gate.cjs"),
  require("./rules/pretooluse/settings-weakening.cjs"),
  require("./rules/pretooluse/bash-gates.cjs"),
  require("./rules/pretooluse/unlock-channel.cjs"),
  require("./rules/pretooluse/commit-explicit-paths.cjs"),
  require("./rules/pretooluse/commit-convention.cjs"),
  require("./rules/pretooluse/branch-convention.cjs"),
  require("./rules/pretooluse/branch-create-guard.cjs"),
  require("./rules/pretooluse/web-content-untrusted.cjs"),
  require("./rules/pretooluse/changelog-awareness.cjs"),
  require("./rules/pretooluse/rules-awareness.cjs"),
];

if (require.main === module) {
  dispatch(PRETOOLUSE_RULES, { label: "tab-pretooluse", stdinTimeoutMs: 3000 });
}

module.exports = { PRETOOLUSE_RULES };
