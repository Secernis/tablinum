"use strict";

/**
 * PreToolUse rule — the git channel, and the commands that are never worth it.
 *
 * Three separate concerns share this rule because they share one input surface:
 *
 * 1. CHANNEL. Committing, pushing and releasing go through the scripts in
 *    `scripts/`, not through raw git. Not ceremony — each script does something
 *    the bare command cannot: `commit` checks atomicity and reminds about the
 *    CHANGELOG, `push` runs the verify gate before anything leaves the machine,
 *    `release` keeps four version files and the tag in agreement. A raw `git
 *    commit` skips all of it silently, and the result looks identical.
 *
 * 2. BYPASS FLAGS. `--no-verify` turns off the checks the commit exists to pass.
 *    There is no situation where the right answer is to disable verification and
 *    commit anyway; if a check is wrong, the check is what gets fixed.
 *
 * 3. IRREVERSIBILITY. `git reset --hard`, `git clean -fdx`, `git push --force`
 *    and `rm -rf` destroy work that has no other copy. They are not forbidden —
 *    they are the user's to run, in their own terminal, having seen what is
 *    about to be lost.
 *
 * Judged on the COMMAND SURFACE (see `lib/bash-command.cjs`), so a flag quoted
 * inside a commit message is not mistaken for a real one, and a command hidden
 * behind `bash -c "..."` still is one.
 */

const { commandSurface, effectiveCommandWord, segments } = require("../../lib/bash-command.cjs");
const { NOOP, PASS, deny, noteDetail } = require("../../lib/io.cjs");

/**
 * Read-only git subcommands. Everything an agent needs to UNDERSTAND the
 * repository stays open — the channel only governs what MUTATES it.
 */
const READ_ONLY_GIT = new Set([
  "status", "log", "diff", "show", "blame", "branch", "ls-files", "rev-parse", "describe",
  "shortlog", "reflog", "cat-file", "merge-base", "remote", "config", "stash", "worktree",
  "for-each-ref", "check-ignore", "grep", "count-objects", "fsck", "switch", "checkout", "restore",
]);

/** Mutating git subcommands that must go through a script, with the script to use. */
const CHANNELLED_GIT = new Map([
  ["commit", { script: "npm run commit", why: "it checks the change is atomic, refuses a subject that describes two changes, and reminds you to document the change in the CHANGELOG" }],
  ["push", { script: "npm run push", why: "it runs the verify gate before anything leaves the machine, so a red branch cannot reach the remote" }],
  ["tag", { script: "npm run release", why: "a tag is only meaningful together with the four version files it names; the release script writes them in one step" }],
]);

/** Flags that disable verification. */
const BYPASS_FLAGS = [
  ["--no-verify", "skips the pre-commit and pre-push hooks — the checks the commit exists to pass"],
  ["-n", null], // only meaningful for commit/push; handled positionally below
  ["--no-gpg-sign", "drops the signature this repository's commits carry"],
];

/** Destructive commands, with what each one costs. */
const DESTRUCTIVE = [
  [/\bgit\s+reset\s+--hard\b/, "git reset --hard", "throws away every uncommitted change in the working tree, with no undo"],
  [/\bgit\s+clean\s+-[a-z]*f/, "git clean -f", "deletes untracked files permanently — including ones you have not committed yet"],
  [/\bgit\s+push\s+[^|;&]*(?:--force(?!-with-lease)|(?:^|\s)-f(?:\s|$))/, "git push --force", "overwrites the remote branch, discarding whatever was there"],
  [/\bgit\s+checkout\s+--\s+\./, "git checkout -- .", "discards every unstaged change in the tree"],
  [/\bgit\s+branch\s+-D\b/, "git branch -D", "deletes a branch even when it holds unmerged commits"],
  [/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/, "rm -rf", "removes a directory tree with no recovery path"],
  [/\bgit\s+filter-branch\b|\bgit\s+update-ref\s+-d\b/, "history rewriting", "rewrites published history"],
];

/**
 * The git subcommand of a segment, if the segment runs git.
 *
 * @param {string} segment - One command segment.
 * @returns {string|null} The subcommand, or null when the segment is not git.
 */
function gitSubcommand(segment) {
  if (effectiveCommandWord(segment) !== "git") return null;
  const words = segment.trim().split(/\s+/).filter(Boolean);
  const gitAt = words.findIndex((w) => /(?:^|[\\/])git(?:\.exe)?$/i.test(w));
  if (gitAt === -1) return null;
  for (let i = gitAt + 1; i < words.length; i += 1) {
    const w = words[i];
    if (w === "-C" || w === "-c" || w === "--git-dir" || w === "--work-tree") {
      i += 1;
      continue;
    }
    if (w.startsWith("-")) continue;
    return w;
  }
  return null;
}

/**
 * Deny raw mutating git, bypass flags and destructive commands.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP for non-Bash, PASS when clean, BLOCK otherwise.
 */
function run(data) {
  if (data.tool_name !== "Bash") return NOOP;
  const raw = (data.tool_input && data.tool_input.command) || "";
  if (!raw) return NOOP;
  const surface = commandSurface(raw);

  // 1. Destructive commands, first: they are the most expensive mistake and the
  // message should be about the loss, not about a channel.
  for (const [re, name, cost] of DESTRUCTIVE) {
    if (re.test(surface)) {
      noteDetail("destructive");
      return deny(
        "tab-guard",
        `Destructive command: ${name}`,
        `This command ${cost}.\n\n` +
          "Not forbidden — but it is the user's to run, in their own terminal, having seen " +
          "what is about to disappear. Tell them exactly what you would run and why, and let " +
          "them decide.\n\n" +
          "If you were trying to get to a clean state: `git stash` keeps the work, " +
          "`git restore <path>` is scoped to one file, and `npm run branch -- --list` shows " +
          "what already exists before you delete anything.",
      );
    }
  }

  for (const segment of segments(surface)) {
    const sub = gitSubcommand(segment);
    if (!sub) continue;

    // 2. Bypass flags on a mutating command.
    if (/--no-verify\b/.test(segment)) {
      noteDetail("bypass");
      return deny(
        "tab-guard",
        "Verification bypass",
        `\`--no-verify\` ${BYPASS_FLAGS[0][1]}.\n\n` +
          "A failing check is information. If it is right, fix what it found; if it is wrong, " +
          "fix the check — both are cheaper than a commit that quietly did not pass.\n\n" +
          "There is no case where the correct move is to disable verification and commit anyway.",
      );
    }

    // 3. Channel.
    const channelled = CHANNELLED_GIT.get(sub);
    if (channelled && !READ_ONLY_GIT.has(sub)) {
      // `git tag` without arguments and `git branch` only LIST — those stay open.
      if (sub === "tag" && /\bgit\s+tag\s*(?:--list|-l)?\s*$/.test(segment)) continue;
      noteDetail(sub);
      return deny(
        "tab-guard",
        `Use the ${sub} channel`,
        `Raw \`git ${sub}\` is blocked. Use:\n  ${channelled.script}\n\n` +
          `Why: ${channelled.why}.\n\n` +
          "The raw command produces something that looks identical and skipped all of it — " +
          "which is exactly why the channel is enforced rather than recommended.\n\n" +
          `Run \`${channelled.script} -- --help\` for the flags, including the non-interactive ones.`,
      );
    }
  }

  return PASS;
}

module.exports = { CHANNELLED_GIT, DESTRUCTIVE, gitSubcommand, id: "bash-gates", run };
