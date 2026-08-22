"use strict";

/**
 * Stop rule — commit finished, verified work before stopping.
 *
 * The LAST rule in the Stop chain, and that position is the contract: because the
 * dispatcher short-circuits on the first block, this reminder only ever fires
 * when the verify gate, clippy, the tests and the CHANGELOG duty are all green.
 * A commit nudge on a tree that does not typecheck would be advice to commit
 * something broken.
 *
 * Session ownership is the other half. Only files THIS session edited are
 * nudged; dirty files from a parallel session or from the user's own editor are
 * reported as a count and explicitly left alone. Committing someone else's work
 * inside your own commit is the failure this prevents, and it is invisible
 * afterwards.
 *
 * Silent in three cases, all deliberate:
 *   - on `main`/`master`, where committing is blocked anyway
 *   - on a second Stop (`stop_hook_active`), where the agent has already decided
 *   - while `.claude/iteration.lock` exists — the user's own "stop nagging"
 *     switch for a visual iteration loop
 */

const fs = require("node:fs");
const path = require("node:path");

const { BLOCK, EXCUSED, INCONCLUSIVE, NOOP, cwdOf } = require("../../lib/io.cjs");
const { currentBranch, dirtyPaths } = require("../../lib/git-readonly.cjs");
const { isSessionOwned, sessionTouchedSet } = require("../../lib/session-touched.cjs");

/** How many paths to name before summarising the rest. */
const DISPLAY_CAP = 20;

/**
 * Remind the agent to commit its own finished work.
 *
 * @param {object} data - Stop hook payload.
 * @returns {number} NOOP when there is nothing to say, EXCUSED under the
 *   iteration lock, INCONCLUSIVE when git cannot answer, BLOCK with the reminder.
 */
function run(data) {
  if (data.stop_hook_active) return NOOP;

  const cwd = cwdOf(data);
  const branch = currentBranch(cwd);
  if (branch === null) return INCONCLUSIVE;
  // Committing is blocked on the protected branch; a reminder there is advice to
  // do something the next gate will refuse.
  if (branch === "main" || branch === "master" || branch === "HEAD") return NOOP;

  const dirty = dirtyPaths(cwd);
  if (dirty === null) return INCONCLUSIVE;
  if (dirty.length === 0) return NOOP;

  const touched = sessionTouchedSet(data.session_id);
  // No tracker means this session edited nothing — there is nothing of its own
  // to remind it about, whatever else is dirty.
  if (touched === null || touched.size === 0) return NOOP;

  const owned = dirty.filter((f) => isSessionOwned(touched, cwd, f));
  const foreign = dirty.length - owned.length;
  if (owned.length === 0) return NOOP;

  // The user's explicit "not now" switch, for a visual iteration loop where a
  // commit per tweak would be meaningless.
  try {
    if (fs.existsSync(path.join(cwd, ".claude", "iteration.lock"))) return EXCUSED;
  } catch {
    // Unreadable lock: fall through and remind.
  }

  const list = owned.slice(0, DISPLAY_CAP).map((f) => `  - ${f}`).join("\n");
  const more = owned.length > DISPLAY_CAP ? `\n  ... and ${owned.length - DISPLAY_CAP} more` : "";
  // Deliberately does NOT claim these belong to someone else. The tracker sees
  // Edit/MultiEdit/Write and nothing else, so a file written by a script, by a
  // shell redirect, or before the hooks were live is absent from it for reasons
  // that say nothing about who wrote it. Asserting "leave them alone" was wrong
  // often enough to be worth not asserting: it told this very session to abandon
  // 67 of its own files.
  const foreignNote =
    foreign > 0
      ? `\n(${foreign} further uncommitted file(s) are not in this session's edit record. ` +
        "That can mean a parallel session or the user's own editor — but also a file this " +
        "session wrote through a script, which the record never sees. Check before including " +
        "or excluding them.)\n"
      : "";

  process.stderr.write(
    `[tab-commit] ${owned.length} uncommitted file(s) from this session on '${branch}':\n` +
      `${list}${more}\n${foreignNote}\n` +
      "The verify gate is green — these are safe to commit. Before you do, check the change is " +
      "ATOMIC. All four have to hold:\n" +
      "  1. One reason to revert (exactly one decision, fix or feature)\n" +
      "  2. The subject needs no \"and\" to describe it\n" +
      "  3. The touched files are explainable from that one reason\n" +
      "  4. It stands on its own (compiles, verifies, no half-migration)\n\n" +
      "  npm run commit -- --inspect                      # what is dirty, grouped, before deciding\n" +
      "  npm run commit -- --files <path...> --type <type> --message \"...\" --yes\n" +
      "  npm run commit -- --dry-run ...                  # preview, no commit\n\n" +
      "Several separate pieces of work is NOT a reason to wait: make one atomic commit per " +
      "piece. Only genuinely half-finished work gets left behind — and then say which part and " +
      "why, and commit the rest.\n",
  );
  return BLOCK;
}

module.exports = { id: "commit-reminder", run };
