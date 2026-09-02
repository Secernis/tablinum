"use strict";

/**
 * Per-session state store for the statusline hook.
 *
 * Why this module exists: the statusline runs as a fresh short-lived process on
 * every tick (up to ~3 per second), so anything it wants to remember has to
 * live on disk. Two facts need remembering, and both of them broke in the same
 * way when they shared one file:
 *
 *   - **The session start time.** It used to sit in a single
 *     `tab-session-start.json` holding a single `session_id`. Two Claude Code
 *     instances running side by side — routine here — overwrote each other's
 *     entry, and both durations jumped back to zero. An atomic write protects
 *     against a torn file, never against a logically wrong overwrite.
 *   - **The git block.** `git rev-parse` plus `git status --porcelain` measured
 *     46ms + 107ms in this repo. At three ticks a second that is most of the
 *     wall time, and since a still-running statusline script is killed when the
 *     next tick fires, it is also why the line occasionally vanished.
 *
 * Both are fixed by the same shape, which is also what the official statusline
 * guidance prescribes: ONE file per `session_id`, never one file for all
 * sessions. The session id is in the FILENAME, so concurrent sessions cannot
 * collide by construction rather than by locking.
 *
 * Every operation is fail-open: a statusline that cannot read its cache renders
 * a slightly poorer line, it does not disturb the session.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { atomicWriteSync } = require("./fs-atomic.cjs");

/**
 * How long a cached git block stays usable.
 *
 * Three seconds is well under how fast a branch or dirty-file count changes in
 * practice, and well over the tick interval — so the common case costs a small
 * JSON read instead of two process spawns.
 */
const GIT_CACHE_TTL_MS = 3000;

/** Records older than this are swept; a session outliving a day is over. */
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

const FILE_PREFIX = "tab-statusline-";

/**
 * The directory session records live in.
 *
 * `TAB_STATUSLINE_CACHE_DIR` is a test seam — unset in real runs, where the
 * store shares `~/.claude/cache` with the other hooks' per-session state.
 *
 * @returns {string} Absolute cache directory path.
 */
function cacheDir() {
  return process.env.TAB_STATUSLINE_CACHE_DIR || path.join(os.homedir(), ".claude", "cache");
}

/**
 * Absolute path of one session's record.
 *
 * The id is sanitised because it reaches the filesystem as a name: anything
 * outside the safe set collapses to `_`, so a malformed id can only ever
 * produce a harmless filename inside the cache dir.
 *
 * @param {string} sessionId - Claude Code session identifier.
 * @returns {string} Absolute record path.
 */
function sessionFile(sessionId) {
  const safe = String(sessionId).replaceAll(/[^A-Za-z0-9._-]/g, "_");
  return path.join(cacheDir(), `${FILE_PREFIX}${safe}.json`);
}

/**
 * Reads a session's record.
 *
 * @param {string} sessionId - Claude Code session identifier.
 * @returns {{start: number, dir?: string, git?: object, gitAt?: number}|null}
 *   The stored record, or null when absent or unreadable.
 */
function readSession(sessionId) {
  try {
    const record = JSON.parse(fs.readFileSync(sessionFile(sessionId), "utf8"));
    return typeof record?.start === "number" ? record : null;
  } catch {
    return null;
  }
}

/**
 * Writes a session's record, creating the cache directory if needed.
 *
 * @param {string} sessionId - Claude Code session identifier.
 * @param {object} record - Full record to persist.
 * @returns {void}
 */
function writeSession(sessionId, record) {
  try {
    const file = sessionFile(sessionId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    atomicWriteSync(file, JSON.stringify(record));
  } catch {
    // A statusline that cannot persist its state still renders — the next tick
    // simply recomputes what it could not remember.
  }
}

/**
 * Removes records of sessions that ended long ago.
 *
 * Called only when a NEW session record is created — that is once per session,
 * which keeps a directory listing off the hot path entirely.
 *
 * Age is judged by the record's OWN timestamp, not by the file's mtime. Those
 * are two different clocks that merely happen to agree, and this function holds
 * the delete button: read a pinned or skewed `nowMs` against a filesystem mtime
 * and the sweep starts deleting records of sessions that are still running.
 * Judging content against content keeps the comparison internally consistent
 * whatever the clock says.
 *
 * A record that cannot be parsed is swept as junk. The atomic writer's
 * temporary files are dot-prefixed and therefore never match the prefix, so a
 * concurrent write is never mistaken for junk.
 *
 * @param {number} nowMs - Current instant, epoch ms.
 * @returns {void}
 */
function pruneSessions(nowMs) {
  try {
    const dir = cacheDir();
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(FILE_PREFIX) || !name.endsWith(".json")) continue;
      const file = path.join(dir, name);
      let touchedAt = null;
      try {
        const record = JSON.parse(fs.readFileSync(file, "utf8"));
        touchedAt = record?.gitAt ?? record?.start ?? null;
      } catch {
        touchedAt = null;
      }
      if (typeof touchedAt !== "number" || nowMs - touchedAt > PRUNE_AFTER_MS) {
        fs.unlinkSync(file);
      }
    }
  } catch {
    // Housekeeping only — a failed sweep costs disk, never correctness.
  }
}

/**
 * Whether a stored git block may be reused.
 *
 * The directory is part of the condition, not just the age: the branch was read
 * in a specific working directory, so a `cd` inside the session invalidates it
 * no matter how fresh it is.
 *
 * @param {object|null} record - The stored session record.
 * @param {string} dir - Current working directory.
 * @param {number} nowMs - Current instant, epoch ms.
 * @returns {boolean} Whether `record.git` is still valid for `dir`.
 */
function gitBlockUsable(record, dir, nowMs) {
  return Boolean(
    record?.git
    && record.dir === dir
    && typeof record.gitAt === "number"
    && nowMs - record.gitAt < GIT_CACHE_TTL_MS,
  );
}

module.exports = {
  GIT_CACHE_TTL_MS,
  PRUNE_AFTER_MS,
  cacheDir,
  gitBlockUsable,
  pruneSessions,
  readSession,
  sessionFile,
  writeSession,
};
