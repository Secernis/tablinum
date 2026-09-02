import { useCallback, useState } from "react";

import type { OpenedRepository } from "@/domain/history";
import { logWarn } from "@/lib/log";

import { useServices } from "../services-context";
import { describeRepositoryError, type RepositoryError } from "./gateway";

/** What the start page needs to open one repository at a time. */
export interface Opener {
  /** Resolves to null when opening failed; `error` then says why. */
  open(path: string): Promise<OpenedRepository | null>;
  /**
   * Ask for a folder through the picker, open it, and remember it in the
   * list. Null when cancelled or failed.
   */
  openFromDialog(): Promise<OpenedRepository | null>;
  /** The path currently being opened, or null. */
  opening: string | null;
  error: string | null;
  clearError(): void;
}

/**
 * Use case: open a repository.
 *
 * Opening from the dialog also adds the repository to the workspace, because
 * "opened once" and "on the list" are one event from the user's side: what
 * they pointed the app at is what the start page shows.
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
        return await repositories.open(path);
      } catch (e) {
        logWarn("repository.open.failed", { path, error: e });
        setError(describeRepositoryError(e as RepositoryError));
        return null;
      } finally {
        setOpening(null);
      }
    },
    [repositories],
  );

  const openFromDialog = useCallback(async () => {
    const path = await folders.pickFolder("Open a git repository");
    if (!path) return null;
    const opened = await open(path);
    if (opened) {
      // The confirmed root, not the picked path: a subfolder of a repository
      // opens fine, but the list should show the repository.
      const root = opened.repository.path;
      const known = workspace.readAddedRepositories();
      if (!known.includes(root)) workspace.writeAddedRepositories([root, ...known]);
    }
    return opened;
  }, [folders, open, workspace]);

  return { open, openFromDialog, opening, error, clearError: () => setError(null) };
}
