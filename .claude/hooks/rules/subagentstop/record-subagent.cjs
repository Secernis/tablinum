"use strict";

/**
 * SubagentStop rule — record subagent usage.
 *
 * Never blocks, never speaks. Subagents are the most expensive tool call in the
 * box and the hardest to reason about after the fact, because their work happens
 * outside the transcript. One line each makes the question "was that delegation
 * worth it" answerable from data rather than from impression.
 */

const fs = require("node:fs");
const path = require("node:path");

const { PASS } = require("../../lib/io.cjs");
const { stateDir } = require("../../lib/state-dir.cjs");

/** Byte cap for the ring. */
const MAX_BYTES = 512 * 1024;

/**
 * Append one subagent record.
 *
 * @param {object} data - SubagentStop hook payload.
 * @returns {number} Always PASS.
 */
function run(data) {
  try {
    const file = path.join(stateDir(), "subagent-usage.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      if (fs.statSync(file).size > MAX_BYTES) fs.rmSync(file, { force: true });
    } catch {
      // No ring yet.
    }
    fs.appendFileSync(
      file,
      `${JSON.stringify({
        agent: data.subagent_type || data.agent_type,
        session: data.session_id,
        t: Date.now(),
      })}\n`,
      "utf8",
    );
  } catch {
    // Fail-open by contract.
  }
  return PASS;
}

module.exports = { id: "record-subagent", run };
