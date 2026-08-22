"use strict";

/**
 * SessionStart rule — the unlock-window baseline.
 *
 * Two jobs in one pass. It states which protected surfaces are currently open,
 * so a session does not discover the protection by being blocked by it. And it
 * writes this session's snapshot baseline, which is what makes the mid-session
 * `unlock-status` change reminders possible at all — without a baseline there is
 * nothing to diff a later state against.
 *
 * Silent about the closed case only when EVERYTHING is closed and there is
 * nothing else to say: naming five closed windows on every session start is noise
 * that trains the reader to skip the block.
 */

const { cwdOf } = require("../../lib/io.cjs");
const { formatWindowStatus, windowStatus, writeWindowSnapshot } = require("../../lib/unlock.cjs");

/**
 * Build the unlock-context fragment and seed this session's baseline.
 *
 * @param {object} data - SessionStart hook payload.
 * @returns {{additionalContext: string}|null} The fragment, or null when nothing
 *   is open (the baseline is still written).
 */
function collect(data) {
  const status = windowStatus();
  if (data && data.session_id) writeWindowSnapshot(data.session_id, status);

  const open = status.filter((s) => s.open);
  if (open.length === 0) return null;

  // Referenced so the rule's cwd contract stays explicit even though the state
  // tree is installation-fixed rather than cwd-derived.
  void cwdOf(data);

  return {
    additionalContext:
      `[tab-unlock] Open edit windows: ${formatWindowStatus(status)}\n` +
      `The user opened ${open.map((s) => `\`${s.scope}\``).join(", ")} deliberately, for a ` +
      "specific change. Make that change and nothing else on those surfaces — an open window " +
      "is permission for one edit, not a general licence.",
  };
}

module.exports = { collect, id: "unlock-context" };
