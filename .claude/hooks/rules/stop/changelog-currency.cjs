"use strict";

/**
 * Stop rule — document the change while you still know what it means.
 *
 * The hard tier of the CHANGELOG discipline. `changelog-awareness` reminds at the
 * first edit; this one checks the session's actual outcome: user-visible source
 * changed, and `## [Unreleased]` did not.
 *
 * Why this is worth a block rather than a note. A changelog written at release
 * time is written from `git log`, and a git log answers "what changed in the
 * code". A changelog answers "what changed for the person using the app". Those
 * are different documents, and the second one can only be written by whoever made
 * the change, on the day they made it. Every week that passes turns a real entry
 * into a reworded commit subject.
 *
 * Three ways past it, all legitimate:
 *   - write the entry: `npm run changelog -- --added "..."`
 *   - declare there is nothing to say: `npm run changelog -- --none`
 *     (a refactor, a test, a build fix — real categories, and saying so is a
 *     decision rather than an omission)
 *   - the reminder fires ONCE per Stop chain; a second Stop passes, so the agent
 *     is never trapped by it.
 *
 * Session ownership is enforced throughout: files another session or the user
 * edited never count toward the obligation.
 */

const fs = require("node:fs");
const path = require("node:path");

const { BLOCK, EXCUSED, NOOP, PASS, cwdOf } = require("../../lib/io.cjs");
const {
  normalizePath,
  readTrackerList,
  sessionTouchedSet,
} = require("../../lib/session-touched.cjs");
const { stateDir } = require("../../lib/state-dir.cjs");
const { unreleasedEntries } = require("../../../../scripts/lib/changelog-core.cjs");

/** Source whose change a user would notice. */
const USER_VISIBLE_RE = /^(?:src\/|src-tauri\/src\/|src-tauri\/capabilities\/|src-tauri\/tauri(?:\.[a-z]+)?\.conf\.json$)/;

/** Paths that are user-visible by extension but never on their own. */
const NEVER_ALONE_RE = /\.(?:test|spec|stories)\.[tj]sx?$/;

/**
 * The per-session acknowledgement flag, written by `npm run changelog -- --none`.
 *
 * @param {string} sessionId - Stop payload session id.
 * @returns {string} Absolute flag path.
 */
function ackPath(sessionId) {
  return path.join(stateDir(), "changelog-ack", String(sessionId).replace(/[^A-Za-z0-9_-]/g, "_"));
}

/**
 * The user-visible files this session edited, in their original spelling.
 *
 * Takes the RAW tracker list rather than the normalised set: the set is
 * lowercased on Windows so paths from different sources compare equal, and a
 * reminder that names `src/app.tsx` for a file called `src/App.tsx` sends the
 * reader to a path that does not exist.
 *
 * @param {string[]} paths - Absolute paths as recorded by `track-edits`.
 * @param {string} cwd - Repo root.
 * @returns {string[]} Repo-relative paths.
 */
function userVisibleEdits(paths, cwd) {
  return paths
    .map((abs) => path.relative(cwd, abs).replace(/\\/g, "/"))
    .filter((rel) => USER_VISIBLE_RE.test(rel) && !NEVER_ALONE_RE.test(rel));
}

/**
 * Require the CHANGELOG's Unreleased section to reflect this session's work.
 *
 * @param {object} data - Stop hook payload.
 * @returns {number} NOOP when nothing user-visible changed, EXCUSED when the
 *   duty was discharged, PASS when the CHANGELOG moved, BLOCK otherwise.
 */
function run(data) {
  // Fires once per Stop chain: after the reminder the agent has decided, and a
  // second block would trap the turn.
  if (data.stop_hook_active) return NOOP;

  const cwd = cwdOf(data);
  const touched = sessionTouchedSet(data.session_id);
  if (touched === null || touched.size === 0) return NOOP;

  // The set above stays the COMPARISON form (it serves the CHANGELOG.md
  // ownership test below); the raw list is what the reminder prints.
  const visible = userVisibleEdits(readTrackerList(data.session_id, "session-touched") || [], cwd);
  if (visible.length === 0) return NOOP;

  // The session edited the CHANGELOG itself — the duty is discharged.
  if (touched.has(normalizePath(path.join(cwd, "CHANGELOG.md")))) return PASS;

  // Or explicitly declared there is nothing to document.
  try {
    if (fs.existsSync(ackPath(data.session_id))) return EXCUSED;
  } catch {
    // Unreadable flag: fall through and remind. A missed acknowledgement costs
    // one reminder; a wrongly assumed one costs an undocumented release.
  }

  let pending = 0;
  try {
    pending = unreleasedEntries(fs.readFileSync(path.join(cwd, "CHANGELOG.md"), "utf8")).length;
  } catch {
    // No CHANGELOG at all — the reminder below is then even more warranted.
  }

  const sample = visible.slice(0, 8).map((f) => `  - ${f}`).join("\n");
  const more = visible.length > 8 ? `\n  ... and ${visible.length - 8} more` : "";

  process.stderr.write(
    `[tab-changelog] This session changed user-visible source but not CHANGELOG.md:\n${sample}${more}\n\n` +
      `\`## [Unreleased]\` currently holds ${pending} entr${pending === 1 ? "y" : "ies"}.\n\n` +
      "Write the entry now, while you still know what the change means for someone using the " +
      "app. In three weeks the only source left is `git log`, which records what changed in the " +
      "code — not what changed for the user. Those are different documents.\n\n" +
      "  npm run changelog -- --added \"Repository list shows the current branch\"\n" +
      "  npm run changelog -- --fixed \"Cloning over SSH no longer fails when the key has a passphrase\"\n" +
      "  npm run changelog -- --changed | --removed | --deprecated | --security\n\n" +
      "Write it from the user's side, in English, one line per user-visible change. Do NOT add " +
      "a `## [X.Y.Z]` heading — `npm run release` owns those.\n\n" +
      "If this change genuinely has nothing a user would notice — a refactor, a test, a build " +
      "fix — say so and record it:\n" +
      "  npm run changelog -- --none \"internal refactor of the git status parser\"\n",
  );
  return BLOCK;
}

module.exports = { ackPath, id: "changelog-currency", run, userVisibleEdits };
