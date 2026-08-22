"use strict";

/**
 * PreToolUse rule — only the version bump writes CHANGELOG version headings.
 *
 * A `## [X.Y.Z] - DATE` heading asserts that a release exists. Its number is only
 * known once `npm run version` has decided it — from the pending Unreleased
 * entries and the bump they imply — so an agent writing one by hand is guessing,
 * and a guessed heading claims a release that was never cut. Nothing downstream
 * catches it: the file still parses, the number still looks plausible, and it now
 * disagrees with package.json, tauri.conf.json, Cargo.toml and the git tag.
 *
 * The rule judges the CHANNEL, not the number. It fires when an edit adds a
 * version the replaced text did not already contain, and it deliberately ignores
 * Bash: the bump writes through Bash, and it is the writer that is allowed.
 * Comparing VERSIONS rather than heading LINES is what keeps a reformat free.
 *
 * What to write instead is the `## [Unreleased]` section — see
 * `changelog-awareness` and `.claude/rules/documentation/changelog.md`.
 */

const path = require("node:path");

const { NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");
const { EDIT_TOOLS, textPair } = require("../../lib/edit-payload.cjs");
const { headingVersions } = require("../../../../scripts/lib/changelog-core.cjs");

/**
 * The file this rule guards, as a repo-relative path.
 *
 * A BASENAME test was the first spelling and it was too loose: matched
 * case-insensitively — which it must be, since the filesystem is — it also
 * claimed `.claude/rules/documentation/changelog.md`, a document ABOUT the
 * format whose job includes showing what a version heading looks like. The rule
 * then blocked the only file that explains it.
 *
 * So the scope is the changelog's position, not its name: the repo root, or a
 * nested one, and never inside the governance tree.
 */
const CHANGELOG_PATH_RE = /^(?:.*\/)?CHANGELOG\.md$/i;

/** The governance tree documents the format and must be able to quote it. */
const DOC_TREE_RE = /^\.claude\//;

/**
 * Block an edit that introduces a version heading the replaced text did not
 * already claim.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP out of scope, PASS when no version is claimed, BLOCK otherwise.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;
  const ti = data.tool_input || {};
  const filePath = ti.file_path;
  if (typeof filePath !== "string") return NOOP;
  const relPath = path.relative(cwdOf(data), filePath).replace(/\\/g, "/");
  if (!CHANGELOG_PATH_RE.test(relPath) || DOC_TREE_RE.test(relPath)) return NOOP;

  const { newText, oldText } = textPair(ti);
  const before = headingVersions(oldText);
  const added = [...headingVersions(newText)].filter((v) => !before.has(v));
  if (added.length === 0) return PASS;

  return deny(
    "tab-changelog",
    "Hand-written version heading",
    `'${relPath}' would add the version heading(s) ${added.map((v) => `\`## [${v}]\``).join(", ")}.\n\n` +
      "Version headings are written by `npm run release` alone — it is the only place the " +
      "number is known, because it derives the bump from the pending Unreleased entries and " +
      "then writes the same number into package.json, tauri.conf.json and Cargo.toml. A " +
      "hand-picked number claims a release nothing backs, and puts four files out of sync.\n\n" +
      "Document the change in the Unreleased section instead:\n" +
      "  npm run changelog -- --added \"Repository list shows the current branch\"\n" +
      "  npm run changelog -- --pending          # what the next release will say\n\n" +
      "Removing or reformatting an existing heading stays free.",
  );
}

module.exports = { id: "changelog-version-heading", run };
