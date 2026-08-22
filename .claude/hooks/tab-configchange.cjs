#!/usr/bin/env node
"use strict";

/**
 * ConfigChange dispatcher — records settings changes to the audit log.
 *
 * `.claude/settings.json` decides which gates run at all, so a change to it is
 * the one change that can silently alter what every later change is checked
 * against. `settings-weakening` refuses the removals; this records the timeline.
 */

const { dispatch } = require("./lib/io.cjs");

const CONFIGCHANGE_RULES = [require("./rules/configchange/config-audit.cjs")];

if (require.main === module) {
  dispatch(CONFIGCHANGE_RULES, { label: "tab-configchange", stdinTimeoutMs: 2000 });
}

module.exports = { CONFIGCHANGE_RULES };
