"use strict";

/**
 * PreToolUse rule — the governance surfaces are agent-edit-protected.
 *
 * Five surfaces decide what "correct" means in this repository, and an agent
 * that can edit them can dissolve every other gate without ever tripping one:
 *
 *   rules   — CLAUDE.md, .claude/rules/**    (the standards themselves)
 *   design  — DESIGN.md                      (the product's design decisions)
 *   hooks   — .claude/hooks/**               (this enforcement layer)
 *   brand   — src/lib/brand/**, src/brand.css, public/**, src-tauri/icons/**
 *   configs — tsconfig*, vite.*.config.*, tauri.conf.json, capabilities/**
 *
 * The protection is not absolute — it is a per-surface window the USER opens
 * from their own terminal:
 *
 *   node .claude/hooks/tab-unlock-rules.cjs      # 30 minutes, toggles
 *
 * Windows are scoped: opening `design` never unlocks `hooks`. And the state
 * directory itself stays write-denied even inside a window, because a rule that
 * can forge its own unlock flag is not a rule.
 *
 * The brand surface deserves its own line. `design/` is not in the repository —
 * the mark's generator is private — so the committed brand assets are the only
 * copy the app builds from. An agent regenerating one by hand produces something
 * that looks right and is no longer reproducible from the source.
 */

const path = require("node:path");

const { EXCUSED, NOOP, PASS, cwdOf, deny, noteDetail } = require("../../lib/io.cjs");
const { EDIT_TOOLS } = require("../../lib/edit-payload.cjs");
const { hasFreshUnlock } = require("../../lib/unlock.cjs");

/**
 * Surface definitions, evaluated in order. The FIRST match wins, so the more
 * specific pattern must come first — `.claude/hooks/state/` before
 * `.claude/hooks/`.
 */
const SURFACES = [
  {
    // Never unlockable: the hook state tree holds the unlock flags themselves.
    hard: true,
    re: /^\.claude\/hooks\/state\//,
    scope: "hooks-state",
    why: "The hook state directory holds the unlock flags. A surface that can write its own unlock flag has no protection at all.",
  },
  {
    re: /^(?:CLAUDE\.md|\.claude\/rules\/)/,
    scope: "rules",
    why: "CLAUDE.md and .claude/rules/** are the standards every other gate enforces.",
  },
  {
    re: /^DESIGN\.md$/,
    scope: "design",
    why: "DESIGN.md records design decisions that were made deliberately, often against a plausible alternative.",
  },
  {
    re: /^\.claude\/hooks\//,
    scope: "hooks",
    why: "This is the enforcement layer. An agent that can edit it can dissolve every other gate silently.",
  },
  {
    re: /^(?:src\/lib\/brand\/|src\/brand\.css$|public\/|src-tauri\/icons\/)/,
    scope: "brand",
    why: "The brand assets are generated from design/, which is private and not in this repo — the committed files are the only copy, and a hand-edited one is no longer reproducible.",
  },
  {
    re: /^(?:tsconfig[^/]*\.json|vite[^/]*\.config\.ts|src-tauri\/tauri(?:\.[a-z]+)?\.conf\.json|src-tauri\/capabilities\/|\.claude\/settings\.json)$/,
    scope: "configs",
    why: "These files decide what the compiler, the bundler and the Tauri runtime permit. Loosening one is a product decision, not a build fix.",
  },
];

/**
 * Classify a repo-relative path into a protected surface.
 *
 * @param {string} rel - Repo-relative POSIX path.
 * @returns {{scope: string, why: string, hard?: boolean}|null} The surface, or null.
 */
function surfaceOf(rel) {
  return SURFACES.find((s) => s.re.test(rel)) || null;
}

/**
 * Deny edits to a governance surface unless the user opened its window.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP outside the surfaces, EXCUSED inside an open window,
 *   PASS for an ordinary file, BLOCK otherwise.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;
  const target = data.tool_input && data.tool_input.file_path;
  if (!target) return NOOP;

  const rel = path.relative(cwdOf(data), target).replace(/\\/g, "/");
  // A path outside the repo is not one of our surfaces.
  if (!rel || rel.startsWith("..")) return NOOP;

  const surface = surfaceOf(rel);
  if (!surface) return PASS;
  noteDetail(surface.scope);

  if (!surface.hard && hasFreshUnlock(surface.scope)) return EXCUSED;

  const reopen = surface.hard
    ? "There is no unlock window for this path — edit it yourself, outside the agent session."
    : `The user can open a 30-minute window from their own terminal:\n` +
      `  node .claude/hooks/tab-unlock-${surface.scope}.cjs\n` +
      `Ask for it and say what you want to change and why. Do not run that command yourself — ` +
      `an agent-side unlock is the same as no lock.`;

  return deny(
    "tab-guard",
    `Protected surface: ${surface.scope}`,
    `'${rel}' belongs to the '${surface.scope}' surface, which is closed to agent edits.\n\n` +
      `${surface.why}\n\n${reopen}`,
  );
}

module.exports = { SURFACES, id: "surface-protect", run, surfaceOf };
