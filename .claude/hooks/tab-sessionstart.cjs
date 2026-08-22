#!/usr/bin/env node
"use strict";

/**
 * SessionStart dispatcher — single entrypoint for all SessionStart rules.
 *
 * Fires on every session-context (re)build: startup, resume, clear, compact.
 * Rules return context FRAGMENTS via `collect(data)`; the dispatcher merges them
 * into a single envelope, because only one `additionalContext` may be emitted per
 * dispatch — two JSON objects on stdout are unparseable and would take the git
 * context down together with everything else.
 *
 * Registry (order is contract — the first rule that sets a sessionTitle wins):
 *   branch-context     git state + the commit/push/release flow, as facts;
 *                      sessionTitle = the active branch
 *   unlock-context     which protected surfaces are open, and the snapshot
 *                      baseline the mid-session change reminders diff against
 *   changelog-context  what the next release currently says
 *   version-drift      whether the four declared versions still agree
 *
 * These are context injectors, not gates: fail-open, always exit 0.
 */

const { dispatchMerged } = require("./lib/io.cjs");

const SESSIONSTART_RULES = [
  require("./rules/sessionstart/branch-context.cjs"),
  require("./rules/sessionstart/unlock-context.cjs"),
  require("./rules/sessionstart/changelog-context.cjs"),
  require("./rules/sessionstart/version-drift.cjs"),
];

if (require.main === module) {
  dispatchMerged(SESSIONSTART_RULES, { label: "tab-sessionstart", stdinTimeoutMs: 3000 });
}

module.exports = { SESSIONSTART_RULES };
