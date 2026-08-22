"use strict";

/**
 * PreToolUse rule — commit only what this session actually changed.
 *
 * The failure mode is quiet and common: the working tree holds changes from more
 * than one source — a parallel agent session, the user's own editor, a generator
 * — and a commit that stages by directory or by `-A` sweeps them all in. The
 * result is a commit whose message describes one change and whose diff contains
 * three, attributed to whoever ran the command.
 *
 * So an explicit `--files` list is checked against the session's own edit
 * tracker. A path this session never touched is refused with the list of which
 * ones those are, rather than silently included.
 *
 * Registered AFTER `bash-gates` on purpose: a channel violation (a raw `git
 * commit`) is the more fundamental finding and should be the one the agent sees.
 * This rule only judges the CONTENT of an otherwise valid commit call.
 */


const fs = require("node:fs");
const path = require("node:path");

const { commandSurface } = require("../../lib/bash-command.cjs");
const { dirtyPaths } = require("../../lib/git-readonly.cjs");
const { EXCUSED, INCONCLUSIVE, NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");
const { isSessionOwned, sessionTouchedSet } = require("../../lib/session-touched.cjs");
const { stateDir } = require("../../lib/state-dir.cjs");

/** How long an unused confirmation stays valid — mirrors `tab-confirm-commit.cjs`. */
const CONFIRM_TTL_MS = 10 * 60 * 1000;

/**
 * Consume a fresh user confirmation, if one is present.
 *
 * Written only by `tab-confirm-commit.cjs`, which the USER runs in their own
 * terminal — an agent-written flag would be the gate granting itself an
 * exemption. Deleted on consumption, so one confirmation authorises exactly one
 * commit rather than a window of them.
 *
 * @param {boolean} consume - Whether to spend the confirmation (false on a dry run).
 * @returns {boolean} True when a valid confirmation was present.
 */
function takeConfirmation(consume) {
  const flag = path.join(stateDir(), "commit-confirm");
  try {
    if (Date.now() - fs.statSync(flag).mtimeMs > CONFIRM_TTL_MS) {
      // Expired rather than absent: clear it so a stale flag cannot excuse a
      // commit nobody was looking at when they approved one.
      fs.rmSync(flag, { force: true });
      return false;
    }
  } catch {
    return false;
  }
  if (consume) {
    try {
      fs.rmSync(flag, { force: true });
    } catch {
      // A flag that will not delete would authorise a second commit; say so
      // rather than letting it linger silently.
      process.stderr.write(
        "[tab-guard] the commit confirmation could not be cleared — remove " +
          ".claude/hooks/state/commit-confirm by hand.\n",
      );
    }
  }
  return true;
}

/** A commit invocation through the project's channel. */
const COMMIT_CALL_RE = /\b(?:npm\s+run\s+commit|node\s+scripts\/commit\.mjs)\b/;

/** Stage-everything spellings, which cannot be checked path by path. */
const STAGE_ALL_RE = /(?:^|\s)(?:-A|--all)(?:\s|$)/;

/**
 * Extract the paths of a `--files a b c` argument list.
 *
 * The list ends at the next flag or at the end of the segment.
 *
 * @param {string} surface - The command surface.
 * @returns {string[]} The listed paths.
 */
function filesArgument(surface) {
  const at = surface.indexOf("--files");
  if (at === -1) return [];
  const rest = surface.slice(at + "--files".length).trim();
  const out = [];
  for (const word of rest.split(/\s+/)) {
    if (!word || word.startsWith("-")) break;
    // `QUOTED` is the placeholder `commandSurface` leaves for quoted data; a
    // quoted path cannot be checked, so treat the list as unreadable.
    if (word === "QUOTED") return [];
    out.push(word);
  }
  return out;
}

/**
 * Whether a listed path is this session's to commit.
 *
 * A path is owned when the tracker holds it, OR — when it names a DIRECTORY —
 * when every dirty file beneath it is owned. Naming a directory is an ordinary
 * way to name a set of files, and a file tracker never contains a directory
 * entry, so testing the literal string refused a legitimate spelling of a set
 * the session entirely owns. An empty directory (nothing dirty under it) is not
 * treated as owned: there is nothing there to have written.
 *
 * A single foreign file underneath still fails the whole directory, which is the
 * property that keeps this from becoming the loophole.
 *
 * @param {Set<string>} touched - The session's touched set.
 * @param {string} cwd - Absolute repo root.
 * @param {string} listed - One repo-relative path from the `--files` list.
 * @param {string[]|null} dirty - Dirty paths, or null when git could not answer.
 * @returns {boolean} True when the session may commit this path.
 */
function isOwnedPath(touched, cwd, listed, dirty) {
  if (isSessionOwned(touched, cwd, listed)) return true;
  if (!dirty) return false;
  const under = dirty.filter((p) => p === listed || p.startsWith(`${listed}/`));
  return under.length > 0 && under.every((p) => isSessionOwned(touched, cwd, p));
}

/**
 * Refuse a commit that would include files this session never edited.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP when not a commit call, INCONCLUSIVE when ownership
 *   cannot be established, PASS when every path is owned, BLOCK otherwise.
 */
function run(data) {
  if (data.tool_name !== "Bash") return NOOP;
  const raw = (data.tool_input && data.tool_input.command) || "";
  const surface = commandSurface(raw);
  if (!COMMIT_CALL_RE.test(surface)) return NOOP;

  if (STAGE_ALL_RE.test(surface)) {
    return deny(
      "tab-guard",
      "Stage-everything commit",
      "Committing with `-A` / `--all` stages whatever else happens to be in the tree — a " +
        "parallel session's work, the user's own edits, generator output.\n\n" +
        "Name the paths instead:\n" +
        "  npm run commit -- --files <path...> --type <type> --message \"...\"\n" +
        "  npm run commit -- --inspect        # what is dirty, grouped, before you decide",
    );
  }

  const files = filesArgument(surface);
  if (files.length === 0) return NOOP;

  const touched = sessionTouchedSet(data.session_id);
  // No tracker means the session has not edited anything through the edit tools;
  // the paths may still be legitimate (a Bash-written generator artefact), so
  // this rule cannot decide — and a gate that guesses is worse than one that says so.
  if (touched === null || touched.size === 0) return INCONCLUSIVE;

  const cwd = cwdOf(data);
  const dirty = dirtyPaths(cwd);
  const foreign = files
    .map((f) => f.replace(/\\/g, "/").replace(/\/+$/, ""))
    .filter((f) => !isOwnedPath(touched, cwd, f, dirty));
  if (foreign.length === 0) return PASS;

  // A confirmation the user typed in their own terminal, for exactly one commit.
  // Not consumed on a dry run: a preview must not spend the authorisation for
  // the real call that follows it.
  if (takeConfirmation(!/--dry-run\b/.test(surface))) {
    process.stderr.write(
      `[tab-guard] ${foreign.length} path(s) outside the edit record, allowed by the user's ` +
        "confirmation (single-use, now spent).\n",
    );
    return EXCUSED;
  }

  return deny(
    "tab-guard",
    "Commit includes files this session did not edit",
    `These paths are not in this session's edit record:\n${foreign.map((f) => `  - ${f}`).join("\n")}\n\n` +
      "They may belong to a parallel session, to the user's own editor, or to a generator. " +
      "A commit whose message describes one change and whose diff carries three is unrevertable " +
      "in practice — the revert takes the other two with it.\n\n" +
      "Commit only what you changed. If one of these paths IS yours — written through a script " +
      "or a shell redirect, or before the hooks were live — the tracker cannot see it either " +
      "way. Say WHICH paths and WHY, and let the user confirm with:\n" +
      "  node .claude/hooks/tab-confirm-commit.cjs\n" +
      "That authorises ONE commit for ten minutes. Do not run it yourself.\n\n" +
      `Owned paths in this call: ${files.length - foreign.length}.`,
  );
}

module.exports = { filesArgument, id: "commit-foreign-hunk", isOwnedPath, run };
