#!/usr/bin/env node
"use strict";

/**
 * Tests for `tab-statusline.cjs`.
 *
 * StatusLine hook — reads context state, prints status text to stdout.
 * Smoke-level: tolerate empty payload and basic statusline-shape input.
 * Output format (the actual status string) is asserted by Claude Code's
 * own statusline contract and is too volatile to lock here — EXCEPT the
 * PR-status segment, whose presence/absence against `data.pr` is our own
 * contract and is asserted behaviorally below.
 */

const { execSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOOK = path.join(__dirname, "tab-statusline.cjs");

// The statusline caches per-session git blocks and prunes stale ones. Its only
// state channel is that cache dir, which defaults to the SHARED `~/.claude/
// cache` a live session writes at the same moment — the same class of race as
// the 2026-07-18 hook-state incident, one directory over. The cache-behaviour
// cases further down pass their own dir per run; this is the suite-wide DEFAULT
// that keeps the smoke and PR-segment cases above them out of the real cache.
const SUITE_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tab-statusline-cache-"));
process.env.TAB_STATUSLINE_CACHE_DIR = SUITE_CACHE_DIR;

function run(input, env) {
  const r = spawnSync("node", [HOOK], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    timeout: 5000,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return { status: r.status, stderr: (r.stderr || "").trim(), stdout: r.stdout || "" };
}

const cases = [
  {
    name: "minimal statusline payload",
    input: { workspace: { current_dir: process.cwd() } },
    expectStatus: 0,
  },
  { name: "empty payload tolerated", input: {}, expectStatus: 0 },
  { name: "malformed JSON tolerated", input: "{not-json", expectStatus: 0 },
];

let failed = 0;
for (const c of cases) {
  const { status, stderr } = run(c.input);
  if (status !== c.expectStatus) {
    failed++;
    console.error(`  ✖ ${c.name} — expected exit ${c.expectStatus}, got ${status}`);
    if (stderr) console.error(`      stderr: ${stderr.split("\n")[0]}`);
  }
}

// ── PR-status segment: presence/absence + per-state symbol ──────────────────
// Non-git tmpdir keeps the branch segment out of the way; the PR segment
// must render purely from `data.pr` (fields absent = no PR = no segment).

const PLAIN_DIR = os.tmpdir();

const prCases = [
  {
    name: "pr approved renders number + check",
    input: {
      pr: { number: 123, review_state: "approved", url: "https://example.invalid/123" },
      workspace: { current_dir: PLAIN_DIR },
    },
    expect: (out) => out.includes("PR #123") && out.includes("✓"),
  },
  {
    name: "pr changes_requested renders warning symbol",
    input: {
      pr: { number: 7, review_state: "changes_requested" },
      workspace: { current_dir: PLAIN_DIR },
    },
    expect: (out) => out.includes("PR #7") && out.includes("⚠"),
  },
  {
    name: "pr draft renders dotted-circle symbol",
    input: { pr: { number: 8, review_state: "draft" }, workspace: { current_dir: PLAIN_DIR } },
    expect: (out) => out.includes("PR #8") && out.includes("◌"),
  },
  {
    name: "pr pending renders hourglass symbol",
    input: { pr: { number: 9, review_state: "pending" }, workspace: { current_dir: PLAIN_DIR } },
    expect: (out) => out.includes("PR #9") && out.includes("⧖"),
  },
  {
    name: "unknown review_state still renders the number",
    input: {
      pr: { number: 10, review_state: "weird-future-state" },
      workspace: { current_dir: PLAIN_DIR },
    },
    expect: (out) => out.includes("PR #10"),
  },
  {
    name: "no pr data = no PR segment",
    input: { workspace: { current_dir: PLAIN_DIR } },
    expect: (out) => !out.includes("PR #"),
  },
];

for (const c of prCases) {
  const { status, stdout } = run(c.input);
  if (status !== 0 || !c.expect(stdout)) {
    failed++;
    console.error(
      `  ✖ ${c.name} — exit ${status}, stdout: ${JSON.stringify(stdout.slice(0, 200))}`,
    );
  }
}

// ── Model display name: strip the "(… context)" suffix, keep the model ─────
// Claude Code reports e.g. "Opus 4.8 (1M context)"; the context note is noise
// in the statusline, the model identity is what matters.

const modelCases = [
  {
    name: "model suffix '(1M context)' is stripped",
    input: {
      model: { display_name: "Opus 4.8 (1M context)" },
      workspace: { current_dir: PLAIN_DIR },
    },
    expect: (out) => out.includes("Opus 4.8") && !out.includes("context"),
  },
  {
    name: "model without suffix is kept verbatim",
    input: { model: { display_name: "Sonnet 4.6" }, workspace: { current_dir: PLAIN_DIR } },
    expect: (out) => out.includes("Sonnet 4.6"),
  },
];

for (const c of modelCases) {
  const { status, stdout } = run(c.input);
  if (status !== 0 || !c.expect(stdout)) {
    failed++;
    console.error(
      `  ✖ ${c.name} — exit ${status}, stdout: ${JSON.stringify(stdout.slice(0, 200))}`,
    );
  }
}

// ── Rate-limit pace delta: explain a RED segment with its distance over the line ──
// Red is pace-relative (used% - elapsed% > 10pp), so the bare percentage hides
// how far over budget the window actually is. A red segment therefore carries a
// "(+N%)" suffix; every non-red state, the absolute-threshold fallback and the
// used>=95 hard floor stay suffix-free (the delta does not explain those).

const FIVE_HOUR_SEC = 5 * 60 * 60;

/**
 * Builds a `resets_at` epoch that puts the window at a given elapsed fraction.
 *
 * @param {number} windowSec - Window length in seconds.
 * @param {number} elapsedPct - Desired elapsed share of the window, 0-100.
 * @returns {number} Epoch seconds at which the window resets.
 */
function resetsAtForElapsed(windowSec, elapsedPct) {
  return Math.round(Date.now() / 1000 + windowSec * (1 - elapsedPct / 100));
}

const rateCases = [
  {
    name: "5h red by pace renders the delta suffix",
    // 60% used against 40% elapsed = +20pp over the line.
    input: {
      workspace: { current_dir: PLAIN_DIR },
      rate_limits: {
        five_hour: { used_percentage: 60, resets_at: resetsAtForElapsed(FIVE_HOUR_SEC, 40) },
      },
    },
    expect: (out) => out.includes("5h 60%") && out.includes("(+20%)"),
  },
  {
    name: "5h on pace renders no suffix",
    input: {
      workspace: { current_dir: PLAIN_DIR },
      rate_limits: {
        five_hour: { used_percentage: 50, resets_at: resetsAtForElapsed(FIVE_HOUR_SEC, 50) },
      },
    },
    expect: (out) => out.includes("5h 50%") && !out.includes("(+"),
  },
];

for (const c of rateCases) {
  const { status, stdout } = run(c.input);
  if (status !== 0 || !c.expect(stdout)) {
    failed++;
    console.error(
      `  ✖ ${c.name} — exit ${status}, stdout: ${JSON.stringify(stdout.slice(0, 200))}`,
    );
  }
}

// ── 7d capacity curve: run-dry alarm instead of a clock-linear pace ─────────
// The 7d budget is meant to be spent in full and to last exactly until the
// reset, so the useful question is "will it run out early?" — not "am I faster
// than the clock". Wall-clock pacing answers that wrongly for an uneven week:
// it demands restraint on a free Sunday morning and credits progress during a
// shift. The baseline is therefore the AVAILABLE-hours curve, and the segment
// only speaks up when the budget is projected to run dry before reset.
//
// Hours per day are the model; the shift's time of day deliberately is NOT.
// The account runs a rotating three-shift schedule, so the free block moves
// every week while its LENGTH stays put — any hardcoded shift position would be
// wrong two weeks in three, and a wrong hour is worse than no hour.
//
// The one clock fact that IS shift-invariant: nothing happens between midnight
// and 07:00 — asleep on early/late weeks, at work on night weeks. Measured over
// 1954 commits, 4 fall in that band (0.2%), none between 01:00 and 05:00.
// Capacity therefore spreads evenly across 07:00-24:00 only. Without that dead
// band the model credited unusable night hours and raised a standing "leer Sa"
// against the sliver of Saturday that precedes the reset.
//
// Fixture week: window Sat 2026-08-01 07:00 → Sat 2026-08-08 07:00.
// Capacity 12h per weekend day + 4h per weekday = 44h; 24h of it are spent by
// Monday 07:00. All expectations below are machine-verified, not hand-derived.

const NOW_ENV = "TAB_STATUSLINE_NOW_MS";
const RESET_SAT_SEC = Math.floor(new Date(2026, 7, 8, 7, 0, 0).getTime() / 1000);
const MONDAY_0700 = String(new Date(2026, 7, 3, 7, 0, 0).getTime());
const SATURDAY_1300 = String(new Date(2026, 7, 1, 13, 0, 0).getTime());

/** Builds a 7d-only statusline payload for the fixture week. */
function sevenDay(usedPct, withReset = true) {
  return {
    workspace: { current_dir: PLAIN_DIR },
    rate_limits: {
      seven_day: withReset
        ? { used_percentage: usedPct, resets_at: RESET_SAT_SEC }
        : { used_percentage: usedPct },
    },
  };
}

const capacityCases = [
  {
    name: "budget lasting past the reset raises no alarm and stays green",
    // 40% by Monday projects to 81% at reset — on plan.
    now: MONDAY_0700,
    input: sevenDay(40),
    expect: (out) => out.includes("\x1b[32m7d 40%") && !out.includes("(leer"),
  },
  {
    name: "running dry only in the pre-reset night raises no alarm",
    // 51% projects to 94%. The sliver of Saturday before the reset carries no
    // capacity, so a budget that survives Friday survives the window — the
    // segment must not cry "leer Sa" over hours that are slept or worked away.
    now: MONDAY_0700,
    input: sevenDay(51),
    expect: (out) => out.includes("\x1b[32m7d 51%") && !out.includes("(leer"),
  },
  {
    name: "mild overshoot renders the run-dry day in yellow",
    // 58% projects to 106% — dry Friday midday, with ~2.6 available hours
    // still ahead. That clears the landing tolerance, so it is a genuine
    // early run-dry and the mildest one that still deserves saying so.
    // (This case used to sit at 56%. That projects to 103% and runs dry with
    // barely an hour of usable time left — a landing under the tolerance
    // introduced with MIN_DRY_LEAD_HOURS, so the fixture was re-derived rather
    // than the expectation loosened.)
    now: MONDAY_0700,
    input: sevenDay(58),
    expect: (out) => out.includes("\x1b[33m7d 58% (leer Fr)"),
  },
  {
    name: "clear overshoot renders the run-dry day in orange",
    // 65% projects to 119% — dry Thursday.
    now: MONDAY_0700,
    input: sevenDay(65),
    expect: (out) => out.includes("\x1b[38;5;208m7d 65% (leer Do)"),
  },
  {
    name: "run-dry landing on a band edge stays on the day it consumed",
    // 75% runs out exactly at the end of Tuesday's active hours. That instant
    // is Wednesday 00:00 on the clock, but the day that ran out is Tuesday.
    now: MONDAY_0700,
    input: sevenDay(75),
    expect: (out) => out.includes("\x1b[31m7d 75% (leer Di)"),
  },
  {
    name: "run-dry on the current day reads as today",
    now: MONDAY_0700,
    input: sevenDay(96),
    expect: (out) => out.includes("\x1b[31m7d 96% (leer heute)"),
  },
  {
    name: "too early in the window: no projection, no alarm",
    // Saturday 13:00 has burned 3 of 44 capacity hours — extrapolating from
    // that would be fiction, so the segment falls back to absolute thresholds.
    now: SATURDAY_1300,
    input: sevenDay(5),
    expect: (out) => out.includes("7d 5%") && !out.includes("(leer"),
  },
  {
    name: "missing resets_at still renders the segment, without an alarm",
    now: MONDAY_0700,
    input: sevenDay(88, false),
    expect: (out) => out.includes("7d 88%") && !out.includes("(leer"),
  },
];

for (const c of capacityCases) {
  const { status, stdout } = run(c.input, { [NOW_ENV]: c.now });
  if (status !== 0 || !c.expect(stdout)) {
    failed++;
    console.error(
      `  ✖ ${c.name} — exit ${status}, stdout: ${JSON.stringify(stdout.slice(0, 200))}`,
    );
  }
}

// ── Landing tolerance: a fully spent budget is the goal, not the failure ───
// Two bugs lived in the same expression. `usedPct >= 95` forced red regardless
// of the projection — 96% two hours before the reset is the perfect landing and
// was reported as a failure, which is exactly the wall-clock thinking the
// capacity curve exists to replace. And the alarm fired on ANY run-dry before
// the reset, including one 90 minutes early.
//
// The tolerance is MIN_DRY_LEAD_HOURS, counted in AVAILABLE hours: below that
// much capacity left after running dry, it is a landing, not an alarm.
//
// These fixtures are derived from the module, not guessed. Each case first
// asserts WHICH SIDE of the tolerance it exercises, so re-tuning
// MIN_DRY_LEAD_HOURS fails loudly here ("this fixture no longer tests what it
// claims") instead of silently asserting the wrong branch.

const capacity = require("./lib/statusline-capacity.cjs");

const FRIDAY_2000 = String(new Date(2026, 7, 7, 20, 0, 0).getTime());

/**
 * Available hours left between running dry and the reset, for a given fixture.
 *
 * @param {number} nowMs - Pinned "now", epoch ms.
 * @param {number} usedPct - Consumed share of the window, 0-100.
 * @returns {number|null} Remaining available hours, or null when the budget
 *   outlasts the window (no run-dry at all).
 */
function leadHours(nowMs, usedPct) {
  const endMs = RESET_SAT_SEC * 1000;
  const startMs = endMs - capacity.SEVEN_DAY_MS;
  const elapsedCap = capacity.capacityHours(startMs, Math.min(nowMs, endMs));
  const burnPerHour = usedPct / elapsedCap;
  const dryAt = capacity.capacityDeadline(nowMs, (100 - usedPct) / burnPerHour, endMs);
  return dryAt == null ? null : capacity.capacityHours(dryAt, endMs);
}

const toleranceCases = [
  {
    name: "spent budget landing on the reset is green, not red",
    // Friday evening at 96%: projects to 98% and never runs dry. The old 95%
    // floor called this a failure.
    now: FRIDAY_2000,
    used: 96,
    lead: null,
    expect: (out) => out.includes("\x1b[32m7d 96%") && !out.includes("(leer"),
  },
  {
    name: "run-dry inside the tolerance raises no alarm",
    // Monday at 57%: dry Friday afternoon with ~1.9 available hours to spare.
    now: MONDAY_0700,
    used: 57,
    side: "below",
    expect: (out) => out.includes("\x1b[32m7d 57%") && !out.includes("(leer"),
  },
  {
    name: "run-dry beyond the tolerance still raises the alarm",
    // Monday at 62%: dry Thursday with ~5.3 available hours to spare — a real
    // early run-dry. Guards against the suppression swallowing everything.
    // Deliberately not 60%, which projects to exactly 110 and would sit on the
    // orange/yellow band edge, where float noise decides the colour.
    now: MONDAY_0700,
    used: 62,
    side: "above",
    expect: (out) => out.includes("7d 62% (leer Do)"),
  },
];

for (const c of toleranceCases) {
  const lead = leadHours(Number(c.now), c.used);
  // Precondition: does this fixture still exercise the side it claims?
  const sideOk =
    c.side === "below"
      ? lead < capacity.MIN_DRY_LEAD_HOURS
      : c.side === "above"
        ? lead > capacity.MIN_DRY_LEAD_HOURS
        : lead === null;
  if (!sideOk) {
    failed++;
    console.error(
      `  ✖ ${c.name} — fixture no longer exercises the "${c.side ?? "no run-dry"}" side: ` +
        `lead=${lead} vs MIN_DRY_LEAD_HOURS=${capacity.MIN_DRY_LEAD_HOURS}. Re-derive the used%.`,
    );
    continue;
  }
  const { status, stdout } = run(sevenDay(c.used), { [NOW_ENV]: c.now });
  if (status !== 0 || !c.expect(stdout)) {
    failed++;
    console.error(
      `  ✖ ${c.name} — exit ${status}, stdout: ${JSON.stringify(stdout.slice(0, 200))}`,
    );
  }
}

// ── Colour band and alarm are ONE line, by construction ────────────────────
// The yellow threshold is DERIVED from MIN_DRY_LEAD_HOURS rather than set:
// a budget running dry with exactly that many hours to spare projects to
// totalCap / (totalCap - MIN_DRY_LEAD_HOURS) of the window, so the two
// statements are algebraically the same line. Asserting the invariant instead
// of two hardcoded numbers is what keeps them from drifting apart.
//
// The curve is halved to prove it: halving every day leaves the projection
// untouched (both elapsed and total capacity scale), but moves the tolerance
// in relative terms — so a fixture that is yellow-with-alarm under the real
// curve must be green-without-alarm under the halved one. Anything else means
// a "yellow but no alarm" band has opened up.

const HALF_CURVE = capacity.CAPACITY_HOURS.map((h) => h / 2);
// 58 and 59 are load-bearing, not filler: they project to ~106-108, the only
// band where a HARDCODED 105 ceiling would survive the real curve and still
// open a "yellow but no alarm" gap under the halved one. 60 projects to exactly
// 110 and sits on the boundary, where a wrong ceiling passes by luck.
const bandProbes = [50, 55, 57, 58, 59, 60, 65, 80, 96];

for (const curve of [capacity.CAPACITY_HOURS, HALF_CURVE]) {
  const label = curve === HALF_CURVE ? "halved curve" : "real curve";
  for (const used of bandProbes) {
    const info = capacity.capacityInfo(used, RESET_SAT_SEC, Number(MONDAY_0700), curve);
    if (info == null) continue;
    const isGreen = info.color === "32";
    const hasAlarm = info.dryAtMs != null;
    if (isGreen === hasAlarm) {
      failed++;
      console.error(
        `  ✖ colour/alarm invariant broken (${label}, used=${used}%): ` +
          `color=${info.color} alarm=${hasAlarm} — green must mean no alarm and vice versa`,
      );
    }
  }
}

// ── Per-session state: one file per session, git block cached ─────────────
// Both properties come from the same artefact, so they are asserted together.
//
// Session isolation: the start timestamp used to live in ONE file holding ONE
// session_id, so two concurrent Claude Code instances overwrote each other and
// both durations jumped back to 0. atomicWriteSync protects against torn bytes,
// not against a logically wrong overwrite — the fix is keying by session, which
// is also what the official statusline guidance prescribes.
//
// Git caching: `git rev-parse` + `git status --porcelain` measured 46ms + 107ms
// in this repo, at up to ~3 ticks per second, and a still-running script is
// killed when the next tick fires — which is what made the line vanish now and
// then. The block is reused for GIT_CACHE_TTL_MS unless the directory changed.

const CACHE_ENV = "TAB_STATUSLINE_CACHE_DIR";
const REPO_DIR = path.resolve(__dirname, "..", "..");
const T0 = new Date(2026, 7, 3, 12, 0, 0).getTime();

/** Fresh temp cache dir, so tests never touch the real ~/.claude/cache. */
function tmpCacheDir(name) {
  const dir = path.join(os.tmpdir(), `tab-statusline-test-${name}-${process.pid}`);
  fs.rmSync(dir, { force: true, recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Runs the hook with a pinned clock and cache dir. */
function runSession(sessionId, dir, cacheDir, nowMs, extra = {}) {
  return run(
    { session_id: sessionId, workspace: { current_dir: dir }, ...extra },
    { [CACHE_ENV]: cacheDir, [NOW_ENV]: String(nowMs) },
  );
}

/**
 * Patches a session's cache record in place.
 *
 * Returns false instead of throwing when the hook wrote no record at all —
 * a regression there must surface as a named failing case, not as a stack
 * trace that takes the rest of the suite with it.
 *
 * @param {string} file - Absolute path of the session record.
 * @param {object} patch - Fields to merge into the stored record.
 * @returns {boolean} Whether the record existed and was patched.
 */
function seedRecord(file, patch) {
  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return false;
  }
  fs.writeFileSync(file, JSON.stringify({ ...record, ...patch }));
  return true;
}

let stateFailed = 0;

// 1) A parallel session must not reset another session's duration.
{
  const cacheDir = tmpCacheDir("isolation");
  runSession("session-a", PLAIN_DIR, cacheDir, T0);
  runSession("session-b", PLAIN_DIR, cacheDir, T0);
  const { stdout } = runSession("session-a", PLAIN_DIR, cacheDir, T0 + 50 * 60 * 1000);
  if (!stdout.includes("50m")) {
    stateFailed++;
    console.error(
      `  ✖ a parallel session resets the first session's duration — expected "50m", got ${JSON.stringify(stdout.slice(0, 200))}`,
    );
  }
}

// 2) A fresh cached git block is used verbatim (no git call at all).
{
  const cacheDir = tmpCacheDir("githit");
  runSession("session-c", REPO_DIR, cacheDir, T0);
  const file = path.join(cacheDir, "tab-statusline-session-c.json");
  const seeded = seedRecord(file, { git: { branch: "fixture-only-branch", count: 7 }, gitAt: T0 });
  const { stdout } = seeded
    ? runSession("session-c", REPO_DIR, cacheDir, T0 + 1000)
    : { stdout: "" };
  if (!seeded || !stdout.includes("fixture-only-branch") || !stdout.includes("7 changes")) {
    stateFailed++;
    console.error(
      seeded
        ? `  ✖ fresh cache entry was not reused — got ${JSON.stringify(stdout.slice(0, 260))}`
        : "  ✖ fresh cache entry was not reused — the hook wrote no session record at all",
    );
  }
}

// 3) An expired entry is refreshed from git.
{
  const cacheDir = tmpCacheDir("gitexpired");
  runSession("session-d", REPO_DIR, cacheDir, T0);
  const file = path.join(cacheDir, "tab-statusline-session-d.json");
  const seeded = seedRecord(file, {
    git: { branch: "stale-branch", count: 0 },
    gitAt: T0 - 60_000,
  });
  const { stdout } = seeded ? runSession("session-d", REPO_DIR, cacheDir, T0) : { stdout: "" };
  if (!seeded || stdout.includes("stale-branch")) {
    stateFailed++;
    console.error(
      `  ✖ expired cache entry was reused — got ${JSON.stringify(stdout.slice(0, 260))}`,
    );
  }
}

// 4) A directory change invalidates the block even inside the TTL — the cached
//    branch belongs to the directory it was read in, not to the session.
{
  const cacheDir = tmpCacheDir("gitdir");
  runSession("session-e", REPO_DIR, cacheDir, T0);
  const file = path.join(cacheDir, "tab-statusline-session-e.json");
  const seeded = seedRecord(file, {
    dir: path.join(REPO_DIR, "packages"),
    git: { branch: "other-dir-branch", count: 3 },
    gitAt: T0,
  });
  const { stdout } = seeded
    ? runSession("session-e", REPO_DIR, cacheDir, T0 + 1000)
    : { stdout: "" };
  if (!seeded || stdout.includes("other-dir-branch")) {
    stateFailed++;
    console.error(
      `  ✖ cache entry from another directory was reused — got ${JSON.stringify(stdout.slice(0, 260))}`,
    );
  }
}

// 5) The sweep judges a record by its OWN timestamp, not by the file's mtime.
//    Regression: those are two different clocks. The first version compared the
//    hook's `now` against the filesystem mtime, so a skew between them made the
//    once-per-session sweep delete records of sessions that were still running
//    — the duration then silently restarted at zero, which is the very bug the
//    per-session file was introduced to fix.
{
  const cacheDir = tmpCacheDir("prune");
  const live = path.join(cacheDir, "tab-statusline-live-session.json");
  const dead = path.join(cacheDir, "tab-statusline-dead-session.json");
  const DAY = 24 * 60 * 60 * 1000;
  fs.writeFileSync(live, JSON.stringify({ gitAt: T0, start: T0 - 60_000 }));
  fs.writeFileSync(dead, JSON.stringify({ gitAt: T0 - 3 * DAY, start: T0 - 3 * DAY }));
  // Both files carry an mtime of "right now", which is ~2 days BEFORE the
  // pinned T0 — an mtime-based sweep would wrongly reap the live record and
  // wrongly spare the dead one, so the two assertions below pin both directions.
  const ancient = new Date(T0 - 30 * DAY);
  fs.utimesSync(live, ancient, ancient);

  runSession("new-session", PLAIN_DIR, cacheDir, T0);

  if (!fs.existsSync(live)) {
    stateFailed++;
    console.error(
      "  ✖ the sweep deleted a live session record (judged by file mtime, not by its own timestamp)",
    );
  }
  if (fs.existsSync(dead)) {
    stateFailed++;
    console.error("  ✖ the sweep kept a long-dead session record");
  }
}

// ── Width budget: fit line 1 to the terminal, shorten from the middle ──────
// The length cap used to sit on the branch alone (35 chars), but the thing that
// overflows is line 1 AS A WHOLE — clock, model, directory, PR and changes all
// add up.
// Overflowing makes the multi-line renderer drop line 2, which is where every
// resource number lives.
//
// The real width arrives in the COLUMNS env var; Claude Code captures stdout,
// so `process.stdout.columns` is undefined inside a statusline script and
// `tput cols` reads nothing. With no usable COLUMNS the old behaviour stands —
// no regress on an older CLI or in an odd environment.
//
// Shortening takes from the MIDDLE: `refactor/…/improve-dep-graph` keeps both
// the kind of work and the subject, while a trailing cut leaves
// `refactor/design-system--improve-de…`, which is the least informative half.

const COLUMNS_ENV = "COLUMNS";
const LONG_BRANCH_REPO = REPO_DIR;

/**
 * Strips the ANSI colour codes so a line can be measured or matched by what it
 * actually renders. Written once and shared: a second copy of this pattern that
 * omits the leading escape byte reads one column too many per colour code — and
 * a test carrying the same slip as the code under test agrees with it instead
 * of catching it.
 *
 * @param {string} line - Line possibly carrying ANSI colour codes.
 * @returns {string} The line as it appears on screen.
 */
function stripAnsi(line) {
  // eslint-disable-next-line no-control-regex -- measuring rendered width means removing exactly these
  return line.replaceAll(/\[[0-9;]*m/g, "");
}

/** Rendered width of a line, colour codes excluded. */
function visibleLen(line) {
  return stripAnsi(line).length;
}

let widthFailed = 0;

// 1) A narrow terminal must not push line 1 past the budget.
{
  const cacheDir = tmpCacheDir("width");
  const { stdout } = run(
    {
      model: { display_name: "Opus 5" },
      pr: { number: 1234, review_state: "approved" },
      session_id: "width-session",
      workspace: { current_dir: LONG_BRANCH_REPO },
    },
    { [CACHE_ENV]: cacheDir, [COLUMNS_ENV]: "60", [NOW_ENV]: String(T0) },
  );
  const line1 = stdout.split("\n")[0] ?? "";
  if (visibleLen(line1) > 60) {
    widthFailed++;
    console.error(
      `  ✖ line 1 exceeds the terminal width — ${visibleLen(line1)} visible columns in a 60-column terminal: ${JSON.stringify(line1)}`,
    );
  }
}

// 2) When the branch is shortened, the cut is in the middle — the tail carries
//    the subject and must survive.
{
  const cacheDir = tmpCacheDir("middle");
  const { stdout } = run(
    { session_id: "middle-session", workspace: { current_dir: LONG_BRANCH_REPO } },
    { [CACHE_ENV]: cacheDir, [COLUMNS_ENV]: "70", [NOW_ENV]: String(T0) },
  );
  const branch = execSync("git rev-parse --abbrev-ref HEAD", {
    cwd: REPO_DIR,
    encoding: "utf8",
  }).trim();
  if (stdout.includes("…")) {
    const tail = branch.slice(-6);
    if (!stdout.includes(tail)) {
      widthFailed++;
      console.error(
        `  ✖ branch was cut from the end, not the middle — expected the tail ${JSON.stringify(tail)} to survive: ${JSON.stringify(stdout.split("\n")[0])}`,
      );
    }
  } else if (branch.length > 35) {
    widthFailed++;
    console.error("  ✖ a long branch was not shortened at all in a 70-column terminal");
  }
}

// 3) Without COLUMNS the branch falls back to the fixed 35-char cap — the same
//    width the hook used before the budget existed, so an older CLI or an odd
//    environment sees no regress in LENGTH.
//
//    The middle elision applies here too. The no-regress promise is about the
//    budget, not about preserving the worse cut: a trailing ellipsis keeps only
//    the half every sibling branch shares.
{
  const cacheDir = tmpCacheDir("nocolumns");
  const { stdout } = run(
    { session_id: "nocol-session", workspace: { current_dir: LONG_BRANCH_REPO } },
    { [CACHE_ENV]: cacheDir, [COLUMNS_ENV]: "", [NOW_ENV]: String(T0) },
  );
  const branch = execSync("git rev-parse --abbrev-ref HEAD", {
    cwd: REPO_DIR,
    encoding: "utf8",
  }).trim();
  const line1 = stdout.split("\n")[0] ?? "";
  const shown = /⎇ (\S+)/.exec(stripAnsi(line1))?.[1] ?? "";
  const capOk = branch.length > 35 ? shown.length === 35 && shown.includes("…") : shown === branch;
  const tailOk = branch.length <= 35 || shown.endsWith(branch.slice(-6));
  if (!capOk || !tailOk) {
    widthFailed++;
    console.error(
      `  ✖ without COLUMNS the branch must be middle-elided at 35 chars — got ${JSON.stringify(shown)} (${shown.length} chars) for ${JSON.stringify(branch)}`,
    );
  }
}

// ── The active band is clock hours, not a millisecond offset ──────────────
// The band used to be built as "local midnight plus 7 hours" in milliseconds,
// which silently assumes every day is 24 hours long. On the two DST days a year
// it is 23 or 25, so the band slid by an hour and a full day of availability
// measured 11.29 instead of 12 — a 6% error, twice a year, in the reference
// line the whole 7d segment is graded against.
//
// The invariant: a day's ENTIRE active band always yields exactly that day's
// capacity, whatever the clock did in between.

const dstCases = [
  { day: [2026, 9, 25], name: "autumn DST day (25 hours long)" },
  { day: [2026, 2, 29], name: "spring DST day (23 hours long)" },
  { day: [2026, 9, 18], name: "ordinary Sunday (control)" },
];

let dstFailed = 0;
for (const c of dstCases) {
  const [y, m, d] = c.day;
  const bandStart = new Date(y, m, d, capacity.ACTIVE_FROM_HOUR).getTime();
  const nextMidnight = new Date(y, m, d + 1).getTime();
  const expected = capacity.CAPACITY_HOURS[new Date(y, m, d).getDay()];
  const actual = capacity.capacityHours(bandStart, nextMidnight);
  if (Math.abs(actual - expected) > 1e-6) {
    dstFailed++;
    console.error(
      `  ✖ ${c.name} — the full active band must yield ${expected} available hours, got ${actual.toFixed(4)}`,
    );
  }
}

// ── Line 1 opens with the wall clock ──────────────────────────────────────
// The segment replaced the SEC version marker of the retired ingenium install.
// It renders from the same NOW_MS the rate-limit maths uses, so the test pins
// the contract (local HH:MM, zero-padded, first thing on line 1) against a
// clock it controls instead of against the wall.

const clockCases = [
  {
    name: "morning clock is zero-padded",
    now: new Date(2026, 7, 29, 7, 5, 0).getTime(),
    expected: "07:05",
  },
  {
    name: "afternoon clock renders 24h",
    now: new Date(2026, 7, 29, 14, 42, 30).getTime(),
    expected: "14:42",
  },
];

let clockFailed = 0;
for (const c of clockCases) {
  const cacheDir = tmpCacheDir(`clock-${c.expected.replace(":", "")}`);
  const { stdout } = run(
    { workspace: { current_dir: PLAIN_DIR } },
    { [CACHE_ENV]: cacheDir, [NOW_ENV]: String(c.now) },
  );
  const line1 = stripAnsi(stdout.split("\n")[0] ?? "");
  if (!line1.startsWith(c.expected + " ")) {
    clockFailed++;
    console.error(
      `  ✖ ${c.name} — expected line 1 to open with ${JSON.stringify(c.expected)}, got ${JSON.stringify(line1)}`,
    );
  }
}

failed += stateFailed + widthFailed + dstFailed + clockFailed;

const totalCases =
  cases.length +
  prCases.length +
  modelCases.length +
  rateCases.length +
  capacityCases.length +
  toleranceCases.length +
  bandProbes.length * 2 +
  6 +
  3 +
  dstCases.length +
  clockCases.length;
if (failed > 0) {
  console.error(`[statusline.test] ${failed}/${totalCases} FAILED`);
  process.exit(1);
}
console.log(`[statusline.test] ${totalCases}/${totalCases} cases passed.`);
