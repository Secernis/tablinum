import { useCallback, useState } from "react";

import type { OpenedRepository } from "@/domain/history";
import { logWarn } from "@/lib/log";

import { useServices } from "../services-context";
import { describeRepositoryError, type RepositoryError } from "./gateway";

/** What the start page needs to open one repository at a time. */
export interface Opener {
  /** Resolves to null when opening failed; `error` then says why. */
  open(path: string): Promise<OpenedRepository | null>;
  /** Ask for a folder through the picker and open it. Null when cancelled or failed. */
  openFromDialog(): Promise<OpenedRepository | null>;
  /** The path currently being opened, or null. */
  opening: string | null;
  error: string | null;
  clearError(): void;
}

/**
 * Use case: open a repository.
 *
 * Remembering it on the list is the caller's job (see `useRepositoryList`),
 * because the confirmed root only exists once the open has succeeded, and the
 * list is the one place that decides what it holds.
 */
export function useOpenRepository(): Opener {
  const { repositories, folders } = useServices();
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
    return path ? open(path) : null;
  }, [folders, open]);

  return { open, openFromDialog, opening, error, clearError: () => setError(null) };
}
