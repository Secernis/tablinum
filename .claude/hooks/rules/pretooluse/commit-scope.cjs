"use strict";

/**
 * PreToolUse rule — every commit declares a scope.
 *
 * The subject has to answer WHERE as well as WHAT: `fix(commit): ...` rather
 * than `fix: ...`. The scope is the field a reader filters on months later, when
 * they are looking for the change that broke a particular part of the system —
 * and a history where some commits carry one and some do not cannot be filtered
 * at all, because absence is indistinguishable from "not that area".
 *
 * The concrete argument for this rule is the first commit the channel ever
 * produced: `chore: add the agent guardrail layer`. Correct in form, passing
 * every other check, and useless for finding anything — it names no part of the
 * system. `--scope` was optional, so the script built it without complaint.
 *
 * Presence only. The SHAPE of a scope (lowercase, kebab) and the nudge about a
 * scope the repository has never used are `commit.mjs`'s job: it can read the
 * history to answer them, and duplicating the vocabulary here would be a second
 * copy to drift.
 */

const { commandSurface, segments } = require("../../lib/bash-command.cjs");
const { NOOP, PASS, deny } = require("../../lib/io.cjs");

/** A commit invocation through the project's channel. */
const COMMIT_CALL_RE = /\b(?:npm\s+run\s+commit|node\s+scripts\/commit\.mjs)\b/;

/** Modes that inspect rather than commit — they have nothing to scope. */
const NON_COMMITTING_RE = /(?:^|\s)--(?:inspect|help)(?:\s|$)/;

/** The flag itself, in both spellings the parser accepts. */
const SCOPE_FLAG_RE = /(?:^|\s)--scope(?:=|\s)/;

/**
 * Deny a commit call that names no scope.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP when not a commit call, PASS when scoped or merely
 *   inspecting, BLOCK otherwise.
 */
function run(data) {
  if (data.tool_name !== "Bash") return NOOP;
  const raw = (data.tool_input && data.tool_input.command) || "";
  const surface = commandSurface(raw);
  if (!COMMIT_CALL_RE.test(surface)) return NOOP;

  // Per segment, for the reason `commit-explicit-paths` learned the hard way: a
  // flag belonging to a neighbouring call in the same line is not this call's.
  for (const segment of segments(surface)) {
    if (!COMMIT_CALL_RE.test(segment)) continue;
    if (NON_COMMITTING_RE.test(segment)) continue;
    if (SCOPE_FLAG_RE.test(segment)) continue;
    return deny(
      "tab-guard",
      "Commit without a scope",
      "Every commit declares which part of the system it touches:\n" +
        '  npm run commit -- --files <path...> --type <type> --scope <name> --message "..."\n\n' +
        "The subject then answers where as well as what — `fix(commit): ...` rather than " +
        "`fix: ...`. That is the field someone filters on months from now, hunting the change " +
        "that broke one area; a history where only some commits carry one cannot be filtered, " +
        "because a missing scope and a different area look the same.\n\n" +
        "`npm run commit -- --inspect` lists the scopes this repo already uses.",
    );
  }
  return PASS;
}

module.exports = { id: "commit-scope", run };
