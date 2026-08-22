"use strict";

/**
 * The one read-only git channel for every hook.
 *
 * Hooks read git constantly — branch name, dirty files, merge-base — and every
 * one of those calls runs under a kill-timeout, because a hook that hangs stalls
 * the turn. That combination produces a recurring defect: a "read-only" git
 * command is not read-only on disk. `git status` and the `diff` family refresh
 * the index stat cache and write it back, taking `.git/index.lock` to do so.
 * Right after a commit that cache is maximally stale, so the refresh is at its
 * most expensive exactly when the Stop hooks fire — and a git process killed
 * mid-refresh strands a 0-byte lock that blocks every later staging call with
 * git's opaque "Unable to create index.lock".
 *
 * Two guarantees live here so no call site has to remember them:
 *
 * 1. The index lock is opted out of, via `--no-optional-locks` on the read-only
 *    subcommands AND `GIT_OPTIONAL_LOCKS=0` in the environment. The env var is
 *    not redundancy — it is inherited, so it also reaches git calls made INSIDE
 *    anything a hook spawns, which an argv flag never could.
 * 2. No shell, ever. A shell-wrapped spawn puts `cmd.exe` between the timeout
 *    and git on Windows: the kill reaches the wrapper and git survives as an
 *    orphan, still holding the lock. The shared `lib/spawn-tool` keeps that
 *    property: git resolves to a real `.exe`, so it routes to argv.
 */

const { spawnTool } = require("./spawn-tool.cjs");

/** Default timeout for a hook's git call. Hooks must never stall a turn. */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Git subcommands that only read, yet still take the index lock without the
 * opt-out. Writing commands are deliberately absent — hooks never write the
 * index, and suppressing the lock there would be a correctness bug, not a fix.
 */
const READ_ONLY_SUBCOMMANDS = new Set([
  "cat-file",
  "check-ignore",
  "diff",
  "for-each-ref",
  "log",
  "ls-files",
  "merge-base",
  "rev-parse",
  "show",
  "status",
  "tag",
]);

/**
 * Main-command options that consume the following token as their value, so a
 * subcommand scan must skip both. `git -c core.quotePath=false status ...` would
 * otherwise read as the subcommand `-c`.
 */
const VALUE_TAKING_GLOBALS = new Set(["-C", "-c", "--git-dir", "--namespace", "--work-tree"]);

/**
 * Finds the subcommand, skipping any leading main-command options.
 *
 * @param {string[]} args - Full git argument list.
 * @returns {string|undefined} The subcommand, or undefined if there is none.
 */
function subcommandOf(args) {
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (VALUE_TAKING_GLOBALS.has(token)) {
      i += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    return token;
  }
  return undefined;
}

/**
 * Runs a read-only git command without touching `.git/index.lock`.
 *
 * @param {string} cwd - Directory to run git in.
 * @param {string[]} args - Git arguments; may start with main-command options.
 * @param {{timeout?: number, maxBuffer?: number}} [options] - Overrides.
 * @returns {{status: number|null, stdout: string, stderr: string, error?: Error}}
 *   stdout/stderr are always strings, never null, so callers need no guard.
 */
function gitRead(cwd, args, options = {}) {
  // The flag is a main-command option, so it goes in front of every other
  // argument — main options may appear in any order among themselves.
  const finalArgs = READ_ONLY_SUBCOMMANDS.has(subcommandOf(args))
    ? ["--no-optional-locks", ...args]
    : args;

  const result = spawnTool("git", finalArgs, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
  });

  return {
    error: result.error,
    status: result.status,
    stderr: result.stderr || "",
    stdout: result.stdout || "",
  };
}

/**
 * Current branch name, or null when git cannot answer.
 *
 * @param {string} cwd - Repo directory.
 * @returns {string|null} Branch name (`HEAD` when detached), or null.
 */
function currentBranch(cwd) {
  const res = gitRead(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], { timeout: 3000 });
  return res.status === 0 ? res.stdout.trim() : null;
}

/**
 * Working-tree status as repo-relative FILE paths.
 *
 * Two details, both learned the hard way:
 *
 * `--untracked-files=all`, because plain porcelain COLLAPSES a new directory to
 * a single `newdir/` entry. Every consumer here asks a per-file question —
 * "did this session write it", "does this need a changelog entry" — and a
 * collapsed directory makes that unanswerable: the entry matches no tracker
 * record, so a directory of entirely session-owned files reads as foreign.
 *
 * No `.trim()` on the whole stdout, because a worktree-only modification starts
 * its line with a real space (` M <path>`), which trim would swallow — and then
 * `slice(3)` bites off the first character of the path.
 *
 * @param {string} cwd - Repo directory.
 * @returns {string[]|null} Dirty paths, or null when git cannot answer.
 */
function dirtyPaths(cwd) {
  const res = gitRead(cwd, ["status", "--porcelain", "--untracked-files=all"], { timeout: 8000 });
  if (res.status !== 0) return null;
  return res.stdout
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => l.slice(3))
    // A rename reads as `old -> new`; the new path is the one that exists.
    .map((p) => (p.includes(" -> ") ? p.split(" -> ")[1] : p))
    .map((p) => p.replace(/^"|"$/g, ""))
    .filter(Boolean);
}

module.exports = { DEFAULT_TIMEOUT_MS, currentBranch, dirtyPaths, gitRead };
