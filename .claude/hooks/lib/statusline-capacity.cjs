"use strict";

/**
 * Rate-limit grading math for the statusline: the 5h pace line and the 7d
 * capacity curve.
 *
 * Why this module exists: the two windows are graded by deliberately DIFFERENT
 * models, and both models are opinionated enough to need explanation next to
 * the code rather than at the call site. Keeping them here leaves the hook
 * itself as pure assembly (read stdin, format, print) and makes the math
 * directly unit-testable instead of only reachable through a stdin round-trip.
 *
 * The models, in one line each:
 *
 *   - **5h → pace.** A short window with a real lockout at the end, so the
 *     question is "am I burning faster than the clock". Wall-clock elapsed is
 *     the correct baseline here: five hours are five hours.
 *   - **7d → capacity.** A weekly budget that is MEANT to be spent in full and
 *     to last exactly until the reset, so the only failure worth signalling is
 *     running dry EARLY. Wall-clock pacing answers that wrongly for an uneven
 *     week — it credits progress at 03:00 on a work night and demands restraint
 *     on a free Sunday morning. The baseline is therefore AVAILABLE hours.
 *
 * Everything here is pure: `nowMs` is passed in, never read from the clock, so
 * every branch is reachable from a test without touching the system time.
 */

/**
 * Available hours per weekday, indexed by `Date#getDay()` (0 = Sunday).
 *
 * This is the single knob of the 7d model — change it when the weekly rhythm
 * changes and everything downstream follows.
 *
 * Deliberately hours-per-day and NOT shift times: the account runs a rotating
 * three-shift schedule (early / late / night), so the free block moves every
 * week while its LENGTH stays put. A hardcoded shift position would be wrong
 * two weeks in three, and a wrong hour is worse than no hour — it looks like
 * knowledge.
 */
const CAPACITY_HOURS = [12, 4, 4, 4, 4, 4, 12];

/**
 * The active band the daily hours are spread across, as local clock hours.
 *
 * The band is the one clock fact that survives the shift rotation: nothing
 * happens between midnight and 07:00 — asleep on early/late weeks, at work on
 * night weeks. Measured over 1954 commits, 4 land in that band (0.2%), none
 * between 01:00 and 05:00. Spreading across all 24h instead credited unusable
 * night hours, which pushed the reference line ~5pp low and raised a standing
 * false alarm against the sliver of Saturday before the reset.
 *
 * Residual bound: early and late weeks are matched exactly; night weeks read
 * ~7pp low because the Saturday such a week ends on is slept through. That
 * errs toward warning early, which is the safe direction here.
 */
const ACTIVE_FROM_HOUR = 7;
const ACTIVE_TO_HOUR = 24;
// No nominal span constant on purpose: the band's length is measured per day
// in `activeBand`, because on a DST day it genuinely is not 17 hours.

/**
 * Below this share of the week's capacity the projection divides by a tiny
 * number and swings wildly; report nothing rather than a fiction.
 */
const MIN_PROJECTION_SHARE = 0.15;

/**
 * Available hours that must remain after the budget runs dry before that counts
 * as running dry EARLY rather than landing on target.
 *
 * Spending the whole weekly budget is the goal, so a run-dry inside the last
 * usable stretch before the reset is a landing, not a failure — announcing it
 * would make the statusline cry over its own success case.
 *
 * Counted in AVAILABLE hours, not wall-clock hours: two hours before an 07:00
 * reset are asleep and carry no capacity at all, so a wall-clock tolerance
 * would mean something different every day of the week.
 *
 * This is the single tuning knob for alarm sensitivity — raise it if the alarm
 * feels late, lower it if it fires on near-perfect weeks. The colour band
 * follows automatically (see `landingCeiling`).
 */
const MIN_DRY_LEAD_HOURS = 2;

/**
 * The projected end-of-window total that corresponds to running dry with
 * exactly `MIN_DRY_LEAD_HOURS` of capacity to spare.
 *
 * Derived rather than set, because it is the SAME tolerance as
 * `MIN_DRY_LEAD_HOURS` — only expressed in percent instead of hours. Two
 * independent numbers for one statement drift apart the moment either the
 * capacity curve or the tolerance is retuned, and the symptom would be a narrow
 * band that renders yellow while staying silent about why.
 *
 * The equivalence is exact, not approximate: a budget burning at a constant
 * rate to a projected total P runs dry with `total * (1 - 100/P)` hours left,
 * so `lead >= MIN` and `P >= total / (total - MIN) * 100` are the same line.
 *
 * @param {number} totalHours - The window's total available hours.
 * @returns {number} Projected percentage at which a landing becomes an overshoot.
 */
function landingCeiling(totalHours) {
  return (totalHours / (totalHours - MIN_DRY_LEAD_HOURS)) * 100;
}

