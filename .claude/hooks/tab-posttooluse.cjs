#!/usr/bin/env node
"use strict";

/**
 * PostToolUse dispatcher — single entrypoint for all PostToolUse rules.
 *
 * None of these block; they record what happened and, in one case, announce it.
 *
 * Registry:
 *   track-edits   records edited files per session — the ownership fact every
 *                 later gate reads (commit-reminder, changelog-currency,
 *                 auto-verify)
 *   record-usage  tool-usage telemetry
 *   unlock-status injects unlock-window changes as additionalContext; the
 *                 registry's ONLY stdout writer (one envelope per dispatch)
 */

const { dispatch } = require("./lib/io.cjs");

const POSTTOOLUSE_RULES = [
  require("./rules/posttooluse/track-edits.cjs"),
  require("./rules/posttooluse/record-usage.cjs"),
  require("./rules/posttooluse/unlock-status.cjs"),
];

if (require.main === module) {
  dispatch(POSTTOOLUSE_RULES, { label: "tab-posttooluse", stdinTimeoutMs: 2000 });
}

module.exports = { POSTTOOLUSE_RULES };
