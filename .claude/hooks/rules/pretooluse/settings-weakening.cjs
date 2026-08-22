"use strict";

/**
 * PreToolUse rule — the hook wiring and the deny list only ever grow.
 *
 * `.claude/settings.json` decides which gates run at all. Removing a hook entry
 * from it is the single cheapest way to disable every rule behind that
 * dispatcher, and it leaves no trace anywhere else: the rules still exist, the
 * files are untouched, and nothing runs.
 *
 * Same for `permissions.deny`. An entry there is a decision someone made about
 * what this agent may not do; shortening the list is that decision being
 * reversed by whoever happens to be editing.
 *
 * The direction is what is judged: adding a hook or a deny entry passes, removing
 * one blocks. `surface-protect` already guards the file behind the `configs`
 * unlock window; this is the tier that survives an open window.
 */

const path = require("node:path");

const { INCONCLUSIVE, NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");
const { EDIT_TOOLS, textPair } = require("../../lib/edit-payload.cjs");

/** The settings files this rule guards. */
const SCOPE_RE = /^\.claude\/settings(?:\.local)?\.json$/;

/** Hook event names whose registration must not disappear. */
const HOOK_EVENT_RE = /"(SessionStart|PreToolUse|PostToolUse|Stop|SubagentStop|UserPromptSubmit|Notification|ConfigChange)"/g;

/** A `permissions.deny` entry. */
const DENY_ENTRY_RE = /"(Bash|Read|Write|Edit|WebFetch)\([^"]*\)"/g;

/**
 * Collect every match of a global regex as a set.
 *
 * @param {string} text - Text to scan.
 * @param {RegExp} re - Global regex with one capture group.
 * @returns {Set<string>} The captured values.
 */
function collect(text, re) {
  const out = new Set();
  const local = new RegExp(re.source, re.flags);
  let m = local.exec(String(text || ""));
  while (m !== null) {
    out.add(m[0]);
    m = local.exec(String(text || ""));
  }
  return out;
}

/**
 * Deny an edit that removes a hook registration or a deny entry.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP out of scope, PASS when nothing shrank, BLOCK otherwise.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;
  const ti = data.tool_input || {};
  const rel = path.relative(cwdOf(data), ti.file_path || "").replace(/\\/g, "/");
  if (!SCOPE_RE.test(rel)) return NOOP;

  const { newText, oldText } = textPair(ti);
  // A Write replaces the file wholesale and carries no old text, so there is no
  // diff to judge. Say so rather than passing: a whole-file rewrite of the
  // settings is exactly the case this rule cannot see.
  if (!oldText && ti.content !== undefined) return INCONCLUSIVE;

  const lostHooks = [...collect(oldText, HOOK_EVENT_RE)].filter(
    (h) => !collect(newText, HOOK_EVENT_RE).has(h),
  );
  if (lostHooks.length > 0) {
    return deny(
      "tab-guard",
      "Hook registration removed",
      `'${rel}' would drop the hook registration for ${lostHooks.join(", ")}.\n\n` +
        "Removing a dispatcher entry silently disables every rule behind it — the rule files " +
        "stay in place and stop running, which is the hardest kind of failure to notice.\n\n" +
        "If a specific rule is wrong, name it and fix that rule. Unregistering the event is not " +
        "a fix, it is a blackout.",
    );
  }

  const lostDeny = [...collect(oldText, DENY_ENTRY_RE)].filter(
    (d) => !collect(newText, DENY_ENTRY_RE).has(d),
  );
  if (lostDeny.length > 0) {
    return deny(
      "tab-guard",
      "Permission deny entry removed",
      `'${rel}' would remove the deny entry ${lostDeny.join(", ")}.\n\n` +
        "Each entry there is a decision about what this agent may not do. Reversing one is the " +
        "user's call, made deliberately — not a side effect of editing settings for another " +
        "reason.",
    );
  }

  return PASS;
}

module.exports = { id: "settings-weakening", run };
