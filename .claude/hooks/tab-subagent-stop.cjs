#!/usr/bin/env node
"use strict";

/**
 * SubagentStop dispatcher — records subagent usage.
 *
 * Subagents are the most expensive call in the box and the hardest to assess
 * afterwards, because their work happens outside the transcript.
 */

const { dispatch } = require("./lib/io.cjs");

const SUBAGENTSTOP_RULES = [require("./rules/subagentstop/record-subagent.cjs")];

if (require.main === module) {
  dispatch(SUBAGENTSTOP_RULES, { label: "tab-subagent-stop", stdinTimeoutMs: 2000 });
}

module.exports = { SUBAGENTSTOP_RULES };
