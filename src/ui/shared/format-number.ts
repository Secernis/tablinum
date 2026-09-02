import { UI_LOCALE } from "./locale";

const integer = new Intl.NumberFormat(UI_LOCALE, { maximumFractionDigits: 0 });

/** "3,366" — grouped, no fraction, in the interface locale. */
export function formatInteger(value: number): string {
  return integer.format(value);
}
