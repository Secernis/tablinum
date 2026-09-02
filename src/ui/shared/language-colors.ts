import { DATA_LANGUAGES, DOCS_LANGUAGES } from "@/domain/analysis";

/**
 * Colours of the domain: a fixed hue per language, the same in every
 * repository.
 *
 * Deliberately NOT derived from the brand, like the diff colours: a language
 * bar is data, and colour follows the entity (TypeScript is always blue here),
 * never its rank in a given repository. Twelve hues, chosen to sit on the
 * warm paper and ink of the brand and validated for colour-vision separation
 * and contrast on both surfaces with the dataviz validator. Green and red are
 * left out on purpose, because in a Git client they mean added and removed.
 *
 * Twelve hues serve more than twelve languages: two languages share a hue
 * only when they rarely share a repository (Rust and Swift, C# and PHP), and
 * the legend names every segment, so a shared hue is never the only cue. A
 * language outside the table renders in the neutral tone with its label — a
 * thirteenth hue is never invented. Data formats and documentation get the
 * neutral tone with a hatch each, so they read apart from "Other".
 */

/** Light and dark variants, so the bar is re-stepped for the dark surface rather than flipped. */
interface Hue {
  light: string;
  dark: string;
}

const HUES = {
  blue: { light: "#2a78d6", dark: "#3987e5" },
  orange: { light: "#eb6834", dark: "#d95926" },
  aqua: { light: "#1baf7a", dark: "#199e70" },
  purple: { light: "#a24bbf", dark: "#bd5ad8" },
  gold: { light: "#eda100", dark: "#c98500" },
  cyan: { light: "#1797b4", dark: "#1a8fa8" },
  magenta: { light: "#e05a8a", dark: "#d9558a" },
  violet: { light: "#4a3aa7", dark: "#9085e9" },
  amber: { light: "#b8860b", dark: "#b8892a" },
  teal: { light: "#149c96", dark: "#22a3a3" },
  indigo: { light: "#5b6fe0", dark: "#6e7fe8" },
  rose: { light: "#c2185b", dark: "#e0578f" },
} satisfies Record<string, Hue>;

type HueName = keyof typeof HUES;

/** Language → hue, by identity. Pairs on one hue are ones that seldom share a repository. */
const LANGUAGE_HUES: Record<string, HueName> = {
  TypeScript: "blue",
  Dart: "blue",
  Rust: "orange",
  Swift: "orange",
  HTML: "aqua",
  Vue: "aqua",
  Svelte: "aqua",
  "C#": "purple",
  PHP: "purple",
  JavaScript: "gold",
  Shell: "cyan",
  Lua: "cyan",
  CSS: "magenta",
  Python: "violet",
  Java: "amber",
  C: "amber",
  Go: "teal",
  Haskell: "teal",
  Kotlin: "indigo",
  Scala: "indigo",
  "C++": "indigo",
  Ruby: "rose",
  Elixir: "rose",
  "Objective-C": "rose",
};

/** The neutral segment: "Other", and any language without a hue of its own. */
const NEUTRAL = "var(--t-textMuted)";

/** The data formats: the neutral tone, hatched at 45°. */
const DATA_HATCH = `repeating-linear-gradient(45deg, ${NEUTRAL} 0 2px, transparent 2px 5px)`;

/** Documentation: the neutral tone, hatched the other way. */
const DOCS_HATCH = `repeating-linear-gradient(135deg, ${NEUTRAL} 0 2px, transparent 2px 5px)`;

/**
 * The CSS `background` for a segment name, following the theme.
 *
 * A `background` rather than a colour because the hatches are gradients.
 */
export function languageBackground(name: string): string {
  if (name === DATA_LANGUAGES) return DATA_HATCH;
  if (name === DOCS_LANGUAGES) return DOCS_HATCH;
  const hueName = LANGUAGE_HUES[name];
  if (!hueName) return NEUTRAL;
  const hue = HUES[hueName];
  // light-dark() picks by `color-scheme`, which index.css sets per theme.
  return `light-dark(${hue.light}, ${hue.dark})`;
}
