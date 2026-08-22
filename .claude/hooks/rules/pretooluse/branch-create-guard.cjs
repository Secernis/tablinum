"use strict";

/**
 * PreToolUse rule — one active feature branch at a time.
 *
 * Branches are cheap to create and expensive to finish. A repository with six
 * half-done branches has six things that each need rebasing against a moving
 * `main`, six sets of context to reload, and no way to tell which was
 * abandoned. The cost is not the branch, it is the accumulated decision debt.
 *
 * So creating a second one while the first is unmerged is refused, with the list
 * of what already exists. That is not a prohibition on parallel work — it is a
 * prompt to finish, merge, or explicitly abandon the current one first, which
 * takes seconds while the context is still loaded.
 *
 * Deliberately advisory in one direction: the guard only fires on CREATE. The
 * user is free to keep as many branches as they like by creating them
 * themselves.
 */

const { commandSurface } = require("../../lib/bash-command.cjs");
const { gitRead } = require("../../lib/git-readonly.cjs");
const { INCONCLUSIVE, NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");

/** A branch-creating call through the project's channel or through raw git. */
const CREATE_RE =
  /\b(?:npm\s+run\s+branch|node\s+scripts\/branch\.mjs)\b(?![^|;&]*--(?:list|delete|switch|help))|\bgit\s+(?:branch|checkout\s+-b|switch\s+-c)\s+(?!-)/;

/** Branches that are not feature work. */
const BASE_BRANCHES = new Set(["main", "master", "HEAD"]);

/**
 * List local branches that carry commits `main` does not have.
 *
 * @param {string} cwd - Repo root.
 * @returns {string[]|null} Unmerged branch names, or null when git cannot answer.
 */
function unmergedBranches(cwd) {
  const res = gitRead(cwd, ["branch", "--format=%(refname:short)", "--no-merged", "main"], {
    timeout: 3000,
  });
  if (res.status !== 0) return null;
  return res.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !BASE_BRANCHES.has(l));
}

/**
 * Refuse creating a second unmerged feature branch.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP when not a create call, INCONCLUSIVE when git cannot
 *   answer, PASS when the tree is clean of unmerged work, BLOCK otherwise.
 */
function run(data) {
  if (data.tool_name !== "Bash") return NOOP;
  const raw = (data.tool_input && data.tool_input.command) || "";
  const surface = commandSurface(raw);
  if (!CREATE_RE.test(surface)) return NOOP;

  const cwd = cwdOf(data);
  const open = unmergedBranches(cwd);
  if (open === null) return INCONCLUSIVE;

  const current = gitRead(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], { timeout: 2000 });
  const currentBranch = current.status === 0 ? current.stdout.trim() : null;
  // Being ON one of them is the normal case — the guard is about opening ANOTHER.
  const others = open.filter((b) => b !== currentBranch);
  if (others.length === 0) return PASS;

  return deny(
    "tab-guard",
    "A feature branch is already open",
    `Unmerged branch(es) already exist:\n${others.map((b) => `  - ${b}`).join("\n")}\n\n` +
      "Branches are cheap to create and expensive to finish: each one needs rebasing against a " +
      "moving `main`, its own context reloaded, and its own decision about whether it is still " +
      "wanted. Two open at once is how both end up stale.\n\n" +
      "Finish the current one first:\n" +
      "  npm run push                     # verify gate, then push\n" +
      "  npm run branch -- --list         # what exists and how far behind it is\n" +
      "  npm run branch -- --switch <name>\n\n" +
      "If this genuinely needs a parallel branch, say why and let the user create it.",
  );
}

module.exports = { id: "branch-create-guard", run, unmergedBranches };
