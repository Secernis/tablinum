"use strict";

/**
 * PostToolUse rule — tool-usage telemetry.
 *
 * Never blocks, never speaks. Records one line per tool call so that questions
 * about how the agent actually works in this repository can be answered from
 * data: which tools carry the work, how often a gate fires against how often it
 * is silent, whether a rule that was added six weeks ago has ever matched.
 *
 * Deliberately records the tool NAME and a coarse target, never the payload:
 * a full record would duplicate the transcript and put file contents into a
 * second, longer-lived place.
 */

const fs = require("node:fs");
const path = require("node:path");

const { PASS, cwdOf } = require("../../lib/io.cjs");
const { stateDir } = require("../../lib/state-dir.cjs");

/** Byte cap for the usage ring. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * A coarse, low-cardinality target for a tool call.
 *
 * A file path is reduced to its top-level directory, a command to its first
 * word. Anything finer turns the ring into a log of the session.
 *
 * @param {object} data - PostToolUse hook payload.
 * @returns {string|undefined} The target label.
 */
function targetOf(data) {
  const ti = data.tool_input || {};
  if (ti.file_path) {
    const rel = path.relative(cwdOf(data), ti.file_path).replace(/\\/g, "/");
    return rel.split("/")[0] || undefined;
  }
  if (ti.command) return String(ti.command).trim().split(/\s+/)[0];
  return undefined;
}

/**
 * Append one usage sample.
 *
 * @param {object} data - PostToolUse hook payload.
 * @returns {number} Always PASS — telemetry never influences a call.
 */
function run(data) {
  try {
    const file = path.join(stateDir(), "tool-usage.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Truncate rather than rotate: this ring answers aggregate questions, and a
    // lost tail of old samples costs nothing that a rotation would preserve.
    try {
      if (fs.statSync(file).size > MAX_BYTES) fs.rmSync(file, { force: true });
    } catch {
      // No file yet — the append below creates it.
    }
    fs.appendFileSync(
      file,
      `${JSON.stringify({
        session: data.session_id,
        t: Date.now(),
        target: targetOf(data),
        tool: data.tool_name,
      })}\n`,
      "utf8",
    );
  } catch {
    // Fail-open by contract: telemetry must never affect a tool call.
  }
  return PASS;
}

module.exports = { id: "record-usage", run, targetOf };
