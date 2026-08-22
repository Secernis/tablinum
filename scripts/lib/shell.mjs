/**
 * Shared plumbing for the scripts in `scripts/`: process execution, git reads,
 * strict argument parsing and terminal output.
 *
 * Three things live here because getting them wrong once is enough to make a
 * script quietly do the wrong thing:
 *
 *   `run()` never uses a shell. A shell means quoting rules, and quoting rules
 *   mean a branch name with a space silently becomes two arguments. Arguments go
 *   in as an array and arrive as an array.
 *
 *   `parseArgs()` REFUSES unknown flags. The alternative — ignoring them — is how
 *   a mistyped `--dry-run` turns a preview into a real commit. A script that
 *   mutates the repository has to fail loudly on an argument it does not
 *   understand.
 *
 *   `gitRead()` opts out of the index lock, for the same reason the hooks do: a
 *   read-only git command is not read-only on disk, and a killed refresh strands
 *   a lock file that blocks every later staging call.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute repository root, resolved from this file's location. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** ANSI codes, disabled when the output is not a terminal or NO_COLOR is set. */
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const code = (n) => (useColor ? `[${n}m` : "");

export const style = {
  bold: (s) => `${code(1)}${s}${code(22)}`,
  cyan: (s) => `${code(36)}${s}${code(39)}`,
  dim: (s) => `${code(2)}${s}${code(22)}`,
  green: (s) => `${code(32)}${s}${code(39)}`,
  red: (s) => `${code(31)}${s}${code(39)}`,
  yellow: (s) => `${code(33)}${s}${code(39)}`,
};

/** Exit codes, so a caller (CI, another script) can branch on the reason. */
export const ExitCode = {
  FAILED: 1,
  OK: 0,
  USAGE: 2,
  USER_ABORTED: 130,
};

/**
 * Run a command without a shell and return its result.
 *
 * @param {string} cmd - Executable name.
 * @param {string[]} args - Arguments, passed through untouched.
 * @param {object} [opts] - `spawnSync` options; `cwd` defaults to the repo root.
 * @returns {{status: number, stdout: string, stderr: string, ok: boolean}} Result.
 */
export function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    // Windows resolves `npm`/`cargo` through a `.cmd` wrapper, which cannot be
    // executed directly. Only that case gets a shell.
    shell: process.platform === "win32" && /^(?:npm|npx|cargo|tsc)$/.test(cmd),
    ...opts,
  });
  return {
    ok: res.status === 0,
    status: res.status === null ? 1 : res.status,
    stderr: res.stderr || "",
    stdout: (res.stdout || "").trim(),
  };
}

/**
 * Run a read-only git command without taking the index lock.
 *
 * @param {string[]} args - Git arguments.
 * @param {object} [opts] - `run` options.
 * @returns {{status: number, stdout: string, stderr: string, ok: boolean}} Result.
 */
export function gitRead(args, opts = {}) {
  return run("git", ["--no-optional-locks", ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    ...opts,
  });
}

/**
 * Run a mutating git command.
 *
 * @param {string[]} args - Git arguments.
 * @param {object} [opts] - `run` options.
 * @returns {{status: number, stdout: string, stderr: string, ok: boolean}} Result.
 */
export function git(args, opts = {}) {
  return run("git", args, opts);
}

/**
 * The current branch, or null when git cannot answer.
 *
 * @returns {string|null} Branch name.
 */
export function currentBranch() {
  const res = gitRead(["rev-parse", "--abbrev-ref", "HEAD"]);
  return res.ok ? res.stdout : null;
}

/**
 * Working-tree status as `{index, worktree, path}` records.
 *
 * The porcelain format puts two status characters and a space before the path,
 * and the first of those is a real space for a worktree-only modification — so
 * the line must NOT be trimmed before slicing, or the first path character goes
 * with it.
 *
 * @returns {Array<{index: string, worktree: string, path: string}>} Dirty entries.
 */
