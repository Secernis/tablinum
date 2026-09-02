#!/usr/bin/env node
"use strict";

const path = require("path");

const { gitRead } = require("./lib/git-readonly.cjs");

const {
  gitBlockUsable,
  pruneSessions,
  readSession,
  writeSession,
} = require("./lib/statusline-cache.cjs");
const {
  FIVE_HOUR_MS,
  capacityInfo,
  paceInfo,
  rateColorAbs,
} = require("./lib/statusline-capacity.cjs");

/** Columns held back from COLUMNS for the interface's own framing and padding. */
const LINE_WIDTH_MARGIN = 6;
/** Below this the terminal is too narrow for any sensible budgeting. */
const MIN_USABLE_COLUMNS = 40;
/** A branch shorter than this says nothing at all — stop squeezing here. */
const BRANCH_MIN_LEN = 12;
/** Per-segment cap used when the terminal width is unknown (pre-COLUMNS behaviour). */
const BRANCH_FALLBACK_LEN = 35;
/** Visible columns the branch segment costs besides the name: separator + glyph. */
const BRANCH_DECORATION_WIDTH = 5;

// Matches the SGR colour codes this hook emits. Rendered width is what the
// budget is about, and these bytes occupy no column.
const ANSI_SGR_RE = /\[[0-9;]*m/g;

/**
 * Rendered width of a segment, i.e. its length once colour codes are removed.
 *
 * @param {string} text - Segment possibly carrying ANSI colour codes.
 * @returns {number} Number of terminal columns the segment occupies.
 */
function visibleWidth(text) {
  return text.replaceAll(ANSI_SGR_RE, "").length;
}

/**
 * Shortens text to `max` characters by eliding the MIDDLE.
 *
 * Both ends carry meaning in the names this is used on: a branch
 * `refactor/design-system--improve-dep-graph` says what kind of work it is at
 * the front and what it is about at the back. Cutting the tail keeps only the
 * half that every sibling branch shares, so the elision goes in the middle.
 *
 * @param {string} text - Text to shorten.
 * @param {number} max - Maximum rendered length, ellipsis included.
 * @returns {string} `text` unchanged when it fits, else a middle-elided form.
 */
function shortenMiddle(text, max) {
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return text.slice(0, head) + "…" + (tail > 0 ? text.slice(-tail) : "");
}

let input = "";
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    // Drop a trailing "(… context)" note (e.g. "Opus 4.8 (1M context)") — the
    // model identity is what matters in the statusline, the context size is noise.
    const model = (data.model?.display_name || "Claude").replace(
      /\s*\([^)]*context[^)]*\)\s*$/i,
      "",
    );
    const dir = data.workspace?.current_dir || process.cwd();
    const remaining = data.context_window?.remaining_percentage;
    const cost = data.cost?.total_cost_usd;
    const sessionId = data.session_id;

    const SEP = " \u2502 ";

    // Claude Code captures the script's stdout instead of attaching it to the
    // terminal, so `process.stdout.columns` is undefined here and `tput cols`
    // reads nothing \u2014 the width arrives through COLUMNS, which Claude Code sets
    // before each run. Absent or implausible means "budget unknown", not "zero".
    const columns = Number(process.env.COLUMNS);
    const budget =
      Number.isFinite(columns) && columns >= MIN_USABLE_COLUMNS
        ? columns - LINE_WIDTH_MARGIN
        : null;

    // Context usage bar
    let ctx = "";
    if (remaining != null) {
      const used = Math.max(0, Math.min(100, 100 - Math.round(remaining)));
      const filled = Math.round(used / 10);
      const bar = "\u2588".repeat(filled) + "\u2591".repeat(10 - filled);
      const color =
        used < 50
          ? "32" // green
          : used < 65
            ? "33" // yellow
            : used < 80
              ? "38;5;208" // orange
              : "5;31"; // blinking red
      ctx = SEP + `\x1b[${color}m${bar} ${used}%\x1b[0m`;
    }

    // Rate-limit display (5h + 7d windows)
    // Only available for Pro/Max accounts after the first API response of the session.
    //
    // Test seam: pins "now" so the day-of-week dependent capacity curve in
    // `lib/statusline-capacity.cjs` can be asserted deterministically. Unset in
    // real runs — every consumer of the clock takes it as an argument.
    const NOW_MS = Number(process.env.TAB_STATUSLINE_NOW_MS) || Date.now();

    // Renders the pace overshoot as a compact " (+13%)" suffix; empty when the
    // segment is not pace-red.
    function fmtOverBy(overBy) {
      return overBy == null ? "" : ` (+${Math.round(overBy)}%)`;
    }

    /**
     * Names the day an alarm falls on. Day granularity is the point: the
     * underlying instant carries no real time-of-day information, so printing
     * one would be false precision.
     *
     * @param {number} ms - The instant to name, epoch ms.
     * @returns {string} "heute" for the current day, else a weekday shorthand.
     */
    function fmtDay(ms) {
      const d = new Date(ms);
      if (d.toDateString() === new Date(NOW_MS).toDateString()) return "heute";
      return ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][d.getDay()];
    }

    function fmtTime(epochSec) {
      const d = new Date(epochSec * 1000);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    }
    function fmtTimeWithDay(epochSec) {
      const d = new Date(epochSec * 1000);
      const sameDay = d.toDateString() === new Date(NOW_MS).toDateString();
      if (sameDay) return fmtTime(epochSec);
      // Day-of-week prefix for resets >24h away (typical for 7d window)
      const days = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
      return `${days[d.getDay()]} ${fmtTime(epochSec)}`;
    }
    let rateStr = "";
    const fiveHour = data.rate_limits?.five_hour;
    const sevenDay = data.rate_limits?.seven_day;
    if (fiveHour?.used_percentage != null) {
      const used = Math.round(fiveHour.used_percentage);
      const { color, overBy } = fiveHour.resets_at
        ? paceInfo(fiveHour.used_percentage, fiveHour.resets_at, FIVE_HOUR_MS, NOW_MS)
        : { color: rateColorAbs(used), overBy: null };
      const reset = fiveHour.resets_at ? ` \x1b[2m→${fmtTime(fiveHour.resets_at)}\x1b[0m` : "";
      rateStr += SEP + `\x1b[${color}m5h ${used}%${fmtOverBy(overBy)}\x1b[0m${reset}`;
    }
    if (sevenDay?.used_percentage != null) {
      const used = Math.round(sevenDay.used_percentage);
      const info = sevenDay.resets_at
        ? capacityInfo(sevenDay.used_percentage, sevenDay.resets_at, NOW_MS)
        : null;
      // No usable projection (no reset timestamp, or the window barely started)
      // falls back to absolute thresholds rather than inventing a forecast.
      const color = info ? info.color : rateColorAbs(used);
      const alarm = info?.dryAtMs != null ? ` (leer ${fmtDay(info.dryAtMs)})` : "";
      const reset = sevenDay.resets_at
        ? ` \x1b[2m→${fmtTimeWithDay(sevenDay.resets_at)}\x1b[0m`
        : "";
      rateStr += SEP + `\x1b[${color}m7d ${used}%${alarm}\x1b[0m${reset}`;
    }

    // Cost display
    let costStr = "";
    if (cost != null && cost > 0) {
      costStr = SEP + `\x1b[2m$${cost.toFixed(2)}\x1b[0m`;
    }

    // Wall clock — line 1 opens with the local time. It replaced the version
    // marker of a retired framework install: a fixed-width segment that answers
    // "what time is it" while the eyes are on the terminal anyway. Rendered
    // from NOW_MS so the test suite can pin it.
    const clockLabel = "\x1b[2m" + fmtTime(NOW_MS / 1000) + "\x1b[0m";

    // ── Per-session state ─────────────────────────────────────────────────
    // One record per session id (never one shared file — parallel sessions are
    // routine and clobbered each other's start time). It carries the session
    // start AND the cached git block; see lib/statusline-cache.cjs for why both
    // live in the same artefact.
    const record = sessionId ? readSession(sessionId) : null;
    const session = record ?? (sessionId ? { start: NOW_MS } : null);
    // A brand-new record is the once-per-session moment to sweep dead ones, so
    // the directory listing never lands on the hot path.
    if (sessionId && !record) pruneSessions(NOW_MS);
    let sessionDirty = sessionId != null && record == null;

    /**
     * Reads branch name and dirty-file count from git.
     *
     * @param {string} cwd - Directory to inspect.
     * @returns {{branch: string, count: number}|null} Null outside a repo.
     */
    function readGit(cwd) {
      try {
        // The highest-frequency git caller in the repo: up to a tick per
        // second, each killed when the next one fires. Going through gitRead
        // matters twice here — no shell wrapper to absorb the kill, and no
        // index lock to strand when it lands mid-refresh.
        const branchRes = gitRead(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], { timeout: 2000 });
        if (branchRes.status !== 0) return null;
        const statusRes = gitRead(cwd, ["status", "--porcelain"], { timeout: 2000 });
        if (statusRes.status !== 0) return null;
        const out = statusRes.stdout;
        return {
          branch: branchRes.stdout.trim(),
          count: out ? out.trim().split("\n").filter(Boolean).length : 0,
        };
      } catch (_) {
        return null;
      }
    }

    let git;
    if (gitBlockUsable(session, dir, NOW_MS)) {
      git = session.git;
    } else {
      git = readGit(dir);
      if (session) {
        session.git = git;
        session.gitAt = NOW_MS;
        session.dir = dir;
        sessionDirty = true;
      }
    }
    if (sessionDirty) writeSession(sessionId, session);

    // Git branch \u2014 the branch is the ELASTIC segment of line 1; how wide it may
    // render is decided further down, once every other segment's width is known.
    let renderBranch = () => "";
    let changesStr = "";
    if (git) {
      const { branch, count } = git;
      const isDefault = branch === "main" || branch === "master";
      const branchColor = isDefault ? "31" : "35"; // red on main, magenta otherwise
      renderBranch = (width) =>
        SEP + `\x1b[${branchColor}m\u2387 ${shortenMiddle(branch, width)}\x1b[0m`;

      if (count > 0) {
        const countColor = count >= 20 ? "33" : "2";
        const label = count === 1 ? "change" : "changes";
        changesStr = SEP + `\x1b[${countColor}m${count} ${label}\x1b[0m`;
      }
    }

    // PR status for the current branch — rendered purely from `data.pr`
    // (absent when no PR exists / not a git repo). Text-presentation symbols
    // only, per the no-emoji policy.
    let prStr = "";
    const pr = data.pr;
    if (pr?.number != null) {
      const PR_STATES = {
        approved: { color: "32", symbol: "✓" }, // green check
        changes_requested: { color: "33", symbol: "⚠" }, // yellow warning
        draft: { color: "2", symbol: "◌" }, // dim dotted circle
        pending: { color: "2", symbol: "⧖" }, // dim hourglass
      };
      const state = PR_STATES[pr.review_state] || { color: "2", symbol: "" };
      const suffix = state.symbol ? " " + state.symbol : "";
      prStr = SEP + `\x1b[${state.color}mPR #${pr.number}${suffix}\x1b[0m`;
    }

    // Session duration \u2014 the accumulation signal, deliberately NOT redundant
    // with the context bar. The bar measures occupancy (how much room is gone);
    // the duration stands in for how much history is being carried along. An
    // hour of read-only work leaves the bar near 10% while a long trail of
    // assumptions and discarded paths already rides in every turn, and that \u2014
    // not running out of room \u2014 is the reason to /clear.
    let durationStr = "";
    if (session) {
      const mins = Math.floor((NOW_MS - session.start) / 60000);
      if (mins >= 1) {
        const display =
          mins < 60
            ? mins + "m"
            : Math.floor(mins / 60) + "h" + (mins % 60 ? (mins % 60) + "m" : "");
        const timeColor = mins >= 45 ? "33" : "2"; // yellow after 45min
        durationStr = SEP + `\x1b[${timeColor}m\u23F1 ${display}\x1b[0m`;
      }
    }

    // Two-line layout:
    //   Line 1: identity + git context (clock, model, dir, branch, changes, duration)
    //   Line 2: resource usage (context window, rate limits, cost)
    // Resource line is only emitted when at least one resource segment exists,
    // so accounts without rate-limit data still get a clean single line.
    //
    // ── Fitting line 1 ────────────────────────────────────────────────────
    // What overflows is the LINE, not the branch: clock, model, directory, PR
    // and change count all add up. Budgeting against a fixed per-segment
    // constant therefore misses the actual failure, which is line 2 being
    // dropped by the multi-line renderer once line 1 wraps — and line 2 is
    // where every resource number lives.
    const head =
      clockLabel +
      SEP +
      "\x1b[2m" +
      model +
      "\x1b[0m" +
      SEP +
      "\x1b[2m" +
      path.basename(dir) +
      "\x1b[0m";
    // Segments after the branch, in render order. Once even a floored branch
    // does not fit they are given up from the END, so the order below IS the
    // order of sacrifice: the duration goes first (softest signal), then the
    // change count, and the PR marker only when nothing else is left to give.
    const trailing = [prStr, changesStr, durationStr];

    let line1;
    if (budget == null) {
      // No usable COLUMNS (older CLI, odd environment): fall back to the fixed
      // per-segment cap this hook used before the budget existed.
      line1 = head + renderBranch(BRANCH_FALLBACK_LEN) + trailing.join("");
    } else {
      // Drop from the end only after the branch has been squeezed to its floor,
      // so a wide terminal never loses a segment it had room for.
      for (let keep = trailing.length; ; keep--) {
        const tail = trailing.slice(0, keep).join("");
        const fixedWidth = visibleWidth(head) + visibleWidth(tail) + BRANCH_DECORATION_WIDTH;
        const forBranch = budget - fixedWidth;
        if (forBranch >= BRANCH_MIN_LEN || keep === 0) {
          line1 = head + renderBranch(Math.max(forBranch, BRANCH_MIN_LEN)) + tail;
          break;
        }
      }
    }
    // Resource segments already start with SEP — strip the leading one for line 2.
    const resourceRaw = ctx + rateStr + costStr;
    const line2 = resourceRaw.startsWith(SEP) ? resourceRaw.slice(SEP.length) : resourceRaw;
    // Trailing newline: Claude Code's multi-line statusline renderer can drop
    // the last line when the output does not end in one.
    process.stdout.write((line2 ? line1 + "\n" + line2 : line1) + "\n");
  } catch (_) {}
});
