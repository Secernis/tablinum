"use strict";

/**
 * PreToolUse rule — widening the Tauri attack surface is a decision, not a fix.
 *
 * A Tauri app is a webview with a native process behind it, and everything the
 * frontend is allowed to reach, it reaches with the user's own privileges. Two
 * files decide how much that is: `capabilities/*.json` (which commands the
 * webview may call) and `tauri.conf.json` (the CSP, the dev URL, the shell and
 * filesystem scopes).
 *
 * The pattern this catches is the ordinary one: a call fails with a permission
 * error, and the fastest way forward is to grant the broadest permission that
 * makes the error go away. `fs:allow-read-file` becomes `fs:default`, a scoped
 * path becomes `**`, the CSP becomes `null`. Each step is one line and each one
 * is permanent, because nobody narrows a permission that already works.
 *
 * Tablinum reads and writes the user's repositories. A shell or filesystem
 * permission here is not a formality — it is the difference between an app that
 * can run `git status` and one that can run anything.
 */

const path = require("node:path");

const { NOOP, PASS, cwdOf, deny, noteDetail } = require("../../lib/io.cjs");
const { EDIT_TOOLS, addedLines, textPair } = require("../../lib/edit-payload.cjs");

/** Capability manifests. */
const CAPABILITY_RE = /^src-tauri\/capabilities\/.*\.json$/;
/** The Tauri configuration. */
const CONFIG_RE = /^src-tauri\/tauri(?:\.[a-z]+)?\.conf\.json$/;

/**
 * Permissions that hand over a broad native capability.
 *
 * Named individually rather than by prefix so the message can say what each one
 * actually opens — "this grants filesystem access" is actionable, "this looks
 * risky" is not.
 */
const BROAD_PERMISSIONS = [
  ["shell:allow-execute", "runs arbitrary programs with the user's privileges"],
  ["shell:default", "includes command execution"],
  ["shell:allow-open", "hands arbitrary URLs and paths to the OS handler"],
  ["fs:default", "grants the full filesystem permission set"],
  ["fs:allow-write-file", "writes anywhere the scope permits"],
  ["fs:allow-remove", "deletes anywhere the scope permits"],
  ["fs:scope", "widens which paths the frontend may reach"],
  ["http:default", "lets the webview make arbitrary outbound requests"],
  ["process:allow-restart", "restarts the app programmatically"],
  ["webview:allow-create-webview", "opens a second webview, outside the main window's capability set"],
];

/** A wildcard scope — the widest possible spelling of a path permission. */
const WILDCARD_SCOPE_RE = /"(?:\*\*|\/\*\*|\*)"/;

/** Config-level weakenings, as `[name, pattern, why]`. */
const CONFIG_WEAKENINGS = [
  ['"csp": null', /"csp"\s*:\s*null/, "removes the Content-Security-Policy entirely, so any injected script runs"],
  ['"dangerousDisableAssetCspModification"', /"dangerousDisableAssetCspModification"\s*:\s*true/, "lets asset loading bypass the CSP"],
  ['"dangerousUseHttpScheme"', /"dangerousUseHttpScheme"\s*:\s*true/, "serves the app over plain HTTP"],
  ["`unsafe-inline` in the CSP", /unsafe-inline/, "reopens the injected-script class the CSP exists to close"],
  ["`unsafe-eval` in the CSP", /unsafe-eval/, "allows string-to-code evaluation in the webview"],
  ['"withGlobalTauri"', /"withGlobalTauri"\s*:\s*true/, "exposes the whole Tauri API on `window`, reachable by any script that runs"],
  ["a remote devUrl", /"devUrl"\s*:\s*"https?:\/\/(?!localhost|127\.0\.0\.1)/, "points the dev webview at a remote origin"],
];

/**
 * Deny an edit that widens the Tauri attack surface.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP out of scope, PASS when clean, BLOCK on a widening.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;
  const ti = data.tool_input || {};
  const rel = path.relative(cwdOf(data), ti.file_path || "").replace(/\\/g, "/");
  const isCapability = CAPABILITY_RE.test(rel);
  const isConfig = CONFIG_RE.test(rel);
  if (!isCapability && !isConfig) return NOOP;

  const { newText, oldText } = textPair(ti);

  if (isCapability) {
    noteDetail("capability");
    const added = addedLines(newText, oldText);
    for (const [perm, why] of BROAD_PERMISSIONS) {
      if (added.some((l) => l.includes(`"${perm}`))) {
        return deny(
          "tab-guard",
          "Tauri capability widened",
          `'${rel}' would grant \`${perm}\` — it ${why}.\n\n` +
            "In a Git client the frontend already handles the user's repositories; a broad " +
            "native permission turns a rendering bug into a filesystem or shell reach.\n\n" +
            "Grant the NARROWEST permission that makes the specific call work (an " +
            "`allow-<command>` rather than a `:default` set), scope it to the paths you " +
            "actually need, and say in the commit why this app needs it.",
        );
      }
    }
    if (added.some((l) => WILDCARD_SCOPE_RE.test(l))) {
      return deny(
        "tab-guard",
        "Wildcard scope in a Tauri capability",
        `'${rel}' would add a wildcard path scope.\n\n` +
          "`**` means every path the user can reach. Name the directories this feature needs — " +
          "a scope nobody narrows later is a scope that stays open for the life of the app.",
      );
    }
    return PASS;
  }

  noteDetail("config");
  for (const [name, re, why] of CONFIG_WEAKENINGS) {
    if (re.test(newText) && !re.test(oldText)) {
      return deny(
        "tab-guard",
        "Tauri security config weakened",
        `'${rel}' would set ${name} — it ${why}.\n\n` +
          "The webview runs with the native process behind it. Every one of these settings " +
          "trades a real boundary for convenience, and none of them get narrowed again once " +
          "the feature they unblocked is working.\n\n" +
          "Fix the underlying cause instead; if the setting genuinely has to change, that is " +
          "the user's decision and belongs in the CHANGELOG under `Security`.",
      );
    }
  }
  return PASS;
}

module.exports = { BROAD_PERMISSIONS, CONFIG_WEAKENINGS, id: "tauri-security", run };
