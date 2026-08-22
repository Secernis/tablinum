"use strict";

/**
 * Session-ownership helper — which files did THIS session actually edit?
 *
 * Backing store: `<state>/session-touched-<sid>.list`, written by the
 * `track-edits` PostToolUse rule (one absolute path per line, append-only). It
 * lives for the whole session, so late Stop rules can still resolve ownership.
 *
 * Consumers: `commit-reminder` and `changelog-currency` intersect the git dirty
 * tree with this set so parallel sessions (or the user's own edits) never get
 * swept into another agent's commit/documentation nudges — other files, other
 * agent. `auto-verify` reads it to decide which findings may block the turn.
 *
 * Known limit (accepted, deliberate): files created purely via Bash (generators,
 * scaffolds) are NOT in this tracker. A false positive here would pull a
 * parallel session's file into a commit nudge, which is the expensive direction
 * of the error — so the tracker stays Edit/Write-only and the generator
 * artefacts get their own named allowlist in the rules that need them.
 */

const fs = require("node:fs");
const path = require("node:path");

const { stateDir } = require("./state-dir.cjs");

/**
 * Normalize a path for cross-tool comparison: forward slashes, and lowercase on
 * Windows (case-insensitive filesystem — tool payloads and git output can
 * disagree on drive-letter casing).
 *
 * @param {string} p - Absolute path in any separator style.
 * @returns {string} Comparable normalized form.
 */
function normalizePath(p) {
  const fwd = String(p).replace(/\\/g, "/");
  return process.platform === "win32" ? fwd.toLowerCase() : fwd;
}

/**
 * Absolute path of one of the session's append-only trackers.
 *
 * @param {string} sessionId - Harness-provided session identifier.
 * @param {string} prefix - Tracker prefix, e.g. `session-touched`.
 * @returns {string} Tracker file path.
 */
function trackerFile(sessionId, prefix) {
  return path.join(stateDir(), `${prefix}-${String(sessionId).replace(/[^A-Za-z0-9_-]/g, "_")}.list`);
}

/**
 * Read one of the session's append-only path trackers.
 *
 * @param {string|undefined} sessionId - The payload's session id.
 * @param {string} prefix - Tracker prefix.
 * @returns {Set<string>|null} Normalized absolute paths, or null when the
 *   tracker does not exist (no session id, or nothing of that kind happened).
 */
function readTrackerSet(sessionId, prefix) {
  if (!sessionId) return null;
  try {
    const lines = fs.readFileSync(trackerFile(sessionId, prefix), "utf8").split("\n").filter(Boolean);
    return new Set(lines.map(normalizePath));
  } catch {
    return null;
  }
}

/**
 * Read a tracker's lines in their ORIGINAL spelling.
 *
 * The counterpart to {@link readTrackerSet}: that one lowercases on Windows so a
 * payload path and a git porcelain path compare equal, which is right for
 * matching and wrong for anything a person reads. A reminder naming
 * `src/app.tsx` for a file called `src/App.tsx` is confusing here and actively
 * wrong on a case-sensitive checkout.
 *
 * @param {string|undefined} sessionId - The payload's session id.
 * @param {string} prefix - Tracker prefix.
 * @returns {string[]|null} Absolute paths as recorded, or null when absent.
 */
function readTrackerList(sessionId, prefix) {
  if (!sessionId) return null;
  try {
    return [
      ...new Set(
        fs.readFileSync(trackerFile(sessionId, prefix), "utf8").split("\n").filter(Boolean),
      ),
    ];
  } catch {
    return null;
  }
}

/**
 * Append a path to one of the session's trackers (best-effort, deduplicated by
 * the reader rather than the writer — an append is one syscall, a read-modify-
 * write would be three plus a race).
 *
 * @param {string|undefined} sessionId - The payload's session id.
 * @param {string} prefix - Tracker prefix.
 * @param {string} absPath - Absolute path to record.
 * @returns {void}
 */
function appendTracker(sessionId, prefix, absPath) {
  if (!sessionId || !absPath) return;
  try {
    const file = trackerFile(sessionId, prefix);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${absPath}\n`, "utf8");
  } catch {
    // Tracking is best-effort: a failed write costs a nudge, never a turn.
  }
}

/**
 * Load the session's touched-file set.
 *
 * @param {string|undefined} sessionId - The payload's session id.
 * @returns {Set<string>|null} Normalized absolute paths, or null when the
 *   session has no tracker (no session id, or the session edited nothing).
 */
function sessionTouchedSet(sessionId) {
  return readTrackerSet(sessionId, "session-touched");
}

/**
 * Whether a repo-relative dirty path is owned by the session.
 *
 * @param {Set<string>} touched - Set from {@link sessionTouchedSet}.
 * @param {string} cwd - Absolute repo root.
 * @param {string} relPath - Repo-relative path (git porcelain style).
 * @returns {boolean} True when the session edited this file.
 */
function isSessionOwned(touched, cwd, relPath) {
  return touched.has(normalizePath(path.join(cwd, relPath)));
}

module.exports = {
  appendTracker,
  isSessionOwned,
  normalizePath,
  readTrackerList,
  readTrackerSet,
  sessionTouchedSet,
  trackerFile,
};
