import { useCallback, useEffect, useRef, useState } from "react";

import { sortByRecency, type LocatedRepository } from "@/domain/repository";
import { logWarn } from "@/lib/log";

import { useServices } from "../services-context";
import { describeRepositoryError, type RepositoryError } from "./gateway";

/** Whether the list is being (re)built. */
export type ListStatus = "idle" | "loading" | "ready";

/** What the start page gets to work with. */
export interface RepositoryList {
  /** The remembered repositories, described; newest commit first. Fills while loading. */
  repositories: LocatedRepository[];
  status: ListStatus;
  error: string | null;
  /** Ask for folders through the picker and add every repository inside them. */
  addFromFolders(): Promise<void>;
  /** Put one repository on the list, by its confirmed root. */
  add(path: string): void;
  remove(path: string): void;
}

/**
 * Use case: the repositories the user pointed the app at.
 *
 * The workspace remembers paths. On mount each one is described (branch and
 * newest commit) through the same scan the folder picker uses — a repository
 * path is a root the locator recognises at depth zero — so a repository added
 * on its own and one found in a folder are the same kind of row.
 *
 * "Add folder…" scans the chosen folders once and adds what it finds as
 * individual entries. There is no standing folder to rescan: the list is the
 * memory, and the user edits it row by row.
 */
export function useRepositoryList(): RepositoryList {
  const { repositories: gateway, workspace, folders } = useServices();
  const [repositories, setRepositories] = useState<LocatedRepository[]>([]);
  const [status, setStatus] = useState<ListStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // A rebuild that was superseded by a newer one must not append to the list.
  const generation = useRef(0);

  /** Describe the remembered paths into the list, from scratch. */
  const rebuild = useCallback(async () => {
    const mine = ++generation.current;
    const paths = workspace.readRepositories();
    setRepositories([]);
    setError(null);
    if (paths.length === 0) {
      setStatus("ready");
      return;
    }
    setStatus("loading");
    try {
      await gateway.discover(paths, (repository) => {
        if (generation.current !== mine) return;
        setRepositories((current) =>
          current.some((c) => c.path === repository.path) ? current : sortByRecency([...current, repository]),
        );
      });
      if (generation.current === mine) setStatus("ready");
    } catch (e) {
      logWarn("repositories.describe.failed", { error: e });
      if (generation.current === mine) {
        setError(describeRepositoryError(e as RepositoryError));
        setStatus("ready");
      }
    }
  }, [gateway, workspace]);

  // Only the first mount builds unasked; every edit rebuilds on its own.
  const firstMount = useRef(true);
  useEffect(() => {
    if (!firstMount.current) return;
    firstMount.current = false;
    void rebuild();
  }, [rebuild]);

  const remember = useCallback(
    (paths: string[]) => {
      const known = workspace.readRepositories();
      const fresh = paths.filter((p) => !known.includes(p));
      if (fresh.length === 0) return false;
      workspace.writeRepositories([...fresh, ...known]);
      return true;
    },
    [workspace],
  );

  const addFromFolders = useCallback(async () => {
    const picked = await folders.pickFolders("Choose folders that hold your repositories");
    if (picked.length === 0) return;
    setStatus("loading");
    setError(null);
    const foundPaths: string[] = [];
    try {
      await gateway.discover(picked, (repository) => foundPaths.push(repository.path));
    } catch (e) {
      logWarn("repositories.add-folder.failed", { error: e });
      setError(describeRepositoryError(e as RepositoryError));
      setStatus("ready");
      return;
    }
    if (foundPaths.length === 0) {
      setError("No git repositories in the chosen folders.");
      setStatus("ready");
      return;
    }
    remember(foundPaths);
    await rebuild();
  }, [folders, gateway, remember, rebuild]);

  const add = useCallback(
    (path: string) => {
      if (remember([path])) void rebuild();
    },
    [remember, rebuild],
  );

  const remove = useCallback(
    (path: string) => {
      workspace.writeRepositories(workspace.readRepositories().filter((p) => p !== path));
      setRepositories((current) => current.filter((r) => r.path !== path));
    },
    [workspace],
  );

  return { repositories, status, error, addFromFolders, add, remove };
}
