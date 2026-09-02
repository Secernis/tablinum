import { Search1 } from "@tailgrids/icons";
import { useState } from "react";

import { Card, CardContent, CardHeader } from "@/components/tailgrids/core/card";
import { Input } from "@/components/tailgrids/core/input";
import { Skeleton } from "@/components/tailgrids/core/skeleton";
import { matchesQuery, type LocatedRepository } from "@/domain/repository";
import Logo from "@/lib/brand/Logo";
import { Notice } from "@/ui/shared/Notice";
import { formatRelative } from "@/ui/shared/format-time";

import { RepoMeta } from "./RepoMeta";
import { BranchBadge, RepoRow } from "./RepoRow";

/** Everything the start page renders, handed in by the use cases. */
export interface RepoPickerProps {
  /** The remembered repositories, described; newest commit first. */
  repositories: LocatedRepository[];
  status: "idle" | "loading" | "ready";
  onRemove(path: string): void;

  /** The path currently being opened, or null. */
  opening: string | null;
  onOpen(path: string): void;

  error: string | null;
}

/** Above this many rows the list gets a filter. */
const FILTER_FROM = 6;

/**
 * The start page: one list of the repositories the user pointed the app at.
 *
 * The two ways of adding to it — "Add folder…" and "Open folder…" — sit in the
 * title bar (see `PickerActions`). This is the list itself, every row
 * removable, with a filter once it is long enough to need one. Presentational
 * only.
 */
export function RepoPicker({ repositories, status, onRemove, opening, onOpen, error }: RepoPickerProps) {
  const [query, setQuery] = useState("");
  const visible = repositories.filter((r) => matchesQuery(r, query));
  const empty = repositories.length === 0 && status === "ready";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {error && <Notice tone="error">{error}</Notice>}

      {empty ? (
        <FirstRun />
      ) : (
        <Card className="glass elev-2 rounded-2xl">
          {repositories.length >= FILTER_FROM && (
            <CardHeader>
              <div className="relative">
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Filter ${repositories.length} repositories`}
                  aria-label="Filter repositories"
                  className="h-10 w-full pl-10 text-sm"
                />
                <Search1 className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted" />
              </div>
            </CardHeader>
          )}
          <CardContent className="px-0 pb-0">
            {repositories.length === 0 ? (
              <SkeletonRows />
            ) : visible.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">Nothing matches the filter.</p>
            ) : (
              <ul className="divide-y divide-ink/8">
                {visible.map((r) => (
                  <RepoRow
                    key={r.path}
                    name={r.name}
                    path={r.path}
                    detail={r.headSubject ?? "No commits yet"}
                    badge={<BranchBadge branch={r.branch} />}
                    meta={<RepoMeta repository={r} />}
                    aside={opening === r.path ? "Opening…" : r.headAt !== null ? formatRelative(r.headAt) : undefined}
                    disabled={opening !== null}
                    onOpen={() => onOpen(r.path)}
                    onRemove={() => onRemove(r.path)}
                    removeLabel={`Remove ${r.name} from the list`}
                  />
                ))}
                {status === "loading" && <SkeletonRows count={2} />}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * What a first-time user sees: the mark, one sentence, and where the two
 * actions are. No buttons of its own — the title bar already has them, and a
 * view carries exactly one filled button.
 */
function FirstRun() {
  return (
    <Card className="glass elev-2 rounded-2xl">
      <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
        <Logo variant="mark" size={56} />
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-xl text-ink">Read a Git history</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Add a folder and every repository inside it lands on this list, or open a single repository from its
            folder. What you add stays here. Nothing is ever written to a repository.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/** Rows the shape of a result, for the moment before the first one arrives. */
function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <ul aria-label="Loading" className="divide-y divide-ink/8">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex items-start gap-3 px-4 py-3">
          <Skeleton className="mt-0.5 size-5 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
          <Skeleton className="h-3 w-16" />
        </li>
      ))}
    </ul>
  );
}
