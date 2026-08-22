"use strict";

/**
 * Shared unlock-window mechanics for the per-surface protection gates.
 *
 * Each protected surface (rules, design, hooks, brand, configs) has its OWN
 * unlock flag under the gitignored hook state dir: `state/unlock-<scope>`. The
 * USER flips a scope's 30-minute window by running its dedicated helper script
 * (`tab-unlock-<scope>.cjs`) in their own terminal; agent-side attempts to
 * create or refresh any flag are denied by the `surface-protect` rule itself.
 * Windows are deliberately scoped: opening one surface never unlocks another.
 *
 * The helper {@link toggleWindow} is a TOGGLE, not a one-way open: a single run
 * opens a closed window and closes an open one, so the same command can be bound
 * to one key.
 */

const fs = require("node:fs");
const path = require("node:path");

const { atomicWriteSync } = require("./fs-atomic.cjs");
const { repoRoot } = require("./state-dir.cjs");

/** Unlock flag lifetime — long enough for an editing session, short enough to not linger. */
const UNLOCK_TTL_MS = 30 * 60 * 1000;

/**
 * The protected surfaces that have a user-openable unlock window.
 *
 *   rules   — CLAUDE.md + .claude/rules/**   (the standards themselves)
 *   design  — DESIGN.md                      (the product's design decisions)
 *   hooks   — .claude/hooks/**               (the enforcement layer itself)
 *   brand   — src/lib/brand, src/brand.css, public/, src-tauri/icons
 *   configs — tsconfig, vite/tauri config, capabilities, settings
 */
const SCOPES = ["rules", "design", "hooks", "brand", "configs"];

/**
 * Repo-relative flag path for a scope (under the gitignored hook state dir).
 *
 * @param {string} scope - One of {@link SCOPES}.
 * @returns {string} Relative flag path with native separators.
 */
function flagRelFor(scope) {
  return path.join(".claude", "hooks", "state", `unlock-${scope}`);
}

/**
 * Whether an absolute flag path exists and its mtime is within the TTL. The
 * single source of the "is this window open?" decision.
 *
 * @param {string} flagAbs - Absolute path of the `unlock-<scope>` flag.
 * @returns {boolean} True when the flag exists and its mtime is recent.
 */
function flagFresh(flagAbs) {
  try {
    return Date.now() - fs.statSync(flagAbs).mtimeMs < UNLOCK_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Whether a fresh (within-TTL) user unlock flag exists for a scope.
 *
 * @param {string} scope - One of {@link SCOPES}.
 * @param {string} [root] - Workspace root the flag lives under. Defaults to the
 *   canonical hook-tree root; only tests inject throwaway roots.
 * @returns {boolean} True when the flag exists and its mtime is recent.
 */
function hasFreshUnlock(scope, root = repoRoot()) {
  return flagFresh(path.join(root, flagRelFor(scope)));
}

/** Repo-relative path of the per-session window-baseline snapshot. */
const SNAPSHOT_REL = path.join(".claude", "hooks", "state", "unlock-window-snapshot.json");

/** Snapshot entries older than this are pruned on write (dead sessions). */
const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Live state of all unlock windows — the single source every status surface
 * renders from (deny enrichment, change reminders, SessionStart baseline).
 *
 * @param {string} [root] - Workspace root the flags live under.
 * @returns {Array<{scope: string, open: boolean, remainingMs: number, stale: boolean}>}
 *   One entry per scope in {@link SCOPES} order. `stale` marks a flag file that
 *   exists but whose TTL lapsed (an expired window, vs. one closed by toggle).
 */
function windowStatus(root = repoRoot()) {
  const now = Date.now();
  return SCOPES.map((scope) => {
    let mtime = null;
    try {
      mtime = fs.statSync(path.join(root, flagRelFor(scope))).mtimeMs;
    } catch {
      // Missing flag = closed window; the null mtime carries that.
    }
    const open = mtime !== null && now - mtime < UNLOCK_TTL_MS;
    // Clamp: file mtime and Date.now() come from different clock sources, so a
    // just-written flag can sit sub-ms AHEAD of now — remaining time must never
    // exceed the window length.
    return {
      open,
      remainingMs: open ? Math.min(UNLOCK_TTL_MS, UNLOCK_TTL_MS - (now - mtime)) : 0,
      scope,
      stale: mtime !== null && !open,
    };
  });
}

/**
 * Render a {@link windowStatus} result as one compact line.
 *
 * @param {Array<{scope: string, open: boolean, remainingMs: number}>} status - Live states.
 * @returns {string} The pipe-separated status line (no prefix — callers add framing).
 */
function formatWindowStatus(status) {
  return status
    .map((s) =>
      s.open ? `${s.scope} OPEN (${Math.ceil(s.remainingMs / 60000)}m left)` : `${s.scope} CLOSED`,
    )
    .join(" | ");
}

/**
 * Read the per-session window-baseline snapshot (the diff base for the
 * `unlock-status` change reminders). Fail-open: unreadable -> empty.
 *
 * @param {string} [root] - Workspace root the snapshot lives under.
 * @returns {Record<string, {at: number, open: Record<string, boolean>}>} Baselines.
 */
function readWindowSnapshot(root = repoRoot()) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, SNAPSHOT_REL), "utf8")) || {};
  } catch {
    return {};
  }
}

