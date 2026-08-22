"use strict";

/**
 * PostToolUse rule — record which files this session edited.
 *
 * Never blocks. Two append-only trackers under the hook state dir:
 *
 *   session-touched-<sid>.list — every file the session edited, for the whole
 *     session. This is what SESSION OWNERSHIP means downstream: `commit-reminder`
 *     and `changelog-currency` intersect it with the git dirty tree so a parallel
 *     session's work is never swept into another agent's nudges, and
 *     `commit-foreign-hunk` refuses to stage a path that is not in it.
 *
 *   edited-files-<sid>.list — the same paths, but CONSUMED by the verify gate:
 *     `auto-verify` deletes it after a green run, so the next Stop only checks
 *     what changed since. Two trackers rather than one because they answer
 *     different questions — "did this session write it" and "has it been verified
 *     since" — and collapsing them loses the first the moment the second is cleared.
 *
 * Append-only, deduplicated by the reader: an append is one syscall, whereas a
 * read-modify-write is three plus a race between the parallel dispatchers of one
 * turn.
 */

const path = require("node:path");

const { NOOP, PASS, cwdOf } = require("../../lib/io.cjs");
const { EDIT_TOOLS } = require("../../lib/edit-payload.cjs");
const { appendTracker } = require("../../lib/session-touched.cjs");

/**
 * Record an edited file in both trackers.
 *
 * @param {object} data - PostToolUse hook payload.
 * @returns {number} NOOP when the call was not an edit, PASS once recorded.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;
  const filePath = data.tool_input && data.tool_input.file_path;
  if (!filePath || !data.session_id) return NOOP;
  // A failed edit changed nothing and must not create an ownership claim.
  if (data.tool_response && data.tool_response.success === false) return NOOP;

  const abs = path.resolve(cwdOf(data), filePath);
  appendTracker(data.session_id, "session-touched", abs);
  appendTracker(data.session_id, "edited-files", abs);
  return PASS;
}

module.exports = { id: "track-edits", run };
