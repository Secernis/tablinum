import type { LanguageSegment } from "@/domain/analysis";

import { languageBackground } from "./language-colors";
import { UI_LOCALE } from "./locale";

interface LanguageBarProps {
  segments: LanguageSegment[];
}

const percent = new Intl.NumberFormat(UI_LOCALE, { style: "percent", maximumFractionDigits: 0 });

/**
 * A thin stacked bar of the languages in a repository, with its legend.
 *
 * Marks per the dataviz rules: a 2 px surface gap between segments, rounded
 * ends, colour by entity; the legend names every segment in text tokens with
 * a swatch carrying the colour, so identity never rests on colour alone.
 */
export function LanguageBar({ segments }: LanguageBarProps) {
  if (segments.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={describe(segments)}>
        {segments.map((s) => (
          <span
            key={s.name}
            title={`${s.name} ${percent.format(s.fraction)}`}
            style={{ width: `${Math.max(s.fraction * 100, 1)}%`, background: languageBackground(s.name) }}
            className="rounded-full"
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
        {segments.map((s) => (
          <li key={s.name} className="flex items-center gap-1.5">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: languageBackground(s.name) }}
              aria-hidden
            />
            <span>{s.name}</span>
            <span className="tabular">{percent.format(s.fraction)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function describe(segments: LanguageSegment[]): string {
  return segments.map((s) => `${s.name} ${percent.format(s.fraction)}`).join(", ");
}
