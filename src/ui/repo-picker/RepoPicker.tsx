import { Reload, Search1, Xmark } from "@tailgrids/icons";
import { useState } from "react";

import { Badge } from "@/components/tailgrids/core/badge";
import { Button } from "@/components/tailgrids/core/button";
import { Card, CardContent, CardHeader } from "@/components/tailgrids/core/card";
import { Input } from "@/components/tailgrids/core/input";
import { Skeleton } from "@/components/tailgrids/core/skeleton";
import { matchesQuery, type LocatedRepository } from "@/domain/repository";
import Logo from "@/lib/brand/Logo";
import { Notice } from "@/ui/shared/Notice";
import { formatRelative } from "@/ui/shared/format-time";

import { BranchBadge, RepoRow } from "./RepoRow";

/** Everything the start page renders, handed in by the use cases. */
export interface RepoPickerProps {
  /** The folders a scan covers, as the user chose them. */
  roots: string[];
  onRemoveRoot(root: string): void;
  /** Repositories added one at a time; these rows carry a remove button. */
  added: string[];
  onRemoveAdded(path: string): void;
  /** Everything remembered, described; newest commit first. */
  found: LocatedRepository[];
  scanStatus: "idle" | "scanning" | "done";
  onScan(): void;

  /** The path currently being opened, or null. */
  opening: string | null;
  onOpen(path: string): void;

  error: string | null;
}

/**
 * The start page: one list of the repositories the user pointed the app at.
 *
 * The two ways of adding to it — "Add folder…" and "Open folder…" — sit in the
 * title bar (see `PickerActions`). This is the list itself, with the folders
 * it comes from as removable chips and a filter once it is long enough to
 * need one. Presentational only.
 */
export function RepoPicker(props: RepoPickerProps) {
  const { roots, added, found, scanStatus, opening, onOpen, error } = props;
  const [query, setQuery] = useState("");
  const busy = opening !== null;
  const visible = found.filter((r) => matchesQuery(r, query));
  const nothingRemembered = roots.length === 0 && added.length === 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {error && <Notice tone="error">{error}</Notice>}

      {nothingRemembered ? (
        <FirstRun />
      ) : (
        <Card className="border border-line">
          <CardHeader className="space-y-3">
            {roots.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-widest text-muted">Folders</span>
                <ul className="flex flex-wrap gap-2" aria-label="Folders being scanned">
                  {roots.map((root) => (
                    <li key={root}>
                      <Badge color="primary" size="md" className="pl-3 pr-1" title={root}>
                        {lastSegment(root)}
                        <button
                          type="button"
                          aria-label={`Stop scanning ${root}`}
                          onClick={() => props.onRemoveRoot(root)}
                          className="rounded-full p-0.5 hover:bg-accent/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                        >
                          <Xmark className="size-3.5" />
                        </button>
                      </Badge>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="ghost"
                  size="xs"
                  onPress={props.onScan}
                  disabled={busy || scanStatus === "scanning"}
                  aria-label="Scan the folders again"
                  className="ml-auto"
                >
                  <Reload className={scanStatus === "scanning" ? "animate-spin" : undefined} />
                  {scanStatus === "scanning" ? "Scanning…" : "Rescan"}
                </Button>
              </div>
            )}
            {found.length > 5 && (
              <div className="relative">
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Filter ${found.length} repositories`}
                  aria-label="Filter repositories"
                  className="h-10 w-full pl-10 text-sm"
                />
                <Search1 className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted" />
              </div>
            )}
          </CardHeader>
          <CardContent className="px-0 pb-0 pt-3">
            <RepositoryList
              status={scanStatus}
              candidates={visible}
              totalFound={found.length}
              added={added}
              opening={opening}
              onOpen={onOpen}
              onRemoveAdded={props.onRemoveAdded}
            />
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
    <Card className="border border-line">
      <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
        <Logo variant="mark" size={56} />
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-xl text-ink">Read a Git history</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Add the folders you keep your projects in and every repository inside them appears here, or open a
            single repository from its folder. What you add stays on this list. Nothing is ever written to a
            repository.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function RepositoryList({
  status,
  candidates,
  totalFound,
  added,
  opening,
  onOpen,
  onRemoveAdded,
}: {
  status: "idle" | "scanning" | "done";
  candidates: LocatedRepository[];
  totalFound: number;
  added: string[];
  opening: string | null;
  onOpen(path: string): void;
  onRemoveAdded(path: string): void;
}) {
  if (totalFound === 0 && status === "scanning") return <SkeletonRows />;
  if (totalFound === 0) {
    return <p className="border-t border-line px-5 py-6 text-sm text-muted">No repositories in these folders.</p>;
  }
  if (candidates.length === 0) {
    return <p className="border-t border-line px-5 py-6 text-sm text-muted">Nothing matches the filter.</p>;
  }
  return (
    <ul className="border-t border-line">
      {candidates.map((r) => (
        <RepoRow
          key={r.path}
          name={r.name}
          path={r.path}
          detail={r.headSubject ?? "No commits yet"}
          badge={<BranchBadge branch={r.branch} />}
          aside={opening === r.path ? "Opening…" : r.headAt !== null ? formatRelative(r.headAt) : undefined}
          disabled={opening !== null}
          onOpen={() => onOpen(r.path)}
          onRemove={added.includes(r.path) ? () => onRemoveAdded(r.path) : undefined}
          removeLabel={`Remove ${r.name} from the list`}
        />
      ))}
      {status === "scanning" && <SkeletonRows count={2} />}
    </ul>
  );
}

/** Rows the shape of a result, for the moment before the first one arrives. */
function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <ul aria-label="Scanning" className="border-t border-line">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
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

/** `C:\Users\me\Desktop` → `Desktop`; the chip is a label, the title carries the path. */
function lastSegment(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
