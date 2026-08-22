"use strict";

/**
 * Canonical location of the hook state tree — installation-fixed, never
 * cwd-derived.
 *
 * Why this module exists: resolving `.claude/hooks/state/...` relative to the
 * SESSION cwd (`workspace.current_dir` follows the persistent Bash cwd) means a
 * `cd .claude/hooks && ...` makes follow-up dispatches write flags into phantom
 * `.claude/hooks/.claude/hooks/state/` trees — and, worse, READ window flags
 * from paths nobody ever toggles (open windows look closed; a crafted directory
 * could make a closed window look open). This module pins the root to the hook
 * tree itself via `__dirname`.
 *
 * `TAB_HOOK_REPO_ROOT` is the TEST injection path. It is no agent bypass — hook
 * processes are spawned by the harness with the harness's environment, which
 * the agent cannot set.
 */

const path = require("node:path");

/**
 * Absolute repo root, resolved from the hook tree (.../.claude/hooks/lib -> repo).
 * @returns {string} The canonical workspace root the state tree lives under.
 */
function repoRoot() {
  return process.env.TAB_HOOK_REPO_ROOT || path.resolve(__dirname, "..", "..", "..");
}

/**
 * Absolute path of the shared, gitignored hook state directory.
 * @returns {string} `<repoRoot>/.claude/hooks/state`.
 */
function stateDir() {
  return path.join(repoRoot(), ".claude", "hooks", "state");
}

module.exports = { repoRoot, stateDir };
