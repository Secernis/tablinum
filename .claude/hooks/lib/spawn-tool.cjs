"use strict";

/**
 * The hooks' single channel for spawning an external tool.
 *
 * Every gate that shells out — the verify gate, clippy, cargo test, the
 * read-only git channel — would otherwise make the same platform decision for
 * itself, and would make it in the shape Node deprecates: an args ARRAY together
 * with `shell: true` (DEP0190). Duplication in the enforcement layer is the
 * expensive kind: a fix has to land in every copy or it has not landed.
 *
 * The routing rule is one sentence: POSIX is always argv; win32 walks PATH x
 * PATHEXT and reaches `cmd.exe` only for a genuine batch file (`.cmd`/`.bat`,
 * which Windows cannot execute directly) or for a name that resolves nowhere.
 * Everything that resolves to a real `.exe` goes to argv — which is what keeps a
 * kill-timeout meaningful: without a shell in between, the timeout kills the
 * process that actually holds the resource, instead of a `cmd.exe` wrapper while
 * the real child survives as an orphan.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/** Extensions Windows can only run through a shell. */
const SHELL_ONLY_EXT = new Set([".cmd", ".bat"]);

/**
 * Read an environment value case-insensitively.
 *
 * Windows resolves environment names case-insensitively while a plain JS object
 * does not — reading `PATH` off an override object that spells it `Path` would
 * silently resolve against the wrong search path.
 *
 * @param {object} env - Environment object.
 * @param {string} name - Variable name.
 * @returns {string|undefined} The value, or undefined when absent.
 */
function readEnvCaseInsensitive(env, name) {
  if (!env) return undefined;
  const lower = name.toLowerCase();
  const key = Object.keys(env).find((k) => k.toLowerCase() === lower);
  return key === undefined ? undefined : env[key];
}

/**
 * Resolve a command name to a concrete file on win32 by walking PATH x PATHEXT.
 *
 * @param {string} cmd - Command name as written at the call site.
 * @param {string} pathEnv - The PATH to search.
 * @param {string} pathExt - The PATHEXT list.
 * @returns {string|null} Absolute file path, or null when nothing resolves.
 */
function resolveWindows(cmd, pathEnv, pathExt) {
  // An explicit path (relative or absolute) is not a PATH lookup.
  if (cmd.includes("/") || cmd.includes("\\")) {
    return fs.existsSync(cmd) ? path.resolve(cmd) : null;
  }
  const exts = pathExt.split(";").filter(Boolean);
  for (const dir of pathEnv.split(";").filter(Boolean)) {
    // A name that already carries its extension must be probed as written too.
    for (const ext of ["", ...exts]) {
      const candidate = path.join(dir, cmd + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Not there — try the next extension.
      }
    }
  }
  return null;
}

/**
 * Decide how a command must be spawned on this platform.
 *
 * @param {string} cmd - Executable name or path.
 * @param {readonly string[]} args - CLI arguments.
 * @param {{platform?: string, pathEnv?: string, pathExt?: string}} [overrides] - Test seam.
 * @returns {{kind: "argv"|"shell", file: string, args: string[]}} The resolved target.
 */
function resolveSpawnTarget(cmd, args, overrides = {}) {
  const platform = overrides.platform || process.platform;
  if (platform !== "win32") return { args: [...args], file: cmd, kind: "argv" };

  const pathEnv = overrides.pathEnv ?? process.env.PATH ?? "";
  const pathExt = overrides.pathExt ?? process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const resolved = resolveWindows(cmd, pathEnv, pathExt);
  // Unresolvable: hand it to the shell, which may still know it (a shell
  // builtin, a doskey alias) and will produce a real error message if not.
  if (!resolved) return { args: [...args], file: cmd, kind: "shell" };
  if (SHELL_ONLY_EXT.has(path.extname(resolved).toLowerCase())) {
    return { args: [...args], file: resolved, kind: "shell" };
  }
  return { args: [...args], file: resolved, kind: "argv" };
}

/**
 * Quote one argument for a Windows shell command line.
 *
 * Refuses a `%`-bearing argument rather than mangle it: `cmd.exe` expands `%VAR%`
 * inside a command line and there is no escape that survives every context.
 *
 * @param {string} arg - The argument.
 * @returns {string} The quoted argument.
 */
function quoteArg(arg) {
  if (arg.includes("%")) throw new Error("unrenderable argument (contains %)");
  if (!/[\s"^&|<>()]/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
}

/**
 * Spawns an external tool through the shared argv-or-shell routing.
 *
 * Drop-in for `spawnSync(cmd, args, options)`: the return value is whatever the
 * spawn produced, so callers keep reading `status`, `stdout`, `stderr`, `error`
 * and `signal` exactly as before.
 *
 * @param {string} cmd - Executable name or path, as the call site writes it.
 * @param {readonly string[]} args - CLI arguments, carried through untouched.
 * @param {object} [options] - `spawnSync` options; `shell` is decided here.
 * @param {object} [deps] - Injection seam for tests.
 * @returns {object} The `spawnSync` result, unmodified.
 */
function spawnTool(cmd, args, options = {}, deps = {}) {
  const spawn = deps.spawn ?? spawnSync;
  const callerPath =
    options.env === undefined ? undefined : readEnvCaseInsensitive(options.env, "PATH");
  const target = resolveSpawnTarget(cmd, args, {
    ...(callerPath === undefined ? {} : { pathEnv: callerPath }),
    ...deps.target,
  });

  if (target.kind === "argv") return spawn(target.file, target.args, options);

  // An unrenderable argument falls back to the args-array spawn rather than
  // killing the gate outright.
  try {
    const line = [target.file, ...target.args].map(quoteArg).join(" ");
    return spawn(line, { ...options, shell: true });
  } catch {
    return spawn(target.file, target.args, { ...options, shell: true });
  }
}

module.exports = { quoteArg, readEnvCaseInsensitive, resolveSpawnTarget, spawnTool };
