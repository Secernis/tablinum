/**
 * Minimal logging helper.
 *
 * It exists because Logo.tsx reaches for `logWarn` instead of writing to the
 * console directly: that keeps one place where logging can later be swapped for
 * something real without touching components. The event name is deliberately a
 * stable key rather than a sentence — otherwise nothing can be filtered by it.
 */
type Fields = Record<string, unknown>;

export function logWarn(event: string, fields: Fields = {}): void {
  console.warn(`[warn] ${event}`, fields);
}

export function logError(event: string, fields: Fields = {}): void {
  console.error(`[error] ${event}`, fields);
}
