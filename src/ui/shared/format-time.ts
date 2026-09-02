/**
 * Time formatting for the interface, from epoch seconds as git reports them.
 *
 * Locale comes from the runtime, not from a setting: a desktop app renders in
 * the language the machine already speaks.
 */

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const absoluteWithTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Steps in descending order; the first one the distance exceeds is used. */
const STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];

/** "3 days ago", "last month", "in 2 hours" for a clock that is slightly off. */
export function formatRelative(epochSeconds: number, nowMs = Date.now()): string {
  const delta = epochSeconds - nowMs / 1000;
  const distance = Math.abs(delta);
  for (const [unit, seconds] of STEPS) {
    if (distance >= seconds) return relative.format(Math.round(delta / seconds), unit);
  }
  return relative.format(Math.round(delta), "second");
}

/** "2 Sep 2026" in the machine's locale. */
export function formatDate(epochSeconds: number): string {
  return absolute.format(new Date(epochSeconds * 1000));
}

/** "2 Sep 2026, 16:47" in the machine's locale. */
export function formatDateTime(epochSeconds: number): string {
  return absoluteWithTime.format(new Date(epochSeconds * 1000));
}
