"use strict";

/**
 * Shared unlock-window mechanics for the per-surface protection gates.
 *
 * Each protected surface (rules, design, hooks, brand, configs) has its OWN
 * unlock flag under the gitignored hook state dir: `state/unlock-<scope>`.
 * Windows are deliberately scoped: opening one surface never unlocks another.
 *
 * This module owns WHERE a flag lives and HOW LONG it lasts, and answers what is
 * currently open. It does not write flags: `scripts/unlock.mjs` does, because
 * that command is the user's and belongs on their side of the fence. The agent
 * is kept off it by the `unlock-channel` rule rather than by a request in a
 * docblock — a guard the guarded party can lift is not a guard.
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
 *   exists but whose TTL lapsed — a window that ran out, as distinct from one
 *   that was closed on purpose and left no flag behind.
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

module.exports = {
  SCOPES,
  UNLOCK_TTL_MS,
  flagFresh,
  flagRelFor,
  formatWindowStatus,
  hasFreshUnlock,
  readWindowSnapshot,
  windowStatus,
  writeWindowSnapshot,
};
