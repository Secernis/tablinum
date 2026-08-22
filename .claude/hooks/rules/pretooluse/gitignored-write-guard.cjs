"use strict";

/**
 * PreToolUse rule — writing into a gitignored path needs a reason.
 *
 * A file the repository ignores does not exist for anyone else. Work written
 * there is invisible to review, absent from a clone, and gone the moment the
 * directory is cleaned. The recurring failure mode is not malice, it is
 * misdirection: a module written into `dist/` because that is where the built
 * copy was read from, a fix applied to `node_modules/` because that is where the
 * stack trace pointed.
 *
 * Genuinely temporary work has a home the guard leaves open: the session
 * scratchpad, and `.tmp/` inside the repo. Everything else is blocked with the
 * path's own reason for being ignored.
 *
 * Uses `git check-ignore`, so the answer comes from the same `.gitignore` the
 * repository actually applies rather than from a mirrored pattern list that
 * drifts. INCONCLUSIVE when git cannot answer — a gate that guesses is worse
 * than one that admits it did not run.
 */

const path = require("node:path");

const { gitRead } = require("../../lib/git-readonly.cjs");
const { INCONCLUSIVE, NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");
const { EDIT_TOOLS } = require("../../lib/edit-payload.cjs");

/** Ignored paths that ARE the right place for throwaway work. */
const SCRATCH_OK_RE = /^(?:\.tmp\/|\.claude\/hooks\/state\/)/;

/** Ignored paths whose reason is worth naming back to the agent. */
const REASONS = [
  ["node_modules/", "a dependency tree — patch upstream or vendor deliberately, never in place"],
  ["dist/", "vite build output — change src/ and rebuild"],
  ["src-tauri/target/", "cargo build output — change src-tauri/src/ and rebuild"],
  ["design/", "the private brand authoring tree; it is not in this repository at all"],
  [".env", "local environment — put the KEY in .env.example, never the value"],
];

/**
 * The stated reason a path is ignored, when there is one.
 *
 * @param {string} rel - Repo-relative POSIX path.
 * @returns {string|null} The reason, or null.
 */
function reasonFor(rel) {
  const hit = REASONS.find(([prefix]) => rel.startsWith(prefix));
  return hit ? hit[1] : null;
}

/**
 * Deny writes into gitignored paths that are not scratch space.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP out of scope, PASS for tracked paths, INCONCLUSIVE when
 *   git cannot answer, BLOCK for an ignored path.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;
  const target = data.tool_input && data.tool_input.file_path;
  if (!target) return NOOP;

  const cwd = cwdOf(data);
  const rel = path.relative(cwd, target).replace(/\\/g, "/");
  // Outside the repo entirely (the scratchpad lives there) — not our business.
  if (!rel || rel.startsWith("..")) return NOOP;
  if (SCRATCH_OK_RE.test(rel)) return NOOP;

  // `check-ignore` exits 0 when the path IS ignored, 1 when it is not, and
  // something else on an actual failure — the three are distinct on purpose.
  const res = gitRead(cwd, ["check-ignore", "-q", "--", rel], { timeout: 2000 });
  if (res.status === 1) return PASS;
  if (res.status !== 0) return INCONCLUSIVE;

  const reason = reasonFor(rel);
  return deny(
    "tab-guard",
    "Write into a gitignored path",
    `'${rel}' is ignored by this repository${reason ? ` — ${reason}` : ""}.\n\n` +
      "A file nobody clones is a file nobody reviews. If this is the real fix, it belongs in " +
      "tracked source; if it is throwaway, write it to the session scratchpad or `.tmp/`.\n" +
      "If the path genuinely should be tracked, say so — that is a .gitignore change, and the " +
      "user makes it.",
  );
}

module.exports = { id: "gitignored-write-guard", reasonFor, run };
