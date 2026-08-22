#!/usr/bin/env node
/**
 * Write the CHANGELOG as work lands.
 *
 *   npm run changelog -- --added "Repository list shows the current branch"
 *   npm run changelog -- --fixed "Cloning over SSH no longer fails when the key has a passphrase"
 *   npm run changelog -- --pending          # what the next release currently says
 *   npm run changelog -- --check            # validate the file against the schema
 *   npm run changelog -- --none "internal refactor of the status parser"
 *
 * Why a script rather than editing the file: placing an entry correctly means
 * knowing where the Unreleased section is, which category it belongs under, and
 * in what order the categories go. That is three chances to get the file's shape
 * wrong for something that should take one line — and a changelog that drifts out
 * of shape stops being parseable, which is what the release cut depends on.
 *
 * `--none` is a first-class option, not an escape hatch. A refactor, a test or a
 * build fix genuinely has nothing a user would notice, and saying so is a
 * decision. It writes a per-session marker the Stop-time reminder reads, so the
 * declaration is recorded rather than merely tolerated.
 *
 * What it deliberately will NOT do: write a `## [X.Y.Z]` heading. Only
 * `npm run release` knows the number, because only it decides the bump and writes
 * it into the other three version files at the same time.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { ExitCode, ROOT, fail, info, ok, parseArgs, step, style, warn } from "./lib/shell.mjs";

const require = createRequire(import.meta.url);
const {
  CATEGORIES,
  addUnreleasedEntry,
  impliedBump,
  unreleasedEntries,
  validateSchema,
} = require("./lib/changelog-core.cjs");

const FILE = join(ROOT, "CHANGELOG.md");

/** Flag names map one-to-one onto the six categories, lowercased. */
const SPEC = {
  added: "string",
  changed: "string",
  check: "boolean",
  deprecated: "string",
  fixed: "string",
  help: "boolean",
  none: "string",
  pending: "boolean",
  removed: "string",
  security: "string",
};

const HELP = `
${style.bold("npm run changelog")} — document a change while you still know what it means

  --added <text>        a new capability the user can now use
  --changed <text>      existing behaviour that now works differently
  --deprecated <text>   something that still works but is going away
  --removed <text>      something that is gone
  --fixed <text>        a defect the user could hit, now fixed
  --security <text>     a weakness that was closed

  --pending             show what the next release currently says
  --check               validate the file against the schema
  --none <reason>       declare this change has nothing user-visible

Write from the user's side, in English, one line per user-visible change:
  ${style.green("good")}  "Cloning over SSH no longer fails when the key has a passphrase"
  ${style.red("bad")}   "refactor ssh auth handler"

Version headings (${style.dim("## [X.Y.Z]")}) are written by ${style.bold("npm run release")} alone.
`;

/**
 * Read the CHANGELOG, or fail with an actionable message.
 *
 * @returns {string} File content.
 */
function readChangelog() {
  try {
    return readFileSync(FILE, "utf8");
  } catch {
    return fail(
      "CHANGELOG.md is missing. Create it with a `# Changelog` heading and a `## [Unreleased]` section, " +
        "or run `npm run verify -- --all`, which reports the same thing.",
    );
  }
}

/**
 * Record that this session declared nothing user-visible.
 *
 * The marker is per session, so the declaration applies to the work in flight
 * rather than becoming a permanent opt-out.
 *
 * @param {string} reason - Why there is nothing to document.
 * @returns {void}
 */
function writeNoneMarker(reason) {
  const sessionId = process.env.CLAUDE_SESSION_ID || process.env.TAB_SESSION_ID;
  if (!sessionId) {
    warn(
      "no session id in the environment — the declaration is recorded here but the Stop reminder " +
        "will not see it. Say in your reply why nothing is user-visible.",
    );
    return;
  }
  const file = join(
    ROOT,
    ".claude",
    "hooks",
    "state",
    "changelog-ack",
    sessionId.replace(/[^A-Za-z0-9_-]/g, "_"),
  );
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${new Date().toISOString()}  ${reason}\n`, "utf8");
}

/**
 * Print the pending section.
 *
 * @param {string} text - File content.
 * @returns {void}
 */
function printPending(text) {
  const entries = unreleasedEntries(text);
  step("pending for the next release");
  if (entries.length === 0) {
    info("nothing documented yet.");
    return;
  }
  for (const category of CATEGORIES) {
    const rows = entries.filter((e) => e.category === category);
    if (rows.length === 0) continue;
    process.stdout.write(`  ${style.cyan(category)}\n`);
    for (const row of rows) process.stdout.write(`    - ${row.text}\n`);
  }
  process.stdout.write(`\n  implies a ${style.bold(impliedBump(text))} bump\n`);
}

/**
 * Entry point.
 *
 * @returns {void}
 */
function main() {
  const args = parseArgs(process.argv.slice(2), SPEC);
  if (args.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  if (args.check) {
    const problems = validateSchema(readChangelog());
    step("changelog schema");
    if (problems.length === 0) {
      ok("well-formed.");
      return;
    }
    for (const p of problems) warn(p);
    process.exit(ExitCode.FAILED);
  }

  if (args.pending) {
    printPending(readChangelog());
    return;
  }

  if (args.none !== undefined) {
    if (String(args.none).trim().length < 8) {
      fail(
        "`--none` needs a real reason — one clause saying why nothing here is user-visible " +
          '(e.g. "internal refactor of the git status parser").',
        ExitCode.USAGE,
      );
    }
    writeNoneMarker(args.none);
    step("nothing user-visible");
    ok(`recorded: ${args.none}`);
    info("If that turns out to be wrong, add the entry — this declaration is not binding.");
    return;
  }

  const chosen = CATEGORIES.filter((c) => args[c.toLowerCase()] !== undefined);
  if (chosen.length === 0) {
    process.stdout.write(`${HELP}\n`);
    fail("nothing to do — pass one of the category flags, or --pending / --check.", ExitCode.USAGE);
  }

  let text = readChangelog();
  step("changelog");
  for (const category of chosen) {
    const entry = String(args[category.toLowerCase()]).trim();
    if (entry.length < 10) {
      fail(
        `\`--${category.toLowerCase()}\` needs a real sentence. One line, from the user's side — ` +
          "what can they now do, or what stopped going wrong.",
        ExitCode.USAGE,
      );
    }
    // A commit-subject-shaped entry is the failure this file exists to avoid.
    if (/^(?:refactor|chore|wip|fix|feat|test|docs|style|ci)\b[: ]/i.test(entry)) {
      warn(
        `"${entry}" reads like a commit subject. The changelog answers what changed for the ` +
          "person using the app, not what changed in the code.",
      );
    }
    text = addUnreleasedEntry(text, category, entry);
    ok(`${style.cyan(category)}: ${entry}`);
  }
  writeFileSync(FILE, text, "utf8");

  const problems = validateSchema(text);
  if (problems.length > 0) {
    step("schema");
    for (const p of problems) warn(p);
  }
  info(`${unreleasedEntries(text).length} entr(y|ies) pending — \`npm run changelog -- --pending\``);
}

main();
