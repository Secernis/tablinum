"use strict";

/**
 * PreToolUse rule — every branch is created through the channel, and every
 * name the channel receives normalises to `<prefix>/<kebab-case>`.
 *
 * `npm run branch` already normalises what it is given. What it cannot see is
 * a branch created around it: `git switch -c Feature_Foo` produces a name the
 * listing cannot filter and the delete guard cannot classify, and it looks
 * exactly like every other branch afterwards. So raw creation is channelled
 * the way raw `git commit` is — the channel does something the bare command
 * cannot, and the bare command produces a result that looks identical having
 * skipped it.
 *
 * On the channel itself, the one thing worth refusing at the hook tier is an
 * unknown prefix: `feature/foo` would be swallowed into `feat/feature-foo`
 * silently, and a silent mangling is worse than a refusal.
 *
 * Convention and normaliser are single-sourced in `scripts/lib/git-conventions.cjs`.
 */

const { commandSurface, segments } = require("../../lib/bash-command.cjs");
const { NOOP, PASS, deny } = require("../../lib/io.cjs");
const { normalizeBranchName } = require("../../../../scripts/lib/git-conventions.cjs");

/** Raw creation: `git branch <name>`, `git checkout -b <name>`, `git switch -c <name>`. */
const RAW_CREATE_RE = /\bgit\s+(?:branch\s+(?!-)|checkout\s+-b\s+|switch\s+(?:-c|--create)\s+)(\S+)/;

/** The channel, when it creates rather than lists, switches or deletes. */
const CHANNEL_RE = /\b(?:npm\s+run\s+branch|node\s+scripts\/branch\.mjs)\b/;
const CHANNEL_NON_CREATE_RE = /(?:^|\s)--(?:list|delete|switch|clean|help)(?:\s|=|$)/;

/**
 * The name argument of a channel call: the first token after the call that
 * is not a flag or the `--` separator.
 *
 * @param {string} segment - One command segment.
 * @returns {string|null} The name, or null when there is none.
 */
function channelName(segment) {
  const after = segment.replace(/^.*?\b(?:npm\s+run\s+branch|node\s+scripts\/branch\.mjs)\b/, "");
  const tokens = after.trim().split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (t === "--" || t.startsWith("-")) continue;
    return t.replace(/^["']|["']$/g, "");
  }
  return null;
}

/**
 * Deny raw branch creation, and channel calls with an unknown prefix.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP when nothing creates a branch, PASS when the name
 *   normalises, BLOCK otherwise.
 */
function run(data) {
  if (data.tool_name !== "Bash") return NOOP;
  const raw = (data.tool_input && data.tool_input.command) || "";
  const surface = commandSurface(raw);
  let seen = false;
  for (const segment of segments(surface)) {
    const rawCreate = RAW_CREATE_RE.exec(segment);
    if (rawCreate) {
      const wanted = normalizeBranchName(rawCreate[1]);
      return deny(
        "tab-guard",
        "Raw branch creation",
        `\`${rawCreate[0].trim()}\` creates a branch around the channel.\n\n` +
          "Branches are created through `npm run branch -- <name>`: it normalises the name to " +
          "`<prefix>/<kebab-case>`, refuses a second unmerged branch, and carries uncommitted " +
          "work along. A branch made with raw git skips all of that and looks identical afterwards.\n\n" +
          (wanted.name
            ? `  npm run branch -- ${wanted.name}\n`
            : `  npm run branch -- <prefix>/<name>\n  (${wanted.reason})\n`),
      );
    }
    if (!CHANNEL_RE.test(segment) || CHANNEL_NON_CREATE_RE.test(segment)) continue;
    seen = true;
    const name = channelName(segment);
    if (name === null) continue;
    const { reason } = normalizeBranchName(name);
    if (reason) {
      return deny(
        "tab-guard",
        "Branch name does not normalise",
        `\`npm run branch -- ${name}\`: ${reason}`,
      );
    }
  }
  return seen ? PASS : NOOP;
}

module.exports = { id: "branch-convention", run };
