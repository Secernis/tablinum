#!/usr/bin/env node
"use strict";

/**
 * UserPromptSubmit dispatcher.
 *
 * Fires when the user submits a prompt, BEFORE the model request — the earliest
 * point at which a between-turns unlock toggle can reach the conversation: the
 * user opens a window in their own terminal and types "weiter", and the agent
 * already knows.
 *
 * Runs on the MERGE path rather than the gate path, because two context-injecting
 * rules can fire on one turn (a window toggle AND an English paste), and two
 * independent stdout writers would emit two unparseable JSON objects.
 *
 * Registry:
 *   unlock-status    emits on a window change (shared with PostToolUse, which is
 *                    its gate-path home)
 *   language-anchor  holds the reply language at German when the prompt carries
 *                    a substantial English passage
 */

const { dispatchMerged } = require("./lib/io.cjs");

const USERPROMPTSUBMIT_RULES = [
  require("./rules/posttooluse/unlock-status.cjs"),
  require("./rules/userpromptsubmit/language-anchor.cjs"),
];

if (require.main === module) {
  dispatchMerged(USERPROMPTSUBMIT_RULES, {
    eventName: "UserPromptSubmit",
    label: "tab-userpromptsubmit",
    stdinTimeoutMs: 2000,
  });
}

module.exports = { USERPROMPTSUBMIT_RULES };
