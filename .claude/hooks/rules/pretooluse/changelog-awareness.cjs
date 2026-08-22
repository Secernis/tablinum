"use strict";

/**
 * PreToolUse rule — the CHANGELOG reminder, at the moment of editing.
 *
 * Not a gate: context injection. On the FIRST edit of a user-visible source file
 * in a session, it says once that the change belongs in `## [Unreleased]`, and
 * how to put it there.
 *
 * The timing is the whole point. A changelog written at release time is written
 * from `git log`, and a git log lists what changed in the CODE. What a changelog
 * owes its reader is what changed for the PERSON USING THE APP — and the only
 * moment anyone knows that is while making the change. Reconstructing it three
 * weeks later produces a list of commit subjects with bullets in front of them.
 *
 * Once per session, not once per edit: a reminder that fires on every write is a
 * reminder nobody reads. The hard tier is the Stop rule `changelog-currency`,
 * which checks the session's actual outcome.
 *
 * One-envelope constraint: `hint()` writes stdout and only ONE rule may do so per
 * dispatch. The colliding rule is `rules-awareness` (same edit tools). This rule
 * is registered FIRST and defers — emitting nothing, marking nothing — while
 * that rule's session flag is still absent, because then IT will emit on this
 * dispatch. From the second session edit onward it is silent and this nudge is
 * free.
 */

const fs = require("node:fs");
const path = require("node:path");

const { EXCUSED, NOOP, cwdOf, hint } = require("../../lib/io.cjs");
const { EDIT_TOOLS } = require("../../lib/edit-payload.cjs");
const { stateDir } = require("../../lib/state-dir.cjs");
const rulesAwareness = require("./rules-awareness.cjs");

/** Source whose change is visible to whoever uses the app. */
const USER_VISIBLE_RE = /^(?:src\/|src-tauri\/src\/|src-tauri\/capabilities\/)/;

/** Files that ARE documentation — editing them needs no reminder to document. */
const DOC_BASENAME_RE = /^(?:CHANGELOG|README|DESIGN|TRADEMARK|LICENSE)(\.md)?$/i;

/**
 * Resolve the per-session flag path.
 *
 * @param {string} sessionId - Harness-provided session identifier.
 * @returns {string} Absolute path of this session's nudge marker.
 */
function flagPath(sessionId) {
  return path.join(
    stateDir(),
    "changelog-awareness",
    String(sessionId).replace(/[^A-Za-z0-9_-]/g, "_"),
  );
}

/**
 * Whether this session has already been nudged.
 *
 * @param {string} sessionId - Harness-provided session identifier.
 * @returns {boolean} True when the marker exists.
 */
function alreadyNudged(sessionId) {
  try {
    return fs.existsSync(flagPath(sessionId));
  } catch {
    return false;
  }
}

/**
 * Record that this session has been nudged (best-effort).
 *
 * @param {string} sessionId - Harness-provided session identifier.
 * @returns {void}
 */
function markNudged(sessionId) {
  const f = flagPath(sessionId);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, new Date().toISOString(), "utf8");
}

/**
 * Inject the CHANGELOG reminder once per session.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} Always non-blocking; emits additionalContext at most once
 *   per session on an edit to user-visible source.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;
  const filePath = data.tool_input && data.tool_input.file_path;
  if (!filePath) return NOOP;
  if (DOC_BASENAME_RE.test(path.basename(filePath, ".md"))) return NOOP;

  const sessionId = data.session_id;
  // Without a session there is no per-session state, and rules-awareness would
  // always emit — defer unconditionally so the single envelope stays uncontested.
  if (!sessionId) return NOOP;

  const rel = path.relative(cwdOf(data), filePath).replace(/\\/g, "/");
  if (!USER_VISIBLE_RE.test(rel)) return NOOP;

  // Collision defer: when rules-awareness has not yet emitted this session, it
  // will emit on THIS dispatch — yield the single stdout envelope.
  try {
    if (!fs.existsSync(rulesAwareness.flagPath(sessionId))) return EXCUSED;
  } catch {
    return EXCUSED;
  }

  if (alreadyNudged(sessionId)) return EXCUSED;
  try {
    markNudged(sessionId);
  } catch {
    // Flag IO failed — still hint this once rather than swallow the reminder.
  }

  return hint(
    "tab-changelog",
    "You are editing user-visible source. When this change lands, it belongs in the " +
      "`## [Unreleased]` section of CHANGELOG.md — written now, while you still know what it " +
      "means for someone using the app.\n\n" +
      "  npm run changelog -- --added \"...\"      # or --changed / --fixed / --removed / " +
      "--deprecated / --security\n" +
      "  npm run changelog -- --pending          # what the next release currently says\n\n" +
      "Write the entry from the user's side, not the code's: \"Cloning over SSH no longer " +
      "fails when the key has a passphrase\", not \"refactor ssh auth handler\". One line per " +
      "user-visible change; a pure refactor, a test or a chore gets none. Do NOT write a " +
      "`## [X.Y.Z]` heading — `npm run version` owns those.",
    "changelog: document this in ## [Unreleased] while you still know what it means",
  );
}

module.exports = { alreadyNudged, flagPath, id: "changelog-awareness", run };
