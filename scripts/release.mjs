#!/usr/bin/env node
/**
 * Release — cut a version.
 *
 *   node scripts/release.mjs 0.3.0            # preview, changes nothing
 *   node scripts/release.mjs --bump minor     # derive the number from the changelog
 *   node scripts/release.mjs 0.3.0 --run
 *   node scripts/release.mjs 0.3.0 --run --push
 *
 * A release is not a tag. It is five statements that have to agree, and this
 * script is the only thing that makes all five at once:
 *
 *   package.json                what npm reports
 *   src-tauri/tauri.conf.json   what the app reports about itself
 *   src-tauri/Cargo.toml        what the crate reports
 *   CHANGELOG.md                what the user is told changed
 *   the git tag                 what the history says was released
 *
 * When they drift nothing fails. Each file is internally consistent, the build
 * succeeds, and the app reports a version matching no tag — noticed only by
 * someone trying to reproduce a bug from a version that never coherently
 * existed. That is why the raw `git tag` is blocked and this is the channel.
 *
 * WHY THE ASSETS ARE BUILT HERE AND NOT IN CI:
 * `design/` is not in the repository — it holds the brand authoring environment
 * and stays private. CI would have neither the generator nor fontTools nor the
 * rasteriser, so it could not produce the logo. Hence: generate locally, commit
 * the result. Everything the app needs is versioned inside the app tree
 * (src/lib/brand, public/, src-tauri/icons) — a clone builds without Python and
 * without design/.
 *
 * WITHOUT design/ this script deliberately refuses to run: the source of the
 * assets would be missing, and a release cut from a clone would ship a stale
 * mark without anyone noticing.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import {
  ExitCode,
  ROOT,
  fail,
  git,
  gitRead,
  info,
  ok,
  parseArgs,
  run,
  status,
  step,
  style,
  warn,
} from "./lib/shell.mjs";

const require = createRequire(import.meta.url);
const {
  compareVersions,
  impliedBump,
  promoteUnreleased,
  unreleasedEntries,
  validateSchema,
} = require("./lib/changelog-core.cjs");

const SPEC = {
  bump: "string",
  help: "boolean",
  push: "boolean",
  run: "boolean",
  "skip-assets": "boolean",
};

const HELP = `
${style.bold("npm run release")} — cut a version

  node scripts/release.mjs <version>        preview
  node scripts/release.mjs --bump <major|minor|patch>
  node scripts/release.mjs <version> --run
  node scripts/release.mjs <version> --run --push
  node scripts/release.mjs <version> --run --skip-assets

Without --run nothing is changed; it prints what would happen.
The version is written to package.json, tauri.conf.json, Cargo.toml and the
CHANGELOG, and the tag is created — all five, or none.
`;

const CHANGELOG = join(ROOT, "CHANGELOG.md");

/** The three files whose version string must be rewritten, with how. */
const VERSION_FILES = [
  ["package.json", (s, v) => s.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`)],
  ["src-tauri/tauri.conf.json", (s, v) => s.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`)],
  ["src-tauri/Cargo.toml", (s, v) => s.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${v}$2`)],
];

/**
 * The version currently declared in package.json.
 *
 * @returns {string} The version, or `0.0.0` when it cannot be read.
 */
function currentVersion() {
  try {
    const m = /"version"\s*:\s*"([^"]+)"/.exec(readFileSync(join(ROOT, "package.json"), "utf8"));
    return m ? m[1] : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Apply a semver bump.
 *
 * @param {string} version - Current version.
 * @param {"major"|"minor"|"patch"} kind - The bump.
 * @returns {string} The next version.
 */
function applyBump(version, kind) {
  const [major, minor, patch] = version.split("-")[0].split(".").map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Today's date as `YYYY-MM-DD`, in local time.
 *
 * Local rather than UTC deliberately: the date on a release heading is the day
 * the person cutting it would say it happened.
 *
 * @returns {string} The date.
 */
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

  const RUN = Boolean(args.run);
  const explicit = args._.find((a) => /^\d+\.\d+\.\d+/.test(a));

  // --- Preconditions ------------------------------------------------------
  if (!gitRead(["rev-parse", "--git-dir"]).ok) {
    fail("not a git repository. Run `git init` and add a remote first.");
  }
  if (!args["skip-assets"] && !existsSync(join(ROOT, "design"))) {
    fail(
      "design/ is missing. That directory is intentionally not in the repo — a release has to " +
        "run from the machine that holds the brand source, otherwise a stale mark ships without " +
        "anyone noticing.\nIf this release genuinely changes nothing about the mark, pass " +
        "--skip-assets and say so in the commit.",
    );
  }

  // --- The changelog decides the number -----------------------------------
  let changelogText;
  try {
    changelogText = readFileSync(CHANGELOG, "utf8");
  } catch {
    return fail("CHANGELOG.md is missing — there is nothing to tell users this release changed.");
  }

  const schemaProblems = validateSchema(changelogText);
  if (schemaProblems.length > 0) {
    fail(
      `CHANGELOG.md does not match the schema:\n${schemaProblems.map((p) => `  - ${p}`).join("\n")}\n\n` +
        "The release cut reads this file; a shape it cannot parse is a release it cannot describe.",
    );
  }

  const pending = unreleasedEntries(changelogText);
  if (pending.length === 0) {
    fail(
      "`## [Unreleased]` is empty — this release would tell users nothing changed.\n" +
        "If work did land, document it now: `npm run changelog -- --added \"...\"`.\n" +
        "If nothing user-visible landed, there is nothing worth releasing.",
    );
  }

  const from = currentVersion();
  const suggested = impliedBump(changelogText);
  const version = explicit
    ? explicit
    : args.bump
      ? applyBump(from, args.bump)
      : applyBump(from, suggested);

  if (!/^\d+\.\d+\.\d+/.test(version)) fail(`'${version}' is not a version.`, ExitCode.USAGE);
  if (compareVersions(version, from) <= 0) {
    fail(`${version} is not above the current ${from}. A release only ever moves forward.`);
  }

  process.stdout.write(
    `\n${style.bold(`Tablinum ${from} → ${version}`)}${RUN ? "" : style.dim("  (preview — nothing is changed)")}\n`,
  );

  step("changelog");
  info(`${pending.length} pending entr${pending.length === 1 ? "y" : "ies"}, implying ${style.bold(suggested)}`);
  if (!explicit && !args.bump) info(`taking the implied bump → ${version}`);
  if (args.bump && args.bump !== suggested) {
    warn(`--bump ${args.bump} overrides the implied ${suggested}. Deliberate?`);
  }
  for (const e of pending.slice(0, 12)) info(style.dim(`  ${e.category}: ${e.text}`));
  if (pending.length > 12) info(style.dim(`  ... and ${pending.length - 12} more`));

  // --- The gate -----------------------------------------------------------
  step("verify");
  if (RUN) {
    const res = run("node", ["scripts/verify.mjs", "--all"], { stdio: "inherit" });
    if (!res.ok) fail("the verify gate failed — nothing was released.");
    ok("green");
  } else {
    info("would run `npm run verify -- --all`");
  }

  // --- Brand assets -------------------------------------------------------
  if (!args["skip-assets"]) {
    step("mark");
    const assetSteps = [
      ["build-all.py", ["python", ["design/build-all.py"]]],
      ["distribute.mjs", ["node", ["design/scripts/distribute.mjs"]]],
      ["small-icons.mjs", ["node", ["design/scripts/small-icons.mjs"]]],
    ];
    for (const [label, [cmd, cmdArgs]] of assetSteps) {
      if (!RUN) {
        info(`would run ${label}`);
        continue;
      }
      const res = run(cmd, cmdArgs);
      if (!res.ok) fail(`${label} failed:\n${res.stderr || res.stdout}`);
      ok(label);
    }
  }

  // --- Version, in all four places ---------------------------------------
  step("version");
  for (const [rel, rewrite] of VERSION_FILES) {
    const p = join(ROOT, rel);
    let before;
    try {
      before = readFileSync(p, "utf8");
    } catch {
      fail(`cannot read ${rel} — the version cannot be written consistently without it.`);
    }
    const after = rewrite(before, version);
    if (before === after) {
      warn(`${rel}: unchanged (the pattern did not match — check the file by hand)`);
      continue;
    }
    if (RUN) writeFileSync(p, after, "utf8");
    ok(`${rel} → ${version}`);
  }

  const promoted = promoteUnreleased(changelogText, version, today());
  if (RUN) writeFileSync(CHANGELOG, promoted, "utf8");
  ok(`CHANGELOG.md → ## [${version}] - ${today()}`);

  // --- Commit and tag -----------------------------------------------------
  step("git");
  const changed = status();
  if (!RUN) {
    info(`would commit ${changed.length} changed file(s) as "release: ${version}"`);
    info(`would tag v${version}`);
    info(args.push ? "would push commits and tags" : style.dim("(--push not given)"));
    process.stdout.write(`\n  Run again with ${style.bold("--run")} to apply.\n\n`);
    return;
  }

  if (changed.length === 0) {
    warn("nothing changed — assets and version were already current.");
  } else {
    if (!git(["add", "-A"]).ok) fail("could not stage the release changes.");
    const res = git(["commit", "-m", `release: ${version}`]);
    if (!res.ok) fail(`commit failed:\n${res.stderr}`);
    ok(`committed ${changed.length} file(s)`);
  }

  const tags = gitRead(["tag", "--list"]).stdout.split("\n");
  if (tags.includes(`v${version}`)) {
    warn(`v${version} already exists — not re-tagging.`);
  } else {
    const res = git(["tag", "-a", `v${version}`, "-m", `Tablinum ${version}`]);
    if (!res.ok) fail(`tagging failed:\n${res.stderr}`);
    ok(`tagged v${version}`);
  }

  if (args.push) {
    if (!git(["push"], { stdio: "inherit" }).ok) fail("push failed.");
    if (!git(["push", "--tags"], { stdio: "inherit" }).ok) fail("pushing tags failed.");
    ok("commits and tags pushed");
  } else {
    process.stdout.write(
      `\n  Not pushed. When it looks right:  ${style.bold("git push && git push --tags")}\n\n`,
    );
  }
}

main();
