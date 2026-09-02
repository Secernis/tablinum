import { useCallback, useEffect, useRef, useState } from "react";

import { sortByRecency, type LocatedRepository } from "@/domain/repository";
import { logWarn } from "@/lib/log";

import { useServices } from "../services-context";
import { describeRepositoryError, type RepositoryError } from "./gateway";

/** Where a scan is at. */
export type DiscoveryStatus = "idle" | "scanning" | "done";

/** What the start page gets to work with. */
export interface Discovery {
  /** The folders a scan covers, as the user chose them; remembered. */
  roots: string[];
  /** Repositories added one at a time through the folder dialog; remembered. */
  added: string[];
  /** Ask for more folders through the picker and scan them. */
  addRoots(): Promise<void>;
  removeRoot(root: string): void;
  removeAdded(path: string): void;
  /** Everything remembered, described; newest commit first. Fills while a scan runs. */
  found: LocatedRepository[];
  status: DiscoveryStatus;
  error: string | null;
  scan(): Promise<void>;
}

/**
 * Use case: the repositories the user pointed the app at.
 *
 * One list from two memories: the folders that are scanned for repositories,
 * and the repositories added one at a time. A repository added directly is
 * scanned as its own root — the locator recognises a repository at depth zero
 * — so both kinds are described the same way and sort into the same list.
 *
 * Scans on mount and after every change to either memory; a scan is cheap
 * (milliseconds for the walk, one git process per repository). It never
 * guesses a folder itself.
 */
export function useDiscoverRepositories(): Discovery {
  const { repositories, workspace, folders } = useServices();
  const [roots, setRoots] = useState<string[]>(() => workspace.readScanRoots());
  const [added, setAdded] = useState<string[]>(() => workspace.readAddedRepositories());
  const [found, setFound] = useState<LocatedRepository[]>([]);
  const [status, setStatus] = useState<DiscoveryStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // A scan that was superseded by a newer one must not append to its list.
  const generation = useRef(0);

  const scanTargets = useCallback(
    async (targets: string[]) => {
      const mine = ++generation.current;
      setFound([]);
      setError(null);
      if (targets.length === 0) {
        setStatus("idle");
        return;
      }
      setStatus("scanning");
      try {
        await repositories.discover(targets, (repository) => {
          if (generation.current !== mine) return;
          setFound((current) =>
            current.some((c) => c.path === repository.path) ? current : sortByRecency([...current, repository]),
          );
        });
        if (generation.current === mine) setStatus("done");
      } catch (e) {
        logWarn("discover.scan.failed", { error: e });
        if (generation.current === mine) {
          setError(describeRepositoryError(e as RepositoryError));
          setStatus("idle");
        }
      }
    },
    [repositories],
  );

  const scan = useCallback(() => scanTargets([...roots, ...added]), [scanTargets, roots, added]);

  // The store may have been written by the open use case since the last scan;
  // re-read it whenever the list is rebuilt so a freshly opened repository
  // shows up without a second memory to keep in sync.
  const rescanFromStore = useCallback(() => {
    const nextRoots = workspace.readScanRoots();
    const nextAdded = workspace.readAddedRepositories();
    setRoots(nextRoots);
    setAdded(nextAdded);
    return scanTargets([...nextRoots, ...nextAdded]);
  }, [workspace, scanTargets]);

  // Only the first mount scans unasked; later changes trigger their own scan.
  const firstMount = useRef(true);
  useEffect(() => {
    if (!firstMount.current) return;
    firstMount.current = false;
    void rescanFromStore();
  }, [rescanFromStore]);

  const addRoots = useCallback(async () => {
    const picked = await folders.pickFolders("Choose folders to scan for repositories");
    const next = [...roots, ...picked.filter((p) => !roots.includes(p))];
    if (next.length === roots.length) return;
    workspace.writeScanRoots(next);
    await rescanFromStore();
  }, [folders, roots, workspace, rescanFromStore]);

  const removeRoot = useCallback(
    (root: string) => {
      workspace.writeScanRoots(roots.filter((r) => r !== root));
      void rescanFromStore();
    },
    [roots, workspace, rescanFromStore],
  );

  const removeAdded = useCallback(
    (path: string) => {
      workspace.writeAddedRepositories(added.filter((p) => p !== path));
      void rescanFromStore();
    },
    [added, workspace, rescanFromStore],
  );

  return { roots, added, addRoots, removeRoot, removeAdded, found, status, error, scan };
}
