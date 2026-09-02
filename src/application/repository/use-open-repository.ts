import { useCallback, useState } from "react";

import type { OpenedRepository } from "@/domain/history";
import { logWarn } from "@/lib/log";

import { useServices } from "../services-context";
import type { WorkspaceStore } from "../workspace/workspace-store";
import { describeRepositoryError, type RepositoryError } from "./gateway";

/** What the picker needs to open one repository at a time. */
export interface Opener {
  /** Resolves to null when opening failed; `error` then says why. */
  open(path: string): Promise<OpenedRepository | null>;
  /** Ask for a folder through the picker, then open it. Null when cancelled or failed. */
  openFromDialog(): Promise<OpenedRepository | null>;
  /** The path currently being opened, or null. */
  opening: string | null;
  error: string | null;
  clearError(): void;
}

/**
 * Use case: open a repository and remember it as recent.
 *
 * The recent list is written here rather than by the caller because "opened"
 * and "remembered" are one event — a caller that could forget the second half
 * would produce a recent list that lies.
 */
export function useOpenRepository(): Opener {
  const { repositories, workspace, folders } = useServices();
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(
    async (path: string) => {
      setOpening(path);
      setError(null);
      try {
        const opened = await repositories.open(path);
        remember(workspace, opened);
        return opened;
      } catch (e) {
        logWarn("repository.open.failed", { path, error: e });
        setError(describeRepositoryError(e as RepositoryError));
        return null;
      } finally {
        setOpening(null);
      }
    },
    [repositories, workspace],
  );

  const openFromDialog = useCallback(async () => {
    const path = await folders.pickFolder("Open a git repository");
    return path ? open(path) : null;
  }, [folders, open]);

  return { open, openFromDialog, opening, error, clearError: () => setError(null) };
}

/** How many repositories the recent list keeps. */
const RECENT_LIMIT = 8;

function remember(store: WorkspaceStore, opened: OpenedRepository) {
  const { path, name } = opened.repository;
  const rest = store.readRecent().filter((r) => r.path !== path);
  store.writeRecent([{ path, name, openedAt: Date.now() }, ...rest].slice(0, RECENT_LIMIT));
}
