"use strict";

/**
 * Rule — announce a change in the unlock windows.
 *
 * Shared by two dispatchers, which is why it exposes BOTH shapes: `run()` for the
 * PostToolUse gate path and `collect()` for the UserPromptSubmit merge path.
 *
 * The problem it solves: the user opens a window in their own terminal, between
 * turns. Nothing in the conversation records that, so the agent's next attempt to
 * edit the surface is either a block it did not expect or a success it did not
 * know it had. Diffing the live window state against a per-session baseline turns
 * both into a stated fact at the moment it changes.
 *
 * UserPromptSubmit is the earlier and more useful of the two: it fires before the
 * model request, so a window the user just opened is in context for the very turn
 * they opened it for — no announcement needed on their side.
 */

const { PASS, hint } = require("../../lib/io.cjs");
const {
  readWindowSnapshot,
  windowStatus,
  writeWindowSnapshot,
} = require("../../lib/unlock.cjs");

/**
 * Compute the window changes since this session's baseline.
 *
 * @param {string} sessionId - The payload's session id.
 * @returns {{opened: string[], closed: string[], status: Array<object>}} The diff.
 */
function diffWindows(sessionId) {
  const status = windowStatus();
  const baseline = (readWindowSnapshot()[sessionId] || {}).open || {};
  const opened = status.filter((s) => s.open && !baseline[s.scope]).map((s) => s.scope);
  const closed = status
    .filter((s) => !s.open && baseline[s.scope] === true)
    .map((s) => s.scope);
  return { closed, opened, status };
}

/**
 * Build the context fragment for a window change, or null when nothing changed.
 *
 * @param {object} data - Hook payload.
 * @returns {{additionalContext: string}|null} The fragment.
 */
function collect(data) {
  const sessionId = data && data.session_id;
  if (!sessionId) return null;

  const { closed, opened, status } = diffWindows(sessionId);
  if (opened.length === 0 && closed.length === 0) return null;
  // Re-baseline immediately, so the same change is announced exactly once.
  writeWindowSnapshot(sessionId, status);

  const parts = [];
  if (opened.length > 0) {
    parts.push(
      `The user opened the ${opened.map((s) => `\`${s}\``).join(", ")} edit window(s) — ` +
        "30 minutes from now. Those surfaces are editable for the change that was discussed, " +
        "and nothing beyond it.",
    );
  }
  if (closed.length > 0) {
    parts.push(
      `The ${closed.map((s) => `\`${s}\``).join(", ")} edit window(s) are closed again. ` +
        "Further edits there will be refused; ask before assuming otherwise.",
    );
  }
  return { additionalContext: `[tab-unlock] ${parts.join("\n")}` };
}

/**
 * Gate-path entry point: emit the same fragment as a hint envelope.
 *
 * @param {object} data - PostToolUse hook payload.
 * @returns {number} Always PASS — this rule never blocks.
 */
function run(data) {
  const fragment = collect(data);
  if (!fragment) return PASS;
  // The prefix is already in the fragment; `hint` adds its own, so strip it.
  return hint(
    "tab-unlock",
    fragment.additionalContext.replace(/^\[tab-unlock\]\s*/, ""),
    undefined,
    data.hook_event_name || "PostToolUse",
  );
}

module.exports = { collect, diffWindows, id: "unlock-status", run };
