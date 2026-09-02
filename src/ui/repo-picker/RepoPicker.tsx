import { Folder1, FolderPlus, Reload, Search1, Xmark } from "@tailgrids/icons";
import { useState } from "react";

import type { RecentRepository } from "@/application/workspace/workspace-store";
import { matchesQuery, type LocatedRepository } from "@/domain/repository";
import { Button } from "@/ui/shared/Button";
import { Notice } from "@/ui/shared/Notice";
import { formatRelative } from "@/ui/shared/format-time";
import { cn } from "@/utils/cn";

/** Everything the picker renders, handed in by the use cases. */
export interface RepoPickerProps {
  recent: RecentRepository[];
  onForgetRecent(path: string): void;

  /** The folders a scan covers, as the user chose them. */
  roots: string[];
  onAddRoots(): void;
  onRemoveRoot(root: string): void;
  found: LocatedRepository[];
  scanStatus: "idle" | "scanning" | "done";
  onScan(): void;

  /** The path currently being opened, or null. */
  opening: string | null;
  onOpen(path: string): void;
  /** Ask for a folder through the native dialog. */
  onOpenFromDialog(): void;

  error: string | null;
}

/**
 * The first screen: choose the repository to read.
 *
 * Three ways in, in the order a returning user needs them — what was open last
 * time, what the folders they chose contain, and the native folder dialog for
 * everything else. Presentational only: the data arrives through props, so
 * the screen can be rendered against any source.
 */
export function RepoPicker(props: RepoPickerProps) {
  const { recent, onForgetRecent, opening, onOpen, error } = props;
  const [query, setQuery] = useState("");
  const busy = opening !== null;

  const visible = props.found.filter((r) => matchesQuery(r, query));

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl">Open a repository</h2>
          <p className="mt-1 text-sm text-muted">Tablinum reads the history; it never writes to the repository.</p>
        </div>
        <Button variant="primary" onClick={props.onOpenFromDialog} disabled={busy}>
          <Folder1 className="size-4" />
          Open folder…
        </Button>
      </header>

      {error && <Notice tone="error">{error}</Notice>}

      {recent.length > 0 && (
        <section aria-labelledby="recent-heading">
          <h3 id="recent-heading" className="mb-3 text-xs uppercase tracking-widest text-muted">
            Recent
          </h3>
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {recent.map((r) => (
              <li key={r.path} className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => onOpen(r.path)}
                  disabled={busy}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <Folder1 className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{r.name}</span>
                    <span className="block truncate text-xs text-muted">{r.path}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {opening === r.path ? "Opening…" : formatRelative(r.openedAt / 1000)}
                  </span>
                </button>
                <IconButton label={`Forget ${r.name}`} onClick={() => onForgetRecent(r.path)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="scan-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="scan-heading" className="text-xs uppercase tracking-widest text-muted">
            In your folders
          </h3>
          <div className="flex gap-2">
            <Button onClick={props.onAddRoots} disabled={busy}>
              <FolderPlus className="size-4" />
              Add folder…
            </Button>
            {props.roots.length > 0 && (
              <Button onClick={props.onScan} disabled={busy || props.scanStatus === "scanning"}>
                <Reload className={cn("size-4", props.scanStatus === "scanning" && "animate-spin")} />
                {props.scanStatus === "scanning" ? "Scanning…" : "Rescan"}
              </Button>
            )}
          </div>
        </div>

        <RootChips roots={props.roots} onRemove={props.onRemoveRoot} />

        {props.found.length > 0 && (
          <label className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 focus-within:border-accent">
            <Search1 className="size-4 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Filter ${props.found.length} repositories`}
              className="w-full bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
            />
          </label>
        )}

        <CandidateList
          hasRoots={props.roots.length > 0}
          status={props.scanStatus}
          candidates={visible}
          totalFound={props.found.length}
          opening={opening}
          onOpen={onOpen}
        />
      </section>
    </div>
  );
}

function IconButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded p-1 text-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <Xmark className="size-4" />
    </button>
  );
}

function RootChips({ roots, onRemove }: { roots: string[]; onRemove(root: string): void }) {
  if (roots.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Folders being scanned">
      {roots.map((root) => (
        <li
          key={root}
          title={root}
          className="flex items-center gap-1 rounded-full border border-accent bg-accent-soft py-1 pl-3 pr-1 text-xs text-accent"
        >
          {lastSegment(root)}
          <IconButton label={`Stop scanning ${root}`} onClick={() => onRemove(root)} />
        </li>
      ))}
    </ul>
  );
}

function CandidateList({
  hasRoots,
  status,
  candidates,
  totalFound,
  opening,
  onOpen,
}: {
  hasRoots: boolean;
  status: "idle" | "scanning" | "done";
  candidates: LocatedRepository[];
  totalFound: number;
  opening: string | null;
  onOpen(path: string): void;
}) {
  if (!hasRoots) {
    return (
      <Notice tone="muted">
        Add the folders you keep your projects in. Tablinum lists every repository inside them, and remembers the
        folders for next time.
      </Notice>
    );
  }
  if (totalFound === 0) {
    return (
      <Notice tone="muted">
        {status === "scanning" ? "Looking for repositories…" : "No repositories in these folders."}
      </Notice>
    );
  }
  if (candidates.length === 0) {
    return <Notice tone="muted">Nothing matches the filter.</Notice>;
  }
  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
      {candidates.map((r) => (
        <li key={r.path}>
          <button
            type="button"
            onClick={() => onOpen(r.path)}
            disabled={opening !== null}
            className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
          >
            <Folder1 className="mt-0.5 size-4 shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm text-ink">{r.name}</span>
                {r.branch ? (
                  <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">{r.branch}</span>
                ) : (
                  <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-muted">detached</span>
                )}
              </span>
              <span className="block truncate text-xs text-muted">{r.headSubject ?? "No commits yet"}</span>
              <span className="block truncate text-xs text-muted">{r.path}</span>
            </span>
            <span className="tabular shrink-0 text-xs text-muted">
              {opening === r.path ? "Opening…" : r.headAt !== null ? formatRelative(r.headAt) : ""}
            </span>
          </button>
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
