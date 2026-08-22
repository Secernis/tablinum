"use strict";

/**
 * PreToolUse rule — no code edits on `main`/`master`.
 *
 * Not a formality: `main` is the branch a release is cut from and the branch a
 * clone lands on. Work done directly on it has no reviewable boundary, cannot be
 * abandoned without rewriting history, and turns every "let me just try
 * something" into a change to the published line.
 *
 * The harness surfaces stay editable on any branch — guard config, rules and
 * memory must be maintainable from wherever you are, and none of them ship.
 *
 * Path handling is the subtle part. A directory can be named more than one way:
 * Windows hands out an 8.3 short alias, every platform can reach one through a
 * link, and git answers `--show-toplevel` with the resolved spelling while the
 * payload carries whichever one the caller used. A raw string compare would then
 * call a repo file "outside the repo" and wave it through.
 */

const fs = require("node:fs");
const path = require("node:path");

const { gitRead } = require("../../lib/git-readonly.cjs");
const { INCONCLUSIVE, NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");
const { EDIT_TOOLS } = require("../../lib/edit-payload.cjs");

/** Surfaces that may be edited on any branch: they configure the tooling, not the product. */
const ALLOWLIST_RE = /^(?:CLAUDE\.md$|\.claude\/|memory\/|\.claude-plugin\/)/;

/**
 * Normalize a path for containment comparison, resolving aliases and links.
 *
 * Two details carry this:
 *   - `realpathSync.native`, not `realpathSync`: the JS implementation walks the
 *     path with `lstat` and PRESERVES an 8.3 component; only the native one
 *     expands it to the long name git reports.
 *   - Resolve the nearest EXISTING ancestor and re-append the rest. `realpath`
 *     can only answer for a path that is on disk, and a Write creating a NEW
 *     file hands us one that is not.
 *
 * @param {string} p - Absolute path (need not exist).
 * @returns {string} Absolute path in one spelling.
 */
function resolveAliases(p) {
  let head = path.resolve(p);
  const tail = [];
  for (;;) {
    try {
      head = fs.realpathSync.native(head);
      break;
    } catch {
      const parent = path.dirname(head);
      // Reached the filesystem root without finding anything on disk — the
      // lexical form is then genuinely all there is.
      if (parent === head) break;
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
  return path.resolve(tail.length > 0 ? path.join(head, ...tail) : head);
}

/**
 * Comparison form of a path: one spelling, one case, one separator.
 *
 * Lowercasing is what makes containment case-insensitive, which Windows needs.
 * It also means this form must NOT be used to build a path the allowlist reads:
 * that pattern matches `CLAUDE.md` case-sensitively.
 *
 * @param {string} p - Absolute path (need not exist).
 * @returns {string} Lowercased, forward-slash path without a trailing separator.
 */
function canonical(p) {
  return resolveAliases(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * Whether an absolute target lies inside the repository rooted at `root`.
 *
 * The separator boundary is the point: a plain prefix test would count a sibling
 * directory (`.../tablinum-alt/x`) as being inside `.../tablinum`.
 *
 * @param {string} root - Canonical repository root.
 * @param {string} target - Absolute target path.
 * @returns {boolean} True when the target belongs to the repository.
 */
function insideRepo(root, target) {
  const t = canonical(target);
  return t === root || t.startsWith(`${root}/`);
}

/**
 * Deny file edits while the working tree sits on a protected branch.
 *
 * A target OUTSIDE the repository is not a repo edit and never reaches the
 * allowlist. That order matters: this allowlist is a NEGATIVE test, so an
 * outside path — which arrives as `../../.claude/plans/x` once made
 * repo-relative — would fail `^\.claude/` and land on the blocking side.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP when out of scope/allowlisted, INCONCLUSIVE when the
 *   branch cannot be read, PASS on a feature branch, BLOCK on main/master.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;
  const target = data.tool_input && data.tool_input.file_path;
  if (!target) return NOOP;

  const cwd = cwdOf(data);
  let branch;
  let root;
  // Same tree as `root`, but in the filesystem's own case: the allowlist reads
  // `CLAUDE.md` case-sensitively, so the comparison form cannot serve it.
  let rootPath;
  try {
    // Both facts in ONE spawn: `rev-parse` answers in argument order, so line 1
    // is the root and line 2 the branch.
    const res = gitRead(cwd, ["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"], {
      timeout: 2000,
    });
    if (res.status !== 0) throw new Error("git rev-parse failed");
    const [top, head] = res.stdout.trim().split("\n");
    if (!top || !head) throw new Error("git rev-parse returned an unexpected shape");
    root = canonical(top);
    rootPath = resolveAliases(top);
    branch = head.trim();
  } catch {
    // Not a git repo or git unavailable — skip rather than false-positive.
    // Recorded as INCONCLUSIVE, not PASS: nothing was verified here, and a gate
    // that silently stops verifying is exactly what telemetry must expose.
    return INCONCLUSIVE;
  }

  const abs = path.resolve(cwd, target);
  if (!insideRepo(root, abs)) return NOOP;
  const rel = path.relative(rootPath, resolveAliases(abs)).replace(/\\/g, "/");
  if (ALLOWLIST_RE.test(rel)) return NOOP;

  if (branch === "main" || branch === "master") {
    return deny(
      "tab-guard",
      "Branch Protection",
      `Editing '${rel}' on the protected branch '${branch}' is blocked.\n\n` +
        "Open a feature branch first:\n" +
        "  npm run branch -- <name>        # creates and switches\n" +
        "  npm run branch -- --list        # what already exists\n\n" +
        "`main` is what a release is cut from and what a clone lands on. Work on it " +
        "has no reviewable boundary and cannot be abandoned without rewriting history.\n" +
        "Exempt on any branch: CLAUDE.md, .claude/**, memory/** — tooling, not product.",
    );
  }
  return PASS;
}

module.exports = { canonical, id: "branch-protection", insideRepo, run };
