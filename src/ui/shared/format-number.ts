import { UI_LOCALE } from "./locale";

const integer = new Intl.NumberFormat(UI_LOCALE, { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat(UI_LOCALE, { notation: "compact", maximumFractionDigits: 1 });

/** "3,366" — grouped, no fraction, in the interface locale. */
export function formatInteger(value: number): string {
  return integer.format(value);
}

/** "48.2K", "1.2M" — for a number that is read at a glance, not compared. */
export function formatCompact(value: number): string {
  return compact.format(value);
}
