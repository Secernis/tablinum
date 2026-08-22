"use strict";

/**
 * PreToolUse rule — icons come from one library.
 *
 * This app draws its icons from `@tailgrids/icons`, and that is a decision, not
 * a default. A second icon set arriving alongside it costs three things at once:
 * bundle weight in a desktop binary that ships every byte, a visual seam where
 * two sets meet (different stroke weights and optical sizes never quite agree),
 * and a maintenance surface where the same concept has two names.
 *
 * The rule fires on an ADDED import line, so moving an existing one is free and
 * the legacy field is paid down deliberately rather than by ambush.
 */

const path = require("node:path");

const { NOOP, PASS, cwdOf, deny } = require("../../lib/io.cjs");
const { EDIT_TOOLS, addedLines, textPair } = require("../../lib/edit-payload.cjs");

/** Where the rule applies: the app's own React surface. */
const SCOPE_RE = /^src\/.*\.(tsx|ts|jsx|js)$/;

/** Icon libraries that must not appear beside the chosen one. */
const FOREIGN_ICON_PACKAGES = [
  "lucide-react",
  "lucide",
  "react-icons",
  "@heroicons/react",
  "heroicons",
  "@phosphor-icons/react",
  "phosphor-react",
  "@radix-ui/react-icons",
  "react-feather",
  "@fortawesome/react-fontawesome",
];

/** An import or require naming one of the foreign packages. */
const IMPORT_RE = /(?:from\s+|require\(\s*)["']([^"']+)["']/;

/**
 * Find a foreign icon import in a set of added lines.
 *
 * @param {string[]} lines - Lines the edit introduces.
 * @returns {string|null} The offending package, or null.
 */
function findForeignImport(lines) {
  for (const line of lines) {
    const m = IMPORT_RE.exec(line);
    if (!m) continue;
    const spec = m[1];
    const hit = FOREIGN_ICON_PACKAGES.find((p) => spec === p || spec.startsWith(`${p}/`));
    if (hit) return hit;
  }
  return null;
}

/**
 * Deny an edit that introduces a second icon library.
 *
 * @param {object} data - PreToolUse hook payload.
 * @returns {number} NOOP out of scope, PASS when clean, BLOCK on a foreign import.
 */
function run(data) {
  if (!EDIT_TOOLS.has(data.tool_name)) return NOOP;
  const ti = data.tool_input || {};
  const rel = path.relative(cwdOf(data), ti.file_path || "").replace(/\\/g, "/");
  if (!SCOPE_RE.test(rel)) return NOOP;

  const { newText, oldText } = textPair(ti);
  const hit = findForeignImport(addedLines(newText, oldText));
  if (!hit) return PASS;

  return deny(
    "tab-guard",
    "Second icon library",
    `'${rel}' would import icons from \`${hit}\`.\n\n` +
      "Icons in this app come from `@tailgrids/icons` — one set, one stroke weight, one set of " +
      "names. A second library adds bundle weight to a binary that ships every byte, and puts " +
      "a visible seam wherever the two meet.\n\n" +
      "If the icon you need genuinely has no equivalent there, say which one and why — adding a " +
      "dependency is the user's call, not a workaround.",
  );
}

module.exports = { FOREIGN_ICON_PACKAGES, findForeignImport, id: "icon-imports", run };
