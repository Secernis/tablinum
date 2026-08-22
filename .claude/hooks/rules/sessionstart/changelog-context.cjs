"use strict";

/**
 * SessionStart rule — what the next release currently says.
 *
 * The `## [Unreleased]` section is the running record of everything that has
 * landed since the last version. Stating it at session start does two things: it
 * shows what the previous sessions considered worth telling a user, which is the
 * best available summary of where the project actually is — and it makes the
 * absence visible. An empty Unreleased section after a week of commits is not a
 * quiet state, it is a documentation debt with a shape.
 *
 * Silent when the file does not exist yet: a repository without a CHANGELOG has a
 * different problem, and the verify gate reports that one.
 */

const fs = require("node:fs");
const path = require("node:path");

const { cwdOf } = require("../../lib/io.cjs");
const { impliedBump, unreleasedEntries } = require("../../../../scripts/lib/changelog-core.cjs");

/** How many pending entries to name before summarising the rest. */
const SAMPLE = 6;

/**
 * Build the changelog-context fragment.
 *
 * @param {object} data - SessionStart hook payload.
 * @returns {{additionalContext: string}|null} The fragment, or null when there is
 *   no CHANGELOG to read.
 */
function collect(data) {
  const cwd = cwdOf(data);
  let text;
  try {
    text = fs.readFileSync(path.join(cwd, "CHANGELOG.md"), "utf8");
  } catch {
    return null;
  }

  const entries = unreleasedEntries(text);
  if (entries.length === 0) {
    return {
      additionalContext:
        "[tab-changelog] `## [Unreleased]` is empty — nothing is documented for the next " +
        "release yet.\nWhen you change something a user would notice, record it as you go: " +
        '`npm run changelog -- --added "..."` (or --changed / --fixed / --removed / ' +
        "--deprecated / --security).",
    };
  }

  const shown = entries.slice(0, SAMPLE).map((e) => `  ${e.category}: ${e.text}`);
  const more = entries.length > SAMPLE ? `\n  ... and ${entries.length - SAMPLE} more` : "";
  return {
    additionalContext:
      `[tab-changelog] Pending for the next release (${entries.length} entr${
        entries.length === 1 ? "y" : "ies"
      }, implies a \`${impliedBump(text)}\` bump):\n${shown.join("\n")}${more}\n` +
      "Add to this section as you work, not at release time — by then the only source left is " +
      "`git log`, which records what changed in the code rather than what changed for the user.",
  };
}

module.exports = { collect, id: "changelog-context" };
