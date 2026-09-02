#!/usr/bin/env node
/**
 * The verify gate — one command that answers "is this tree in a state worth
 * committing".
 *
 *   node scripts/verify.mjs --files src/App.tsx ...   # scoped to what changed
 *   node scripts/verify.mjs --all                     # everything
 *   node scripts/verify.mjs --rust                    # add clippy + cargo test
 *
 * Everything that can say no about this repository says it here, in one place,
 * with one exit code. Three consumers depend on that: the Stop hook runs it
 * scoped after every turn that edited something, `npm run push` runs it before
 * anything leaves the machine, and a human runs it when they want to know.
 *
 * The sensors are ordered cheapest-first and every one of them keeps running —
 * the gate reports ALL findings rather than stopping at the first. A gate that
 * stops early turns one fix-and-rerun cycle into five.
 *
 * Rust is behind a flag rather than in the default set: a cargo run takes tens of
 * seconds even warm, and the Stop chain already runs clippy and the tests on
 * their own trigger. `--all` implies it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, relative } from "node:path";

import { ExitCode, ROOT, fail, info, ok, parseArgs, run, step, style, warn } from "./lib/shell.mjs";

const require = createRequire(import.meta.url);
const todoCore = require("./lib/todo-core.cjs");
const commentLang = require("./lib/comment-lang.cjs");
const uiLang = require("./lib/ui-lang.cjs");
const changelogCore = require("./lib/changelog-core.cjs");
const secretWrite = require("../.claude/hooks/rules/pretooluse/secret-write.cjs");

const SPEC = {
  all: "boolean",
  files: "list",
  help: "boolean",
  json: "boolean",
  rust: "boolean",
};

const HELP = `
${style.bold("npm run verify")} — the one gate that judges this tree

  npm run verify -- --files <path...>   check only these files
  npm run verify -- --all               check everything (implies --rust)
  npm run verify -- --rust              also run clippy and cargo test
  npm run verify -- --json              machine-readable findings

Sensors:
  typecheck          tsc --noEmit over the whole project
  secrets            no real secret values in the scanned files
  todo-tags          debt markers carry a tag, and a date where required
  english-comments   code comments are English
  changelog-schema   CHANGELOG.md matches the Keep a Changelog schema
  version-sync       the four declared versions agree
  gates              the PreToolUse gates still gate (--all only)
  clippy / cargo     Rust lints and unit tests (with --rust or --all)
`;

/**
 * Every file the sweep considers, walked once.
 *
 * @param {string} dir - Absolute directory to walk.
 * @param {string[]} [acc] - Accumulator.
 * @returns {string[]} Repo-relative POSIX paths.
 */
function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    const rel = relative(ROOT, abs).replace(/\\/g, "/");
    if (todoCore.isSkippedPath(`${rel}/`) || /^(?:node_modules|dist|\.git|design|vendor)$/.test(entry.name)) {
      continue;
    }
    if (entry.isDirectory()) walk(abs, acc);
    else acc.push(rel);
  }
  return acc;
}

/**
 * A finding: which sensor, which file, what is wrong.
 *
 * @param {string} sensor - Sensor name.
 * @param {string} file - Repo-relative path (or `-` when repo-wide).
 * @param {string} message - What is wrong and what to do.
 * @returns {{sensor: string, file: string, message: string}} The finding.
 */
const finding = (sensor, file, message) => ({ file, message, sensor });

/**
 * Sensor: TypeScript compiles.
 *
 * Whole-project rather than per-file, because a type error is a property of the
 * program: checking one file in isolation reports errors that do not exist and
 * misses the ones that do.
 *
 * @returns {Array<object>} Findings.
 */
function sensorTypecheck() {
  const res = run("npx", ["tsc", "--noEmit"]);
  if (res.ok) return [];
  const lines = `${res.stdout}\n${res.stderr}`
    .split("\n")
    .filter((l) => /error TS\d+/.test(l))
    .slice(0, 25);
  if (lines.length === 0) {
    return [finding("typecheck", "-", `tsc exited ${res.status} without parseable output`)];
  }
  return lines.map((l) => {
    const m = /^(.+?)\(\d+,\d+\)/.exec(l);
    return finding("typecheck", m ? m[1].replace(/\\/g, "/") : "-", l.trim());
  });
}

/**
 * Sensor: no real secret values.
 *
 * @param {string[]} files - Repo-relative paths to scan.
 * @returns {Array<object>} Findings.
 */
