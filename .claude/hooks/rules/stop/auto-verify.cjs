"use strict";

/**
 * Stop rule — run the verify gate over what this session edited.
 *
 * The first rule in the Stop chain, and the reason the rest of the chain is
 * meaningful: everything after it (the clippy run, the commit reminder) assumes
 * the code is in a state worth acting on. A commit nudge on a tree that does not
 * typecheck is worse than no nudge.
 *
 * Scoped, not full: it passes the session's edited files to `npm run verify`, so
 * the cost is proportional to what changed rather than to the size of the repo.
 * The tracker it reads is CONSUMED on a green run — the next Stop then verifies
 * only what moved since, and a turn that edited nothing costs one file check.
 *
 * Fails open on infrastructure problems (node missing, script missing, timeout)
 * and closed on findings. A gate that cannot run says so as INCONCLUSIVE rather
 * than reporting green, because "the check did not run" and "the check passed"
 * are the two things that must never look alike.
 */

const fs = require("node:fs");
const path = require("node:path");

const { BLOCK, INCONCLUSIVE, NOOP, PASS, cwdOf } = require("../../lib/io.cjs");
const { readTrackerSet, trackerFile } = require("../../lib/session-touched.cjs");
const { spawnTool } = require("../../lib/spawn-tool.cjs");

/** Wall-clock ceiling for the scoped gate. A Stop hook must not hold the turn open forever. */
const TIMEOUT_MS = 240_000;

/** Above this many files, the scoped run is no cheaper than the full one. */
const FULL_RUN_THRESHOLD = 40;

/**
 * Files the verify gate has anything to say about.
 *
 * A changed PNG or lockfile does not need a typecheck, and including it would
 * spend a full gate run on a file no sensor reads.
 */
const RELEVANT_RE = /\.(tsx?|jsx?|cjs|mjs|rs|json|toml|md|css)$/i;

/**
 * The session's edited files, as repo-relative paths the script can consume.
 *
 * @param {string|undefined} sessionId - Stop payload session id.
 * @param {string} cwd - Repo root.
 * @returns {string[]} Relative paths, possibly empty.
 */
function editedFiles(sessionId, cwd) {
  const set = readTrackerSet(sessionId, "edited-files");
  if (!set) return [];
  return [...set]
    .map((abs) => path.relative(cwd, abs).replace(/\\/g, "/"))
    .filter((rel) => rel && !rel.startsWith("..") && RELEVANT_RE.test(rel))
    // A file edited and then deleted is not a finding, it is gone.
    .filter((rel) => fs.existsSync(path.join(cwd, rel)));
}

/**
 * Run the verify gate over the session's edits.
 *
 * @param {object} data - Stop hook payload.
 * @returns {number} NOOP when nothing relevant changed, PASS on green,
 *   INCONCLUSIVE when the gate could not run, BLOCK on findings.
 */
function run(data) {
  // Loop guard: after a block, the Stop hook fires again. Re-running a
  // multi-minute gate on the same tree would make the turn unexitable.
  if (data.stop_hook_active) return NOOP;

  const cwd = cwdOf(data);
  const files = [...new Set(editedFiles(data.session_id, cwd))];
  if (files.length === 0) return NOOP;

  const args =
    files.length > FULL_RUN_THRESHOLD
      ? ["scripts/verify.mjs", "--all"]
      : ["scripts/verify.mjs", "--files", ...files];

  process.stderr.write(
    `[tab-verify] checking ${files.length} edited file(s)${
      files.length > FULL_RUN_THRESHOLD ? " (full run — too many to scope)" : ""
    }...\n`,
  );

  const res = spawnTool("node", args, {
    cwd,
    encoding: "utf8",
    // The child must not re-enter the hook chain: its own Stop hooks would run
    // this gate again, against the same dirty tree.
    env: { ...process.env, TAB_HOOKS_DISABLED: "1" },
    maxBuffer: 8 * 1024 * 1024,
    timeout: TIMEOUT_MS,
  });

  if (res.error || res.status === null) {
    process.stderr.write(
      `[tab-verify] the gate could not run (${
        res.error ? res.error.message : "timed out"
      }). Nothing was verified — treat the tree as unchecked.\n`,
    );
    return INCONCLUSIVE;
  }

  if (res.status === 0) {
    // Consume the tracker: the next Stop verifies only what moves from here.
    try {
      fs.rmSync(trackerFile(data.session_id, "edited-files"), { force: true });
    } catch {
      // A tracker that will not delete costs one redundant run, nothing more.
    }
    return PASS;
  }

  process.stderr.write(
    `${res.stdout || ""}${res.stderr || ""}\n` +
      "[tab-verify] The verify gate found problems in files this session edited.\n" +
      "Fix them before finishing. Each finding names its file and what it wants; if one of them " +
      "is wrong, say so explicitly rather than working around it — the rule is the thing to " +
      "change, not the code that tripped it.\n" +
      "Re-run at any time: `npm run verify -- --files <path...>`\n",
  );
  return BLOCK;
}

module.exports = { editedFiles, id: "auto-verify", run };
