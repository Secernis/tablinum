"use strict";

/**
 * PreToolUse rule — logging goes through the logging module, not the console.
 *
 * `src/lib/log.ts` exists so that logging has ONE place it can be changed. In a
 * desktop app that matters more than on the web: there is no browser devtools
 * console for the user, so a `console.log` in shipped code is output nobody will
 * ever read — and when logging eventually has to reach a file or the Tauri log
 * plugin, every scattered call site has to be found and rewritten first.
 *
 * The second reason is discipline about WHAT is logged. `logWarn(event, fields)`
 * takes a stable event key plus structured fields, so output can be filtered.
 * A formatted sentence cannot be filtered by anything.
 *
 * Scope is the shipping frontend. Build scripts, hooks and Rust are out — a CLI
 * script's stdout IS its interface, and Rust has its own channel (`log`/
 * `tracing`), guarded separately below.
 */

const path = require("node:path");

const { NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");
const { EDIT_TOOLS, addedLines, textPair } = require("../../lib/edit-payload.cjs");

/** The shipping frontend surface. */
const SCOPE_RE = /^src\/.*\.(tsx|ts)$/;

/** The logging module itself is where the console call legitimately lives. */
const EXEMPT_RE = /^src\/lib\/log\.ts$|\.(test|spec|stories)\./;

/** Console methods that must not appear in shipped frontend code. */
const CONSOLE_RE = /\bconsole\s*\.\s*(log|warn|error|info|debug|trace|table|dir)\s*\(/;

/** Rust surface and its print primitives. */
const RUST_SCOPE_RE = /^src-tauri\/src\/.*\.rs$/;
const RUST_PRINT_RE = /\b(?:println!|eprintln!|print!|eprint!|dbg!)\s*\(/;

/**
 * Deny an edit that introduces a raw print primitive in shipping code.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP out of scope, PASS when clean, BLOCK on a raw print.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;
  const ti = data.tool_input || {};
  const rel = path.relative(cwdOf(data), ti.file_path || "").replace(/\\/g, "/");

  const isFrontend = SCOPE_RE.test(rel) && !EXEMPT_RE.test(rel);
  const isRust = RUST_SCOPE_RE.test(rel);
  if (!isFrontend && !isRust) return NOOP;

  const { newText, oldText } = textPair(ti);
  const added = addedLines(newText, oldText);

  if (isFrontend) {
    const hit = added.find((l) => CONSOLE_RE.test(l));
    if (!hit) return PASS;
    return deny(
      "tab-guard",
      "console call in shipping code",
      `'${rel}' would call the console directly:\n  ${hit.trim().slice(0, 140)}\n\n` +
        "Use the logging module instead:\n" +
        '  import { logWarn, logError } from "@/lib/log";\n' +
        '  logWarn("repo.open.failed", { path });\n\n' +
        "A desktop user has no devtools console, so a raw console call is output nobody reads — " +
        "and it pins logging to the console forever. `src/lib/log.ts` is the one place that can " +
        "later route to a file or the Tauri log plugin. Pass a stable event key plus fields, " +
        "not a formatted sentence: a sentence cannot be filtered.",
    );
  }

  const hit = added.find((l) => RUST_PRINT_RE.test(l));
  if (!hit) return PASS;
  return deny(
    "tab-guard",
    "print macro in the Tauri core",
    `'${rel}' would print directly:\n  ${hit.trim().slice(0, 140)}\n\n` +
      "A bundled desktop binary has no attached terminal, so `println!` output goes nowhere on " +
      "the machine that matters. Use the `log` crate (`log::warn!` / `log::error!`), which the " +
      "Tauri log plugin can route to a file the user can actually send you.\n\n" +
      "`dbg!` in particular is a debugging aid — it must never reach a commit.",
  );
}

module.exports = { id: "logging-channel", run };