const HOUR_MS = 60 * 60 * 1000;
const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Returns local midnight of the day containing `ms`.
 *
 * @param {number} ms - Any instant inside the wanted day, epoch ms.
 * @returns {Date} Local midnight of that day.
 */
function dayStart(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * The active band of one day, as an epoch-ms pair.
 *
 * Built from CLOCK hours rather than by adding milliseconds to midnight,
 * because "midnight plus seven hours" only equals 07:00 on days that are 24
 * hours long. On the two DST days a year it lands on 06:00 or 08:00, sliding
 * the whole band and mismeasuring a full day of availability by ~6%.
 *
 * The band's real length is returned with it, so the caller divides by what the
 * day actually offered instead of by a nominal span — which is what keeps a
 * complete band worth exactly the day's capacity, DST or not.
 *
 * @param {Date} day - Any Date positioned on the wanted local day.
 * @returns {[number, number]} Band start and end, epoch ms.
 */
function activeBand(day) {
  const [y, m, d] = [day.getFullYear(), day.getMonth(), day.getDate()];
  // Hour 24 normalises to the next day's midnight, which is exactly the intent.
  return [new Date(y, m, d, ACTIVE_FROM_HOUR).getTime(), new Date(y, m, d, ACTIVE_TO_HOUR).getTime()];
}

/**
 * Sums the available hours inside a wall-clock interval.
 *
 * @param {number} fromMs - Interval start, epoch ms.
 * @param {number} toMs - Interval end, epoch ms.
 * @param {number[]} [curve] - Hours per weekday; defaults to the real rhythm.
 *   Injectable so a test can assert that everything downstream follows the
 *   curve rather than a hardcoded assumption about it.
 * @returns {number} Available hours, 0 when the interval is empty.
 */
function capacityHours(fromMs, toMs, curve = CAPACITY_HOURS) {
  if (toMs <= fromMs) return 0;
  let total = 0;
  const cursor = dayStart(fromMs);
  for (; cursor.getTime() < toMs; cursor.setDate(cursor.getDate() + 1)) {
    const [bandLo, bandHi] = activeBand(cursor);
    const lo = Math.max(bandLo, fromMs);
    const hi = Math.min(bandHi, toMs);
    if (hi > lo) {
      total += curve[cursor.getDay()] * ((hi - lo) / (bandHi - bandLo));
    }
  }
  return total;
}

/**
 * Walks the capacity calendar forward until a given number of available hours
 * has accrued.
 *
 * @param {number} fromMs - Where to start walking, epoch ms.
 * @param {number} hoursNeeded - Available hours to consume.
 * @param {number} hardStopMs - Never walk past this instant.
 * @param {number[]} [curve] - Hours per weekday; defaults to the real rhythm.
 * @returns {number|null} Epoch ms at which the hours are used up, or null when
 *   `hardStopMs` arrives first — i.e. the budget outlasts the window.
 */
function capacityDeadline(fromMs, hoursNeeded, hardStopMs, curve = CAPACITY_HOURS) {
  if (hoursNeeded <= 0) return fromMs;
  let left = hoursNeeded;
  const cursor = dayStart(fromMs);
  for (; cursor.getTime() < hardStopMs; cursor.setDate(cursor.getDate() + 1)) {
    const [bandLo, bandHi] = activeBand(cursor);
    const lo = Math.max(bandLo, fromMs);
    const hi = Math.min(bandHi, hardStopMs);
    if (hi <= lo) continue;
    const perHour = curve[cursor.getDay()] / ((bandHi - bandLo) / HOUR_MS);
    if (perHour <= 0) continue;
    const avail = perHour * ((hi - lo) / HOUR_MS);
    if (avail >= left) {
      const at = lo + (left / perHour) * HOUR_MS;
      // Exhausting a day's last active minute lands on the following midnight;
      // the day that ran out is still the one being consumed.
      return at >= hi ? hi - 1 : at;
    }
    left -= avail;
  }
  return null;
}

/**
 * Grades the 5h window against the elapsed share of its own wall-clock span
 * ("burn-down line"). delta = used% - elapsed%; positive means ahead of pace.
 *
 *   delta < -5pp           -> green  (comfortably under line)
 *   |delta| <= 5pp         -> yellow (on pace)
 *   +5pp < delta <= +10pp  -> orange (drifting over)
 *   delta > +10pp          -> red    (over budget)
 *
 * Hard floor: used >= 95% is always red regardless of pace — this window ends
 * in a real lockout, so proximity to the ceiling matters on its own. (The 7d
 * window deliberately has NO such floor: there, a fully spent budget is the
 * goal, not the failure.)
 *
 * `overBy` is returned alongside the colour so a red segment can state HOW FAR
 * over the line it is — the bare percentage cannot distinguish "88% near the
 * window's end" (fine) from "88% at half time" (a problem). It is set only when
 * the pace branch produced the red, so the hard floor never claims an
 * explanation the pace does not support.
 *
 * @param {number} usedPct - Consumed share of the window, 0-100.
 * @param {number} resetsAtSec - Window reset, epoch seconds.
 * @param {number} windowMs - Length of the window in ms.
 * @param {number} nowMs - Current instant, epoch ms.
 * @returns {{color: string, overBy: number|null}} ANSI colour code and, for a
 *   pace-driven red, the overshoot in percentage points.
 */
function paceInfo(usedPct, resetsAtSec, windowMs, nowMs) {
  if (usedPct >= 95) return { color: "31", overBy: null };
  const nowSec = nowMs / 1000;
  const startSec = resetsAtSec - windowMs / 1000;
  const elapsedPct = Math.max(0, Math.min(100, ((nowSec - startSec) / (windowMs / 1000)) * 100));
  const delta = usedPct - elapsedPct;
  if (delta > 10) return { color: "31", overBy: delta };
  if (delta > 5) return { color: "38;5;208", overBy: null };
  if (delta >= -5) return { color: "33", overBy: null };
  return { color: "32", overBy: null };
}

/**
 * Grades the 7d window against the capacity curve.
 *
 * Colour follows the projected end-of-window total, banded around the landing
 * ceiling rather than around 100: spending the whole budget is the goal,
 * overshooting it is the failure. `dryAtMs` is set only when the budget runs
 * out EARLY — early meaning with more than `MIN_DRY_LEAD_HOURS` of usable time
 * still ahead. Running out just before the reset is a landing and stays silent.
 *
 * Deliberately NO `usedPct >= 95` floor (the 5h window has one): at 96% two
 * hours before the reset the budget has been used exactly as intended, and
 * colouring that red is the wall-clock reflex this whole model replaces.
 *
 * Colour and alarm are one statement, not two: green means "no alarm" by
 * construction, because the ceiling is derived from the same tolerance.
 *
 * @param {number} usedPct - Consumed share of the window, 0-100.
 * @param {number} resetsAtSec - Window reset, epoch seconds.
 * @param {number} nowMs - Current instant, epoch ms.
 * @param {number[]} [curve] - Hours per weekday; defaults to the real rhythm.
 * @returns {{color: string, dryAtMs: number|null}|null} Null when too little
 *   capacity has elapsed to project honestly.
 */
function capacityInfo(usedPct, resetsAtSec, nowMs, curve = CAPACITY_HOURS) {
  const endMs = resetsAtSec * 1000;
  const startMs = endMs - SEVEN_DAY_MS;
  const totalCap = capacityHours(startMs, endMs, curve);
  const elapsedCap = capacityHours(startMs, Math.min(nowMs, endMs), curve);
  if (totalCap <= 0 || elapsedCap / totalCap < MIN_PROJECTION_SHARE) return null;
  const projected = usedPct / (elapsedCap / totalCap);
  const ceiling = landingCeiling(totalCap);
  const color = projected > 125 ? "31"                    // red
    : projected > 110 ? "38;5;208"                        // orange
    : projected > ceiling ? "33"                          // yellow
    : "32";                                               // green — it lasts

  const burnPerHour = usedPct / elapsedCap;
  const rawDryAt = burnPerHour > 0
    ? capacityDeadline(nowMs, (100 - usedPct) / burnPerHour, endMs, curve)
    : null;
  // A run-dry with almost no usable time left behind it is the target, not a
  // miss — report it as no alarm at all rather than as a near miss.
  const landsOnTarget = rawDryAt != null
    && capacityHours(rawDryAt, endMs, curve) < MIN_DRY_LEAD_HOURS;
  return { color, dryAtMs: landsOnTarget ? null : rawDryAt };
}

/**
 * Absolute-threshold fallback for a window without a `resets_at` timestamp —
 * no reset instant means no pace and no projection, so grade the bare number
 * rather than invent a forecast.
 *
 * @param {number} used - Consumed share of the window, 0-100.
 * @returns {string} ANSI colour code.
 */
function rateColorAbs(used) {
  return used < 50 ? "32"
    : used < 65 ? "33"
    : used < 80 ? "38;5;208"
    : "31";
}

module.exports = {
  CAPACITY_HOURS,
  ACTIVE_FROM_HOUR,
  ACTIVE_TO_HOUR,
  MIN_DRY_LEAD_HOURS,
  MIN_PROJECTION_SHARE,
  landingCeiling,
  FIVE_HOUR_MS,
  SEVEN_DAY_MS,
  dayStart,
  capacityHours,
  capacityDeadline,
  paceInfo,
  capacityInfo,
  rateColorAbs,
};