/**
 * Record a session's current window baseline, pruning dead sessions. Written by
 * the HOOK process only — agent writes into the state dir stay hard-denied.
 * Fail-open: a snapshot write must never break a hook dispatch.
 *
 * @param {string} sessionKey - Hook payload `session_id`.
 * @param {Array<{scope: string, open: boolean}>} status - Live states.
 * @param {string} [root] - Workspace root the snapshot lives under.
 * @returns {void}
 */
function writeWindowSnapshot(sessionKey, status, root = repoRoot()) {
  const now = Date.now();
  const snap = readWindowSnapshot(root);
  for (const [key, entry] of Object.entries(snap)) {
    if (!entry || typeof entry.at !== "number" || now - entry.at > SNAPSHOT_MAX_AGE_MS) {
      delete snap[key];
    }
  }
  const open = {};
  for (const s of status) open[s.scope] = s.open;
  snap[sessionKey] = { at: now, open };
  try {
    const file = path.join(root, SNAPSHOT_REL);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Atomic replace: parallel dispatchers read this snapshot concurrently.
    atomicWriteSync(file, JSON.stringify(snap));
  } catch {
    // Fail-open by contract (see docblock).
  }
}

/**
 * Toggles a scope's unlock flag — called ONLY by the user-run helper scripts.
 * An open window is closed by removing the flag; a closed or stale one opens a
 * fresh 30-minute window.
 *
 * @param {string} scope - One of {@link SCOPES}.
 * @param {string} hooksDir - Absolute path of `.claude/hooks` (the helper's __dirname).
 * @returns {void}
 */
function toggleWindow(scope, hooksDir) {
  if (!SCOPES.includes(scope)) {
    console.error(`[tab-unlock] unknown scope "${scope}" (valid: ${SCOPES.join(", ")}).`);
    process.exit(1);
  }
  const flag = path.join(hooksDir, "state", `unlock-${scope}`);
  if (flagFresh(flag)) {
    fs.rmSync(flag, { force: true });
    console.log(`[tab-unlock-${scope}] edit window closed (locked).`);
    return;
  }
  fs.mkdirSync(path.dirname(flag), { recursive: true });
  fs.writeFileSync(flag, new Date().toISOString());
  const until = new Date(Date.now() + UNLOCK_TTL_MS);
  console.log(
    `[tab-unlock-${scope}] edit window open until ${until.toLocaleTimeString()} (30 min).`,
  );
}

module.exports = {
  SCOPES,
  UNLOCK_TTL_MS,
  flagFresh,
  flagRelFor,
  formatWindowStatus,
  hasFreshUnlock,
  readWindowSnapshot,
  toggleWindow,
  windowStatus,
  writeWindowSnapshot,
};
