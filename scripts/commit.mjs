#!/usr/bin/env node
/**
 * Commit — one atomic change, described in one sentence.
 *
 *   npm run commit -- --inspect
 *   npm run commit -- --files src/App.tsx --type feat --message "show the current branch" --yes
 *   npm run commit -- --files ... --type fix --message "..." --body-file notes.md
 *   npm run commit -- --files ... --dry-run
 *
 * The message is built deterministically from flags — there is no AI in this
 * path. A generated commit message describes the diff, and the diff is already
 * in the commit; what a message owes the reader is the REASON, which only the
 * author knows.
 *
 * Three things happen here that a raw `git commit` does not do:
 *
 *   ATOMICITY. The subject is checked for the conjunction that gives away a
 *   non-atomic change ("add X and fix Y" is two commits), and the declared type
 *   is checked against what the diff actually contains — a `feat` whose diff is
 *   only documentation is refused. An unrevertable commit is one that bundled two
 *   reasons; the revert then takes the second one with it.
 *
 *   STAGING BY NAME. Files are named explicitly and staged individually. `-A`
 *   sweeps in whatever else is in the tree — a parallel session's work, the
 *   user's own edits — and afterwards nothing distinguishes them.
 *
 *   SECRETS. The staged content is scanned before the commit, not after. A secret
 *   that reaches the history has to be rotated, not removed.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import {
  ExitCode,
  ROOT,
  currentBranch,
  fail,
  git,
  gitRead,
  info,
  ok,
  parseArgs,
  status,
  step,
  style,
  warn,
} from "./lib/shell.mjs";

const require = createRequire(import.meta.url);
const secretWrite = require("../.claude/hooks/rules/pretooluse/secret-write.cjs");
const { unreleasedEntries } = require("./lib/changelog-core.cjs");

const SPEC = {
  "body-file": "string",
  body: "string",
  "dry-run": "boolean",
  files: "list",
  help: "boolean",
  inspect: "boolean",
  message: "string",
  scope: "string",
  type: "string",
  yes: "boolean",
};

/**
 * Conventional commit types, with what each one claims and whether it is
 * something a user would notice.
 */
const TYPES = {
  build: { userVisible: false, what: "the build system or dependencies" },
  chore: { userVisible: false, what: "housekeeping with no effect on the product" },
  ci: { userVisible: false, what: "the CI configuration" },
  docs: { userVisible: false, what: "documentation only" },
  feat: { userVisible: true, what: "a capability the user did not have before" },
  fix: { userVisible: true, what: "a defect the user could hit" },
  perf: { userVisible: true, what: "the same behaviour, measurably faster" },
  refactor: { userVisible: false, what: "structure only — behaviour is unchanged" },
  revert: { userVisible: true, what: "an earlier commit undone" },
  style: { userVisible: false, what: "formatting only" },
  test: { userVisible: false, what: "tests only" },
};

const HELP = `
${style.bold("npm run commit")} — one atomic change, described in one sentence

  --inspect                     what is dirty, grouped, with a suggested type
  --files <path...>             the paths to commit (named, never swept)
  --type <${Object.keys(TYPES).join("|")}>
  --message <subject>           imperative, lowercase, no trailing period
  --body <text> | --body-file <path>
  --scope <name>                optional conventional-commit scope
  --dry-run                     show the commit that would be made
  --yes                         no prompts

Atomicity — all four have to hold:
  1. One reason to revert
  2. The subject needs no "and"
  3. The touched files follow from that one reason
  4. It stands on its own (compiles, verifies, no half-migration)
`;

/**
 * Classify what a set of paths actually contains.
 *
 * Used to check the declared type against reality: a `feat` whose diff is only
 * markdown is a mislabelled commit, and the label is what a reader trusts.
 *
 * @param {string[]} files - Repo-relative paths.
 * @returns {{docsOnly: boolean, testsOnly: boolean, hasSource: boolean}} The shape.
 */
function diffShape(files) {
  const isDoc = (f) => /\.(md|txt)$/i.test(f) || /^(?:LICENSE|TRADEMARK)/.test(f);
  const isTest = (f) => /\.(test|spec)\.[tj]sx?$/.test(f) || /(?:^|\/)__tests__\//.test(f);
  const isSource = (f) => /\.(tsx?|jsx?|cjs|mjs|rs|css)$/.test(f) && !isTest(f);
  return {
    docsOnly: files.length > 0 && files.every(isDoc),
    hasSource: files.some(isSource),
    testsOnly: files.length > 0 && files.every(isTest),
  };
}

/**
 * Suggest a type from what the paths contain. Advisory only — the author
 * declares the type, because only they know whether a change is a fix or a
 * feature, and no heuristic over filenames can tell.
 *
 * @param {string[]} files - Repo-relative paths.
 * @returns {string} The suggested type.
 */
