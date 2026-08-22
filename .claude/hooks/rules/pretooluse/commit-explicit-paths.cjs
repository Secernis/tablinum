"use strict";

/**
 * PreToolUse rule — a commit names its paths.
 *
 * The one thing this rule still enforces, and the reason it exists: `-A` and
 * `--all` stage whatever happens to be in the tree. Whatever happens to be in
 * the tree is not a change — it is a moment in time, and a commit made from it
 * describes one thing while containing several. That commit cannot be reverted
 * for the reason it claims, because the revert takes the others with it.
 *
 * Naming the paths is not bureaucracy: it is the act of deciding what this
 * commit IS. Everything else in the atomicity check follows from having made
 * that decision.
 *
 * This rule used to also refuse paths the session's edit tracker could not
 * vouch for. That was removed deliberately (2026-08-22). The tracker sees
 * `Edit`/`MultiEdit`/`Write` and nothing else — not a file written by a script,
 * not a shell redirect, not anything from before the hooks were live — so it
 * called a large share of legitimate work "foreign" and demanded a confirmation
 * ceremony to undo its own blind spot. A gate whose false positives outnumber
 * its catches trains people to route around it, which costs more than the case
 * it was built for. The commit-content guard now lives where it can be accurate:
 * `commit.mjs` refuses a commit whose index already holds files the `--files`
 * list does not name.
 */

const { commandSurface, segments } = require("../../lib/bash-command.cjs");
const { NOOP, PASS, deny } = require("../../lib/io.cjs");

/** A commit invocation through the project's channel. */
const COMMIT_CALL_RE = /\b(?:npm\s+run\s+commit|node\s+scripts\/commit\.mjs)\b/;

/** Stage-everything spellings. */
const STAGE_ALL_RE = /(?:^|\s)(?:-A|--all)(?:\s|$)/;

/**
 * Refuse a commit that stages by sweep rather than by name.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP when not a commit call, PASS when paths are named,
 *   BLOCK on a stage-everything spelling.
 */
function run(data) {
  if (data.tool_name !== "Bash") return NOOP;
  const raw = (data.tool_input && data.tool_input.command) || "";
  const surface = commandSurface(raw);
  if (!COMMIT_CALL_RE.test(surface)) return NOOP;

  // Per SEGMENT, not per command line. Testing the whole surface attributed a
  // flag from a neighbouring call to the commit: `verify --all && commit
  // --inspect` read as a stage-everything commit and was refused. `--all` is a
  // perfectly ordinary flag on other commands in this repo, so the only correct
  // scope is the segment that actually runs the commit.
  const commitSegments = segments(surface).filter((s) => COMMIT_CALL_RE.test(s));
  if (!commitSegments.some((s) => STAGE_ALL_RE.test(s))) return PASS;

  return deny(
    "tab-guard",
    "Stage-everything commit",
    "`-A` / `--all` stages whatever happens to be in the tree, which is a moment in time " +
      "rather than a change. The resulting commit describes one thing and contains several, " +
      "and it cannot be reverted for the reason it claims.\n\n" +
      "Name the paths — that is the act of deciding what this commit is:\n" +
      "  npm run commit -- --inspect                       # what is dirty, grouped\n" +
      '  npm run commit -- --files <path...> --type <type> --message "..." --body "..."\n\n' +
      "Several separate pieces of work is not a reason to wait: one atomic commit per piece.",
  );
}

module.exports = { id: "commit-explicit-paths", run };
