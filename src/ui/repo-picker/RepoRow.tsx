import { Folder1, Xmark } from "@tailgrids/icons";
import type { ReactNode } from "react";

import { Badge } from "@/components/tailgrids/core/badge";
import { Button } from "@/components/tailgrids/core/button";

export interface RepoRowProps {
  name: string;
  path: string;
  /** Under the name: the head subject, or what stands in for it. */
  detail?: string;
  /** Right-aligned, in the mono face: a time, or "Opening…". */
  aside?: string;
  badge?: ReactNode;
  /** Below the path: the numbers and the language bar. */
  meta?: ReactNode;
  disabled?: boolean;
  onOpen(): void;
  /** When present, an ✕ that removes the row from its list. */
  onRemove?(): void;
  removeLabel?: string;
}

/**
 * One repository in a list: name and branch on the first line, the head
 * subject on the second, the path on the third, the measurements below, the
 * time on the right.
 *
 * The whole row is the button; the ✕ sits outside it so a removal cannot
 * also open. The hover surface belongs to the row, not the button, so the
 * ✕ is inside the highlight rather than floating next to it.
 */
export function RepoRow({
  name,
  path,
  detail,
  aside,
  badge,
  meta,
  disabled,
  onOpen,
  onRemove,
  removeLabel,
}: RepoRowProps) {
  return (
    <li className="flex items-start gap-2 transition-colors duration-150 ease-out first:rounded-t-2xl last:rounded-b-2xl hover:bg-ink/6">
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Folder1 className="mt-0.5 size-5 shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{name}</span>
            {badge}
          </span>
          {detail && <span className="block truncate text-sm text-muted">{detail}</span>}
          <span className="tabular block truncate text-xs text-muted">{path}</span>
          {meta && <span className="mt-2.5 block">{meta}</span>}
        </span>
        {aside && <span className="tabular shrink-0 pt-0.5 text-xs text-muted">{aside}</span>}
      </button>
      {onRemove && (
        <Button
          variant="ghost"
          iconOnly
          size="xs"
          aria-label={removeLabel ?? `Remove ${name}`}
          onPress={onRemove}
          className="mr-2 mt-2"
        >
          <Xmark />
        </Button>
      )}
    </li>
  );
}

/** The branch pill, or the detached marker. */
export function BranchBadge({ branch }: { branch: string | null }) {
  return branch ? (
    <Badge color="primary" size="sm" className="shrink-0 px-2">
      {branch}
    </Badge>
  ) : (
    <Badge color="gray" size="sm" className="shrink-0 px-2">
      detached
    </Badge>
  );
}