function suggestType(files) {
  const shape = diffShape(files);
  if (shape.docsOnly) return "docs";
  if (shape.testsOnly) return "test";
  if (files.every((f) => /^(?:\.claude|scripts)\//.test(f))) return "chore";
  return "feat";
}

/**
 * Refuse a subject that describes more than one change.
 *
 * @param {string} subject - The commit subject.
 * @returns {void}
 */
function checkSubject(subject) {
  if (subject.length > 72) {
    fail(
      `the subject is ${subject.length} characters. Keep it under 72 — a subject that does not ` +
        "fit on one line is usually describing more than one change.",
      ExitCode.USAGE,
    );
  }
  if (/\.$/.test(subject)) {
    fail("no trailing period in the subject — it is a title, not a sentence.", ExitCode.USAGE);
  }
  if (/^[A-Z]/.test(subject) && !/^[A-Z]{2,}/.test(subject)) {
    fail("start the subject lowercase (after the type prefix).", ExitCode.USAGE);
  }
  if (/\b(?:and|und|plus|sowie)\b/i.test(subject) || subject.includes(" & ")) {
    fail(
      `"${subject}" needs a conjunction to describe itself, which means it is two changes.\n\n` +
        "Split it: `npm run commit -- --inspect` shows what is dirty, and `--files` lets you " +
        "carve the first change out. Two commits that each revert cleanly are worth more than " +
        "one that reverts neither.",
      ExitCode.USAGE,
    );
  }
  if (/^(?:wip|temp|tmp|misc|stuff|update|updates|changes)\b/i.test(subject)) {
    fail(
      `"${subject}" says nothing. In six months the only question anyone asks of a commit is ` +
        "why it happened — write that.",
      ExitCode.USAGE,
    );
  }
}

/**
 * Refuse a type that contradicts what the diff contains.
 *
 * @param {string} type - The declared type.
 * @param {string[]} files - Repo-relative paths.
 * @returns {void}
 */
function checkType(type, files) {
  if (!TYPES[type]) {
    fail(
      `unknown type \`${type}\`. One of: ${Object.entries(TYPES)
        .map(([t, v]) => `\n  ${t.padEnd(9)} ${v.what}`)
        .join("")}`,
      ExitCode.USAGE,
    );
  }
  const shape = diffShape(files);
  if (shape.docsOnly && ["feat", "fix", "perf", "refactor"].includes(type)) {
    fail(
      `\`--type ${type}\` on a documentation-only diff. Every file in this commit is a document; ` +
        "use `docs`. The type is what a reader trusts to decide whether a commit can have " +
        "broken something.",
      ExitCode.USAGE,
    );
  }
  if (shape.testsOnly && type !== "test" && type !== "chore") {
    fail(
      `\`--type ${type}\` on a tests-only diff. Use \`test\` — nothing in the product changed.`,
      ExitCode.USAGE,
    );
  }
}

/**
 * Scan the staged content for secret values before the commit exists.
 *
 * @param {string[]} files - Repo-relative paths.
 * @returns {void}
 */
function checkSecrets(files) {
  for (const rel of files) {
    if (/^\.env/.test(rel)) {
      fail(
        `'${rel}' is a local environment file. It is gitignored for a reason; committing it puts ` +
          "its values in the history permanently.",
      );
    }
    let text;
    try {
      text = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    const shape = secretWrite.findShape(text);
    if (shape) {
      fail(
        `'${rel}' contains a value shaped like a ${shape}.\n\n` +
          "A secret that reaches the history has to be ROTATED, not deleted — a later commit " +
          "removing it changes nothing about the copies that already exist. Replace it with a " +
          "placeholder now, before this commit is made.",
      );
    }
  }
}

/**
 * Print the inspect view: what is dirty, grouped by top-level area.
 *
 * @returns {void}
 */
function runInspect() {
  const dirty = status();
  step("uncommitted");
  if (dirty.length === 0) {
    info("nothing to commit.");
    return;
  }
  const groups = new Map();
  for (const entry of dirty) {
    const key = entry.path.split("/")[0];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  for (const [area, entries] of [...groups].sort()) {
    const paths = entries.map((e) => e.path);
    process.stdout.write(
      `  ${style.cyan(area.padEnd(14))} ${entries.length} file(s)  ${style.dim(
        `suggested: --type ${suggestType(paths)}`,
      )}\n`,
    );
    for (const e of entries.slice(0, 10)) {
      process.stdout.write(`      ${style.dim(`${e.index}${e.worktree}`)} ${e.path}\n`);
    }
    if (entries.length > 10) process.stdout.write(`      ${style.dim(`... ${entries.length - 10} more`)}\n`);
  }
  process.stdout.write(
    `\n  ${style.dim(
      "Each group is a candidate for one commit — but the grouping is by directory, not by reason.",
    )}\n  ${style.dim("Split by REASON: `--files <paths of one change>`.")}\n`,
  );
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
  if (args.inspect) {
    runInspect();
    return;
  }

  const branch = currentBranch();
  if (branch === null) fail("not a git repository.");
  if (branch === "main" || branch === "master") {
    fail(
      `you are on '${branch}'. Product commits belong on a feature branch — ` +
        "`npm run branch -- <name>` opens one and moves your uncommitted work with it.",
    );
  }

  const files = Array.isArray(args.files) ? args.files.map((f) => f.replace(/\\/g, "/")) : null;
  if (!files || files.length === 0) {
    process.stdout.write(`${HELP}\n`);
    fail("name the files: `--files <path...>`. Run `--inspect` first if you are unsure.", ExitCode.USAGE);
  }
  if (!args.type) fail("declare the type: `--type <type>`.", ExitCode.USAGE);
  if (!args.message) fail("write the subject: `--message \"...\"`.", ExitCode.USAGE);

  const subject = String(args.message).trim();
  checkType(args.type, files);
  checkSubject(subject);
  checkSecrets(files);

  let body = args.body ? String(args.body) : "";
  if (args["body-file"]) {
    try {
      body = readFileSync(join(ROOT, args["body-file"]), "utf8").trim();
    } catch {
      fail(`cannot read --body-file '${args["body-file"]}'.`, ExitCode.USAGE);
    }
  }

  const scope = args.scope ? `(${args.scope})` : "";
  const header = `${args.type}${scope}: ${subject}`;
  const message = body ? `${header}\n\n${body}` : header;

  step("commit");
  info(style.bold(header));
  if (body) for (const line of body.split("\n")) info(style.dim(line));
  process.stdout.write("\n");
  for (const f of files) info(f);

  // A user-visible type with an empty Unreleased section is the exact case the
  // CHANGELOG discipline exists for. Advisory here — the Stop-time rule is the
  // one that blocks, and doubling that up would be nagging.
  if (TYPES[args.type].userVisible) {
    try {
      const pending = unreleasedEntries(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"));
      if (pending.length === 0) {
        warn(
          `\`${args.type}\` is user-visible and \`## [Unreleased]\` is empty. ` +
            `Document it: \`npm run changelog -- --${args.type === "fix" ? "fixed" : "added"} "..."\``,
        );
      }
    } catch {
      warn("CHANGELOG.md could not be read — a user-visible change still needs an entry.");
    }
  }

  // The `why` belongs in the body, and for these types the diff cannot supply
  // it: a reader can see WHAT a fix changed and never why that was the right
  // fix. A nudge rather than a requirement — a `chore` often genuinely has no
  // reasoning to record, and a mandatory field gets filled with noise.
  if (!body && ["feat", "fix", "perf", "refactor", "revert"].includes(args.type)) {
    warn(
      `\`${args.type}\` without a body. The subject says what changed; the body is where the ` +
        "reason goes, and it is the only part a reader cannot reconstruct from the diff.\n" +
        '      npm run commit -- ... --body "..."   or   --body-file <path>',
    );
  }

  // A pre-staged index is how a non-atomic commit happens once the sweep
  // spellings are blocked: an earlier `git add` leaves files in the index, and
  // `git commit` takes everything staged — not only what this call named. The
  // index is NOT reset here: that would discard a staging decision someone made
  // deliberately. It is reported, and they decide.
  const preStaged = gitRead(["diff", "--cached", "--name-only"]);
  if (preStaged.ok && preStaged.stdout) {
    const listed = files.map((f) => f.replace(/\\/g, "/").replace(/\/+$/, ""));
    const unlisted = preStaged.stdout
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p) => !listed.some((l) => p === l || p.startsWith(`${l}/`)));
    if (unlisted.length > 0) {
      fail(
        `${unlisted.length} file(s) are already staged but not named in --files:\n` +
          `${unlisted.slice(0, 15).map((p) => `  ${p}`).join("\n")}\n` +
          `${unlisted.length > 15 ? `  ... and ${unlisted.length - 15} more\n` : ""}\n` +
          "`git commit` takes the whole index, so they would ride along inside a commit whose " +
          "message describes something else.\n\n" +
          "Either add them to --files if they belong to this change, or unstage them:\n" +
          "  git restore --staged <path>...",
      );
    }
  }

  if (args["dry-run"]) {
    step("dry run");
    info("nothing was staged or committed.");
    return;
  }

  // Stage by name, one path at a time: a failure names the path that failed
  // rather than aborting the whole set with a message about "pathspec".
  const failed = [];
  for (const f of files) {
    if (!git(["add", "--", f]).ok) failed.push(f);
  }
  if (failed.length > 0) {
    fail(
      `could not stage: ${failed.join(", ")}\n` +
        "A gitignored or non-existent path cannot be committed. Check the spelling, or whether " +
        "the file is ignored (`git check-ignore -v <path>`).",
    );
  }

  const staged = gitRead(["diff", "--cached", "--name-only"]);
  if (!staged.ok || staged.stdout.trim() === "") {
    fail("nothing was staged — the named files hold no changes against HEAD.");
  }

  const res = git(["commit", "-m", message]);
  if (!res.ok) fail(`git commit failed:\n${res.stderr || res.stdout}`);

  const sha = gitRead(["rev-parse", "--short", "HEAD"]).stdout;
  ok(`${sha} ${header}`);
  info(style.dim("Next: `npm run push` runs the verify gate and pushes."));
}

main();