export function status() {
  const res = gitRead(["status", "--porcelain"]);
  if (!res.ok) return [];
  return res.stdout
    .split("\n")
    .filter((l) => l.length > 0)
    .map((line) => {
      let p = line.slice(3);
      if (p.includes(" -> ")) p = p.split(" -> ")[1];
      return { index: line[0], path: p.replace(/^"|"$/g, ""), worktree: line[1] };
    });
}

/**
 * Parse argv strictly against a declared spec.
 *
 * The spec maps a flag name to its kind: `"boolean"`, `"string"`, or `"list"`
 * (consumes every following non-flag token). An unknown flag is a usage error,
 * not a shrug — see the module docblock.
 *
 * @param {string[]} argv - Arguments, without the node/script prefix.
 * @param {Record<string, "boolean"|"string"|"list">} spec - Declared flags.
 * @returns {Record<string, boolean|string|string[]>} Parsed values, plus `_` for positionals.
 */
export function parseArgs(argv, spec) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      out._.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const name = (eq === -1 ? token : token.slice(0, eq)).slice(2);
    const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);
    const kind = spec[name];
    if (!kind) {
      fail(
        `unknown option \`--${name}\`.\nKnown options: ${Object.keys(spec)
          .map((k) => `--${k}`)
          .join(", ")}`,
        ExitCode.USAGE,
      );
    }
    if (kind === "boolean") {
      if (inlineValue !== undefined) fail(`\`--${name}\` takes no value.`, ExitCode.USAGE);
      out[name] = true;
      continue;
    }
    if (kind === "string") {
      const value = inlineValue ?? argv[++i];
      if (value === undefined || value.startsWith("--")) {
        fail(`\`--${name}\` needs a value.`, ExitCode.USAGE);
      }
      out[name] = value;
      continue;
    }
    // list: consume until the next flag.
    const values = inlineValue !== undefined ? [inlineValue] : [];
    while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) values.push(argv[++i]);
    if (values.length === 0) fail(`\`--${name}\` needs at least one value.`, ExitCode.USAGE);
    out[name] = values;
  }
  return out;
}

/**
 * Print an error and exit.
 *
 * @param {string} message - What went wrong, and what to do instead.
 * @param {number} [exitCode] - Process exit code.
 * @returns {never} Never returns.
 */
export function fail(message, exitCode = ExitCode.FAILED) {
  process.stderr.write(`${style.red("error")}  ${message}\n`);
  process.exit(exitCode);
}

/**
 * Print a step heading.
 *
 * @param {string} message - The heading.
 * @returns {void}
 */
export function step(message) {
  process.stdout.write(`\n${style.bold(message)}\n`);
}

/**
 * Print an informational line.
 *
 * @param {string} message - The line.
 * @returns {void}
 */
export function info(message) {
  process.stdout.write(`  ${message}\n`);
}

/**
 * Print a success line.
 *
 * @param {string} message - The line.
 * @returns {void}
 */
export function ok(message) {
  process.stdout.write(`  ${style.green("✓")} ${message}\n`);
}

/**
 * Print a warning line.
 *
 * @param {string} message - The line.
 * @returns {void}
 */
export function warn(message) {
  process.stdout.write(`  ${style.yellow("!")} ${message}\n`);
}

/**
 * Ask a yes/no question on the terminal.
 *
 * Returns the default answer immediately when stdin is not a TTY: a script
 * invoked by an agent or by CI must never block on a prompt nobody can answer.
 *
 * @param {string} question - The question.
 * @param {boolean} [fallback] - The answer to assume without a TTY.
 * @returns {Promise<boolean>} The answer.
 */
export async function confirm(question, fallback = false) {
  if (!process.stdin.isTTY) return fallback;
  process.stdout.write(`  ${question} ${style.dim("[y/N]")} `);
  const answer = await new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (d) => resolve(String(d).trim().toLowerCase()));
  });
  process.stdin.pause();
  return answer === "y" || answer === "yes" || answer === "j" || answer === "ja";
}
