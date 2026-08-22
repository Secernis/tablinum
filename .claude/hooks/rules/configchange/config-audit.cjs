"use strict";

/**
 * ConfigChange rule — keep an audit trail of settings changes.
 *
 * Never blocks. `.claude/settings.json` decides which gates run at all, so a
 * change to it is the one change that can silently alter what every later change
 * is checked against. The `settings-weakening` gate refuses the removals; this
 * rule records what happened either way.
 *
 * An append-only log rather than a diff against a snapshot: the question worth
 * answering later is "when did this stop being enforced", and only a timeline
 * answers it.
 */

const fs = require("node:fs");
const path = require("node:path");

const { PASS } = require("../../lib/io.cjs");
const { stateDir } = require("../../lib/state-dir.cjs");

/** Byte cap for the audit log. */
const MAX_BYTES = 512 * 1024;

/**
 * Append one settings-change record.
 *
 * @param {object} data - ConfigChange hook payload.
 * @returns {number} Always PASS — auditing never blocks.
 */
function run(data) {
  try {
    const file = path.join(stateDir(), "config-audit.log");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      if (fs.statSync(file).size > MAX_BYTES) fs.rmSync(file, { force: true });
    } catch {
      // No log yet — the append creates it.
    }
    const what = data.config_path || data.file_path || "settings";
    fs.appendFileSync(
      file,
      `${new Date().toISOString()}  session=${data.session_id || "-"}  ${what}\n`,
      "utf8",
    );
  } catch {
    // Fail-open by contract.
  }
  return PASS;
}

module.exports = { id: "config-audit", run };
