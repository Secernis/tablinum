import type { ReactNode } from "react";

import { cn } from "@/utils/cn";

export interface ShareRow {
  key: string;
  label: ReactNode;
  /** Right-aligned, in the mono face. */
  value: string;
  /** 0–1 of the whole; the bar's width. */
  fraction: number;
  /** A CSS background for the bar; the accent when omitted. */
  fill?: string;
  /** Hover text on the row. */
  title?: string;
  muted?: boolean;
}

/**
 * Rows of label, thin bar and figure: the shape every "share of the whole"
 * list in the app takes — authors by commits, languages by lines.
 *
 * The bar carries proportion, the figure carries the number, the label the
 * identity; colour is never the only cue. Track and fill follow the material
 * rules — an `ink` mix for the track, so it sits on glass without a patch.
 */
export function ShareList({ rows }: { rows: ShareRow[] }) {
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-3" title={r.title}>
          <span className={cn("w-36 shrink-0 truncate text-sm", r.muted ? "text-muted" : "text-ink")}>{r.label}</span>
          <span className="h-2 min-w-6 flex-1 overflow-hidden rounded-full bg-ink/10">
            <span
              className="block h-2 min-w-1 rounded-full bg-accent transition-[width] duration-300 ease-out"
              style={{ width: `${Math.max(r.fraction * 100, 1)}%`, background: r.fill }}
            />
          </span>
          <span className="tabular w-20 shrink-0 text-right text-xs text-muted">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}
