/**
 * The mark. Brings its own clear space and minimum size.
 *
 * That is deliberate: a utility class can be forgotten, a component cannot.
 * Whoever writes <Logo /> gets the clear space automatically — and a warning
 * when the size drops below the measured limit.
 *
 * The values come from design/tokens/brand.lock.json via src/brand.css
 * (--tb-clearspace, --tb-min-mark, --tb-min-lockup). Nothing is duplicated
 * here; changing the rule means changing the lock.
 */
import mark from "./mark.svg?raw";
import markFlat from "./mark-flat.svg?raw";
import lockupH from "./lockup-horizontal.svg?raw";
import lockupV from "./lockup-vertical.svg?raw";
import markLight from "./mark-light.svg?raw";
import lockupHLight from "./lockup-horizontal-light.svg?raw";
import lockupVLight from "./lockup-vertical-light.svg?raw";
import "./logo.css";
import { logWarn } from "../log";

type Variant = "mark" | "lockup-horizontal" | "lockup-vertical";

interface LogoProps {
  variant?: Variant;
  /** Edge length of the mark, or width of the lockup, in px. */
  size?: number;
  /** Render the clear space. Only switch off when the layout provides it. */
  clearspace?: boolean;
  /** Below 100 px use the flat variant — same rule as in the generator. */
  flat?: boolean;
  label?: string;
  className?: string;
}

// These fallbacks only apply when brand.css is missing — normally the CSS
// variables from the generated theme win.
const MIN = { mark: 24, lockup: 200 };
const FLAT_BELOW = 100;

export default function Logo({
  variant = "mark",
  size = 32,
  clearspace = true,
  flat,
  label = "Tablinum",
  className = "",
}: LogoProps) {
  const isLockup = variant !== "mark";
  const useFlat = flat ?? size < FLAT_BELOW;

  // The colour version sets wordmark and tagline in `ink` — and in the dark
  // theme ink IS the background (measured contrast 1.00:1). On dark ground the
  // light version belongs instead. Read from the data-theme attribute that
  // main.tsx sets.
  const dark = typeof document !== "undefined" &&
    document.documentElement.dataset.theme === "dark";

  const svg =
    variant === "lockup-horizontal"
      ? (dark ? lockupHLight : lockupH)
      : variant === "lockup-vertical"
        ? (dark ? lockupVLight : lockupV)
        : useFlat
          ? markFlat
          : dark
            ? markLight
            : mark;

  const min = isLockup ? MIN.lockup : MIN.mark;
  if (size < min) {
    logWarn("logo-below-minimum-size", { size, min, variant });
  }

  const classes = [
    "tablinum-logo",
    clearspace ? "clearspace" : "",
    isLockup ? "lockup" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={classes}
      style={{ ["--size" as string]: `${size}px` }}
      role="img"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
