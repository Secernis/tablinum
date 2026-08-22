"use strict";

/**
 * Atomic file replacement + cooperative locking for hook state writes.
 *
 * Why this module exists: hooks run as parallel short-lived processes (one
 * dispatcher per event, several per turn), and several of them persist JSON
 * state (rings, snapshots, fingerprints). A plain `fs.writeFileSync` truncates
 * the target before writing, so a concurrent reader can observe an empty or
 * torn file, and two concurrent rewriters silently clobber each other.
 *
 *   - `atomicWriteSync()` — write-to-tmp + `rename` in the same directory.
 *     `rename` replaces the target in one step (also on Windows, where Node
 *     maps it to `MoveFileEx(..., REPLACE_EXISTING)`), so readers see either
 *     the old or the new content, never a partial write.
 *   - `tryExclusive()` — a non-blocking lockfile guard (`open` with the `wx`
 *     flag). Contention is reported, not waited on — callers of best-effort
 *     work simply skip and retry on their next natural invocation. A stale lock
 *     (older than the TTL, i.e. a crashed holder) is taken over.
 */

const fs = require("node:fs");
const path = require("node:path");

/**
 * Atomically replace `file` with `data` via a sibling tmp file + rename.
 *
 * Errors propagate — callers that must be fail-open wrap the call themselves.
 * The tmp file is cleaned up when the rename fails.
 *
 * @param {string} file - Absolute target path.
 * @param {string|Buffer} data - Full new content.
 * @returns {void}
 */
function atomicWriteSync(file, data) {
  const dir = path.dirname(file);
  // pid + random suffix keeps parallel writers of the SAME target from
  // colliding on the tmp name; the losing rename simply replaces last.
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Best-effort cleanup — the original error below is the one that matters.
    }
    throw e;
  }
}

/**
 * Try to create the lockfile exclusively.
 * @param {string} lockFile - Lockfile path.
 * @returns {number|null} Open fd, or null when the lock is already held.
 */
function acquire(lockFile) {
  try {
    return fs.openSync(lockFile, "wx");
  } catch (e) {
    if (e.code === "EEXIST") return null;
    throw e;
  }
}

/**
 * True when the lockfile's mtime is older than the TTL (holder presumed dead).
 * A lockfile that vanished mid-check counts as NOT stale — the holder just
 * released it; the caller's next invocation gets a clean acquire.
 *
 * @param {string} lockFile - Lockfile path.
 * @param {number} staleTtlMs - Staleness threshold in ms.
 * @returns {boolean} Whether a takeover is warranted.
 */
function isStale(lockFile, staleTtlMs) {
  try {
    return Date.now() - fs.statSync(lockFile).mtimeMs > staleTtlMs;
  } catch {
    return false;
  }
}

/**
 * Run `fn` under a non-blocking exclusive lockfile.
 *
 * Semantics: fresh foreign lock -> skip (`{ran: false}`, `fn` not called);
 * stale lock -> take over; acquired -> run `fn`, always release, propagate its
 * throw. Deliberately no waiting/retry loop: every caller has a natural next
 * invocation that retries.
 *
 * @param {string} lockFile - Absolute lockfile path (created exclusively).
 * @param {number} staleTtlMs - Age in ms past which a foreign lock counts as dead.
 * @param {() => *} fn - Guarded critical section.
 * @returns {{ran: boolean, value?: *}} `ran: false` on contention, else `fn`'s value.
 */
function tryExclusive(lockFile, staleTtlMs, fn) {
  let fd = acquire(lockFile);
  if (fd === null) {
    if (!isStale(lockFile, staleTtlMs)) return { ran: false };
    // Stale takeover: remove the corpse and try exactly once more — losing
    // that second race means another taker won, which is a valid outcome.
    try {
      fs.unlinkSync(lockFile);
    } catch {
      return { ran: false };
    }
    fd = acquire(lockFile);
    if (fd === null) return { ran: false };
  }
  try {
    return { ran: true, value: fn() };
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // Releasing best-effort — the unlink below is what frees the lock.
    }
    try {
      fs.unlinkSync(lockFile);
    } catch {
      // A vanished lockfile is already the desired end state.
    }
  }
}

module.exports = { atomicWriteSync, tryExclusive };
