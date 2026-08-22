"use strict";

/**
 * PreToolUse rule — an agent cannot open its own edit windows.
 *
 * `surface-protect` refuses agent edits to the governance surfaces unless the
 * user has opened that surface's window. Until this rule existed, that was an
 * honour system: the unlock is an ordinary Node script, running it is an
 * ordinary Bash call, and nothing stopped the agent from simply running it. The
 * documentation said "do not run this yourself", which is a request, not a
 * control — and a protection that depends on the protected party choosing to
 * respect it is a comment with extra steps.
 *
 * A window opened from the user's own terminal never reaches this rule: their
 * shell input is not an agent tool call, so no PreToolUse hook fires for it.
 * The asymmetry is exactly the point — the same command is available to them and
 * refused to the agent.
 *
 * READING the state stays open. `npm run unlock` with no arguments prints which
 * windows are live and changes nothing, and an agent that knows what is open
 * asks for the right thing instead of guessing.
 */

const { commandSurface, segments } = require("../../lib/bash-command.cjs");
const { NOOP, PASS, deny } = require("../../lib/io.cjs");

/** The unlock channel, in every spelling that reaches it. */
const UNLOCK_CALL_RE =
  /\b(?:npm\s+run\s+unlock|node\s+scripts\/unlock\.mjs|tab-unlock-[a-z]+\.cjs)\b/;

/**
 * The flag files themselves.
 *
 * Guarding the COMMAND is only half of it: a window is a file, and `echo x >
 * .claude/hooks/state/unlock-hooks` forges one without going near the script.
 * `surface-protect` denies edits to the state tree unconditionally, but it sees
 * `Edit`/`MultiEdit`/`Write` and a shell redirect is none of those.
 *
 * Any mention at all is refused, not just a write. Distinguishing a read from a
 * write on a shell line is exactly the parsing problem `secret-read` needs two
 * passes for, and here it buys nothing: an agent has no reason to read a flag
 * when `npm run unlock` reports the same state in a readable form.
 */
const FLAG_PATH_RE = /(?:^|[\s"'=<>|;&(])[^\s"'<>|;&()]*state[/\\]unlock-[a-z]+/i;

/** Scope names, plus `all`. A call naming one of these MUTATES a window. */
const SCOPE_WORD_RE = /(?:^|[\s,])(?:rules|design|hooks|brand|configs|all)(?:[\s,]|$)/;

/**
 * Whether a segment merely reads the window state.
 *
 * The status form takes no scope. Anything naming a scope — to open or to close
 * — is a mutation and belongs to the user.
 *
 * @param {string} segment - One command segment.
 * @returns {boolean} True when the call only prints state.
 */
function isStatusOnly(segment) {
  const afterFlag = segment.split(/--\s/).pop() || segment;
  return !SCOPE_WORD_RE.test(afterFlag);
}

/**
 * Deny an agent-side attempt to open or close an edit window.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP when unrelated, PASS for a status read, BLOCK otherwise.
 */
function run(data) {
  if (data.tool_name !== "Bash") return NOOP;
  const raw = (data.tool_input && data.tool_input.command) || "";
  const surface = commandSurface(raw);

  // A flag path anywhere in the command is refused outright — see FLAG_PATH_RE.
  if (FLAG_PATH_RE.test(surface)) {
    return deny(
      "tab-guard",
      "Edit windows belong to the user",
      "This command names an unlock flag under `.claude/hooks/state/`. A window is a file, and " +
        "writing that file forges the window without going near the script — which would make " +
        "every protected surface open to you at will.\n\n" +
        "Ask instead: `npm run unlock -- <surface>` is the user's to run.\n" +
        "To see what is currently open, run `npm run unlock` with no arguments.",
    );
  }

  if (!UNLOCK_CALL_RE.test(surface)) return NOOP;

  for (const segment of segments(surface)) {
    if (!UNLOCK_CALL_RE.test(segment)) continue;
    if (isStatusOnly(segment)) continue;
    return deny(
      "tab-guard",
      "Edit windows belong to the user",
      "Opening or closing a protected-surface window is not yours to do. A guard the guarded " +
        "party can lift is not a guard.\n\n" +
        "Ask instead, and make the ask answerable — name the surface, the file, and what you " +
        "want to change about it:\n" +
        '  "Um X in .claude/rules/... zu ändern, bräuchte ich: npm run unlock -- rules"\n\n' +
        "Several surfaces at once is one command: `npm run unlock -- hooks rules`.\n" +
        "Reading the state stays open to you: `npm run unlock` with no arguments.",
    );
  }
  return PASS;
}

module.exports = { id: "unlock-channel", isStatusOnly, run };
