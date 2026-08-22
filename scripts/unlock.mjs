#!/usr/bin/env node
/**
 * Open and close the protected-surface edit windows.
 *
 *   npm run unlock                        what is open right now
 *   npm run unlock -- hooks rules         open both, 30 minutes
 *   npm run unlock -- hooks,rules         same, comma-separated
 *   npm run unlock -- all                 open every surface
 *   npm run unlock -- --close hooks       close one
 *   npm run unlock -- --close all         close everything
 *
 * Replaces the five per-scope scripts. They were a toggle, which is the right
 * shape for a hardware key that sends one argument-less command and needs to
 * both open and close from it — and the wrong shape for something you type:
 * opening two surfaces meant two commands, and a second `unlock hooks` while it
 * was already open silently CLOSED it. Here, opening is idempotent (it refreshes
 * the window) and closing is a flag you have to mean.
 *
 * RUN THIS YOURSELF, in your own terminal. An agent that can open its own
 * windows has no protection at all — which is why `unlock-channel` refuses this
 * command when it arrives through an agent's tool call. That refusal is the
 * control; this docblock is only the explanation.
 */

import { createRequire } from "node:module";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { ExitCode, ROOT, fail, info, ok, parseArgs, step, style } from "./lib/shell.mjs";

const require = createRequire(import.meta.url);
// The hook library stays the single source of WHERE a flag lives and HOW LONG it
// lasts. Only the act of writing the file happens here.
const {
  SCOPES,
  UNLOCK_TTL_MS,
  flagRelFor,
  formatWindowStatus,
  windowStatus,
} = require("../.claude/hooks/lib/unlock.cjs");

const SPEC = { close: "boolean", help: "boolean" };

const HELP = `
${style.bold("npm run unlock")} — the protected-surface edit windows

  npm run unlock                     what is open right now
  npm run unlock -- hooks rules      open both for ${UNLOCK_TTL_MS / 60000} minutes
  npm run unlock -- hooks,rules      same, comma-separated
  npm run unlock -- all              open every surface
  npm run unlock -- --close hooks    close one
  npm run unlock -- --close all      close everything

Surfaces:
  ${style.cyan("rules")}     CLAUDE.md, .claude/rules/**
  ${style.cyan("design")}    DESIGN.md
  ${style.cyan("hooks")}     .claude/hooks/**
  ${style.cyan("brand")}     src/lib/brand/, src/brand.css, public/, src-tauri/icons/
  ${style.cyan("configs")}   tsconfig, vite/tauri config, capabilities, settings

Opening is idempotent — running it again on an open window refreshes it rather
than closing it. Closing takes ${style.bold("--close")}, so it cannot happen by accident.
`;

/**
 * Expand the positional arguments into a list of scopes.
 *
 * Accepts space- and comma-separated names, and `all`. An unknown name is a
 * usage error rather than a silent skip: a typo that quietly opened nothing
 * would look exactly like a window that failed to take effect.
 *
 * @param {string[]} positionals - Raw arguments.
 * @returns {string[]} Distinct, validated scope names.
 */
function resolveScopes(positionals) {
  const names = positionals
    .flatMap((a) => a.split(","))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (names.includes("all")) return [...SCOPES];
  const unknown = names.filter((n) => !SCOPES.includes(n));
  if (unknown.length > 0) {
    fail(
      `unknown surface(s): ${unknown.join(", ")}\nValid: ${SCOPES.join(", ")}, all`,
      ExitCode.USAGE,
    );
  }
  return [...new Set(names)];
}

/**
 * Print the live state of every window.
 *
 * @returns {void}
 */
function printStatus() {
  const status = windowStatus();
  step("edit windows");
  for (const s of status) {
    const label = s.open
      ? style.green(`OPEN  ${Math.ceil(s.remainingMs / 60000)} min left`)
      : style.dim("closed");
    process.stdout.write(`  ${s.scope.padEnd(10)} ${label}\n`);
  }
}

/**
 * Create or refresh a scope's flag.
 *
 * @param {string} scope - One of SCOPES.
 * @returns {void}
 */
function openScope(scope) {
  const flag = join(ROOT, flagRelFor(scope));
  mkdirSync(dirname(flag), { recursive: true });
  writeFileSync(flag, new Date().toISOString(), "utf8");
}

/**
 * Remove a scope's flag.
 *
 * @param {string} scope - One of SCOPES.
 * @returns {void}
 */
function closeScope(scope) {
  rmSync(join(ROOT, flagRelFor(scope)), { force: true });
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
  if (args._.length === 0) {
    if (args.close) fail("say which surface(s) to close, or `all`.", ExitCode.USAGE);
    printStatus();
    info(style.dim("`npm run unlock -- <surface...>` to open, `--help` for the list."));
    return;
  }

  const scopes = resolveScopes(args._);
  const closing = Boolean(args.close);
  for (const scope of scopes) {
    if (closing) closeScope(scope);
    else openScope(scope);
  }

  const status = windowStatus();
  step(closing ? "closed" : "open");
  for (const scope of scopes) ok(scope);
  if (!closing) {
    const until = new Date(Date.now() + UNLOCK_TTL_MS);
    info(`until ${until.toLocaleTimeString()} (${UNLOCK_TTL_MS / 60000} min)`);
  }
  info(style.dim(formatWindowStatus(status)));
}

main();