function sensorSecrets(files) {
  const out = [];
  for (const rel of files) {
    if (!/\.(tsx?|jsx?|cjs|mjs|rs|json|toml|md|ya?ml|sh|env)$/i.test(rel)) continue;
    if (/\.(test|spec)\.|__fixtures__\//.test(rel)) continue;
    let text;
    try {
      text = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    const shape = secretWrite.findShape(text);
    if (shape) {
      out.push(
        finding(
          "secrets",
          rel,
          `contains a value shaped like a ${shape} — replace it with a placeholder and rotate the real one`,
        ),
      );
    }
  }
  return out;
}

/**
 * Sensor: the TODO grammar.
 *
 * @param {string[]} files - Repo-relative paths to scan.
 * @returns {Array<object>} Findings.
 */
function sensorTodos(files) {
  const out = [];
  const now = new Date();
  for (const rel of files) {
    if (!todoCore.isScannedFile(rel) || todoCore.isSkippedPath(rel)) continue;
    let text;
    try {
      text = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    const untagged = todoCore.findUntaggedMarker(text, rel);
    if (untagged) out.push(finding("todo-tags", rel, `marker outside the grammar: ${untagged}`));
    const nonUpper = todoCore.findNonUppercaseMarker(text, rel);
    if (nonUpper) out.push(finding("todo-tags", rel, `wrong spelling: ${nonUpper}`));
    const dateProblem = todoCore.findDateWindowViolation(text, now);
    if (dateProblem) out.push(finding("todo-tags", rel, dateProblem));
  }
  return out;
}

/**
 * Sensor: code comments are English.
 *
 * @param {string[]} files - Repo-relative paths to scan.
 * @returns {Array<object>} Findings.
 */
function sensorComments(files) {
  const out = [];
  for (const rel of files) {
    if (!commentLang.isScannedFile(rel) || commentLang.isSkippedPath(rel)) continue;
    let text;
    try {
      text = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    const hit = commentLang.findGermanComment(text, rel);
    if (hit) {
      out.push(
        finding("english-comments", rel, `German comment (${hit.words.join(", ")}): ${hit.comment}`),
      );
    }
  }
  return out;
}

/**
 * Sensor: user-facing strings in the frontend are English.
 *
 * The interface language is a product decision (English), and this is the
 * whole-file backstop behind the write-time gate `english-ui-strings`.
 *
 * @param {string[]} files - Repo-relative paths to check.
 * @returns {Array<object>} Findings.
 */
function sensorUiStrings(files) {
  const out = [];
  for (const rel of files) {
    if (!uiLang.isUiFile(rel)) continue;
    let text;
    try {
      text = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    const hit = uiLang.findGermanString(text, rel);
    if (hit) {
      out.push(
        finding("english-ui-strings", rel, `German user-facing string (${hit.words.join(", ")}): ${hit.text}`),
      );
    }
  }
  return out;
}

/**
 * Sensor: the CHANGELOG matches its schema.
 *
 * @returns {Array<object>} Findings.
 */
function sensorChangelog() {
  const file = join(ROOT, "CHANGELOG.md");
  if (!existsSync(file)) {
    return [
      finding(
        "changelog-schema",
        "CHANGELOG.md",
        "missing — every release needs one, and it is written as work lands, not at release time",
      ),
    ];
  }
  return changelogCore
    .validateSchema(readFileSync(file, "utf8"))
    .map((p) => finding("changelog-schema", "CHANGELOG.md", p));
}

/**
 * Sensor: the four declared versions agree.
 *
 * @returns {Array<object>} Findings.
 */
function sensorVersionSync() {
  const read = (rel) => {
    try {
      return readFileSync(join(ROOT, rel), "utf8");
    } catch {
      return "";
    }
  };
  const pick = (text, re) => {
    const m = re.exec(text);
    return m ? m[1] : null;
  };
  const changelog = changelogCore.parseChangelog(read("CHANGELOG.md"));
  const newest = changelog.sections.find((s) => s.version);
  const versions = {
    "CHANGELOG.md": newest ? newest.version : null,
    "package.json": pick(read("package.json"), /"version"\s*:\s*"([^"]+)"/),
    "src-tauri/Cargo.toml": pick(read("src-tauri/Cargo.toml"), /^version\s*=\s*"([^"]+)"/m),
    "src-tauri/tauri.conf.json": pick(read("src-tauri/tauri.conf.json"), /"version"\s*:\s*"([^"]+)"/),
  };
  const present = Object.entries(versions).filter(([, v]) => v);
  if (present.length < 2) return [];
  if (new Set(present.map(([, v]) => v)).size === 1) return [];
  return [
    finding(
      "version-sync",
      "-",
      `declared versions disagree — ${present
        .map(([f, v]) => `${f}=${v}`)
        .join(", ")}. \`npm run release -- <version>\` writes all of them in one step.`,
    ),
  ];
}

/**
 * Sensor: the gate layer still gates.
 *
 * Runs the end-to-end table in `.claude/hooks/gate-smoke.test.cjs`. Only on a
 * full run, because it spawns one dispatcher per case — too slow for the hot
 * per-file path and exactly right for `push` and `release`, which are the two
 * moments a silently-disabled gate would ship.
 *
 * @returns {Array<object>} Findings.
 */
function sensorGates() {
  // The detector suites sit next to the gate suite: a detector that stopped
  // detecting makes its gate and its sensor green for the wrong reason.
  const suites = [
    [join(ROOT, ".claude", "hooks", "gate-smoke.test.cjs"), ".claude/hooks", "the gate suite"],
    [join(ROOT, "scripts", "lib", "ui-lang.test.cjs"), "scripts/lib/ui-lang.cjs", "the UI-string detector suite"],
    [join(ROOT, "scripts", "lib", "git-conventions.test.cjs"), "scripts/lib/git-conventions.cjs", "the git conventions suite"],
  ];
  const out = [];
  for (const [suite, where, label] of suites) {
    if (!existsSync(suite)) {
      out.push(finding("gates", where, `${label} is missing — nothing verifies it`));
      continue;
    }
    const res = run("node", [suite]);
    if (res.ok) continue;
    const failed = `${res.stdout}\n${res.stderr}`
      .split("\n")
      .filter((l) => l.startsWith("FAIL") || l.trim().startsWith("expected") || l.startsWith("  "))
      .slice(0, 20);
    out.push(finding("gates", where, `${label} failed — a rule stopped doing what it claims:\n${failed.join("\n")}`));
  }
  return out;
}

/**
 * Sensor: Rust lints and unit tests.
 *
 * @returns {Array<object>} Findings.
 */
function sensorRust() {
  const cwd = join(ROOT, "src-tauri");
  if (!existsSync(join(cwd, "Cargo.toml"))) return [];
  const out = [];
  const clippy = run("cargo", ["clippy", "--all-targets", "--", "-D", "warnings"], { cwd });
  if (!clippy.ok) {
    out.push(finding("clippy", "src-tauri", clippy.stderr.split("\n").slice(-30).join("\n")));
  }
  const test = run("cargo", ["test", "--lib", "--bins"], { cwd });
  if (!test.ok) {
    out.push(finding("cargo-test", "src-tauri", `${test.stdout}\n${test.stderr}`.split("\n").slice(-30).join("\n")));
  }
  return out;
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

  const all = Boolean(args.all);
  const scoped = Array.isArray(args.files) ? args.files.map((f) => f.replace(/\\/g, "/")) : null;
  if (!all && !scoped) {
    fail("say what to check: `--files <path...>` or `--all`.", ExitCode.USAGE);
  }

  const files = all
    ? walk(ROOT)
    : scoped.filter((f) => {
        const abs = join(ROOT, f);
        // A file that was edited and then deleted is not a finding, it is gone.
        try {
          return statSync(abs).isFile();
        } catch {
          return false;
        }
      });

  step(`verify — ${all ? "full run" : `${files.length} file(s)`}`);

  const findings = [];
  const runSensor = (name, fn) => {
    const started = Date.now();
    const results = fn();
    findings.push(...results);
    const ms = Date.now() - started;
    if (results.length === 0) ok(`${name} ${style.dim(`(${ms}ms)`)}`);
    else warn(`${name} — ${results.length} finding(s) ${style.dim(`(${ms}ms)`)}`);
  };

  // Cheap, file-local sensors first; the typecheck spawns a compiler and Rust
  // spawns cargo, so a fast failure is reported before the slow work begins.
  runSensor("secrets", () => sensorSecrets(files));
  runSensor("todo-tags", () => sensorTodos(files));
  runSensor("english-comments", () => sensorComments(files));
  runSensor("english-ui-strings", () => sensorUiStrings(files));
  runSensor("changelog-schema", sensorChangelog);
  runSensor("version-sync", sensorVersionSync);
  // A TS or TSX file in the set means the program's types may have moved.
  if (all || files.some((f) => [".ts", ".tsx"].includes(extname(f)))) {
    runSensor("typecheck", sensorTypecheck);
  }
  if (all) runSensor("gates", sensorGates);
  if (all || args.rust) runSensor("rust", sensorRust);

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ findings }, null, 2)}\n`);
  } else if (findings.length > 0) {
    step(`${findings.length} finding(s)`);
    for (const f of findings) {
      process.stdout.write(
        `  ${style.red("×")} ${style.cyan(f.sensor)}  ${f.file}\n      ${f.message.replace(/\n/g, "\n      ")}\n`,
      );
    }
    process.stdout.write("\n");
  } else {
    step("green");
    info("nothing to report.");
  }

  process.exit(findings.length === 0 ? ExitCode.OK : ExitCode.FAILED);
}

main();
