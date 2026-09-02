import { Folder1, Reload, Search1, Xmark } from "@tailgrids/icons";
import { useState, type FormEvent } from "react";

import type { RecentRepository } from "@/application/workspace/recent-repositories-store";
import { matchesQuery, type LocatedRepository } from "@/domain/repository";
import { Button } from "@/ui/shared/Button";
import { Notice } from "@/ui/shared/Notice";
import { formatRelative } from "@/ui/shared/format-time";
import { cn } from "@/utils/cn";

/** Everything the picker renders, handed in by the use cases. */
export interface RepoPickerProps {
  recent: RecentRepository[];
  onForgetRecent(path: string): void;

  roots: string[];
  selectedRoots: string[];
  onToggleRoot(root: string): void;
  found: LocatedRepository[];
  scanStatus: "idle" | "scanning" | "done";
  onScan(): void;

  /** The path currently being opened, or null. */
  opening: string | null;
  onOpen(path: string): void;

  error: string | null;
}

/**
 * The first screen: choose the repository to read.
 *
 * Three ways in, in the order a returning user needs them — what was open last
 * time, what a scan of the usual folders finds, and a path typed by hand for
 * everything else. Presentational only: the data arrives through props, so the
 * screen can be rendered against any source.
 */
export function RepoPicker(props: RepoPickerProps) {
  const { recent, onForgetRecent, opening, onOpen, error } = props;
  const [query, setQuery] = useState("");
  const [manualPath, setManualPath] = useState("");

  const visible = props.found.filter((r) => matchesQuery(r, query));

  function submitManual(event: FormEvent) {
    event.preventDefault();
    const path = manualPath.trim();
    if (path) onOpen(path);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header>
        <h2 className="font-[family-name:var(--font-display)] text-2xl">Open a repository</h2>
        <p className="mt-1 text-sm text-muted">Tablinum reads the history; it never writes to the repository.</p>
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
                  disabled={opening !== null}
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
                <button
                  type="button"
                  aria-label={`Forget ${r.name}`}
                  onClick={() => onForgetRecent(r.path)}
                  className="rounded p-1 text-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <Xmark className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="scan-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="scan-heading" className="text-xs uppercase tracking-widest text-muted">
            On this machine
          </h3>
          <Button
            variant="primary"
            onClick={props.onScan}
            disabled={props.scanStatus === "scanning" || props.selectedRoots.length === 0}
          >
            <Reload className={cn("size-4", props.scanStatus === "scanning" && "animate-spin")} />
            {props.scanStatus === "scanning" ? "Scanning…" : props.scanStatus === "done" ? "Scan again" : "Scan"}
          </Button>
        </div>

        <RootChips roots={props.roots} selected={props.selectedRoots} onToggle={props.onToggleRoot} />

        {props.scanStatus === "done" && (
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
          status={props.scanStatus}
          candidates={visible}
          totalFound={props.found.length}
          opening={opening}
          onOpen={onOpen}
        />
      </section>

      <section aria-labelledby="path-heading">
        <h3 id="path-heading" className="mb-3 text-xs uppercase tracking-widest text-muted">
          Or a path
        </h3>
        <form onSubmit={submitManual} className="flex gap-2">
          <input
            type="text"
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            placeholder="C:\Users\you\projects\name"
            spellCheck={false}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <Button type="submit" disabled={opening !== null || manualPath.trim() === ""}>
            {opening === manualPath.trim() ? "Opening…" : "Open"}
          </Button>
        </form>
      </section>
    </div>
  );
}

function RootChips({ roots, selected, onToggle }: { roots: string[]; selected: string[]; onToggle(root: string): void }) {
  if (roots.length === 0) {
    return <p className="text-sm text-muted">No usual code folders found under your home directory.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Folders to scan">
      {roots.map((root) => {
        const on = selected.includes(root);
        return (
          <li key={root}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(root)}
              title={root}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-accent",
              )}
            >
              {lastSegment(root)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function CandidateList({
  status,
  candidates,
  totalFound,
  opening,
  onOpen,
}: {
  status: "idle" | "scanning" | "done";
  candidates: LocatedRepository[];
  totalFound: number;
  opening: string | null;
  onOpen(path: string): void;
}) {
  if (status === "idle") {
    return <Notice tone="muted">Pick the folders above and scan to list the repositories inside them.</Notice>;
  }
  if (status === "scanning") {
    return <Notice tone="muted">Looking for repositories…</Notice>;
  }
  if (totalFound === 0) {
    return <Notice tone="muted">No repositories in the selected folders. Try another folder, or a path below.</Notice>;
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
