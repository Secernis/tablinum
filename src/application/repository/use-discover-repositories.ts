import { useCallback, useEffect, useRef, useState } from "react";

import { sortByRecency, type LocatedRepository } from "@/domain/repository";
import { logWarn } from "@/lib/log";

import { useServices } from "../services-context";
import { describeRepositoryError, type RepositoryError } from "./gateway";

/** Where a scan is at. */
export type DiscoveryStatus = "idle" | "scanning" | "done";

/** What the picker gets to work with. */
export interface Discovery {
  /** The folders a scan covers, as the user chose them; remembered. */
  roots: string[];
  /** Ask for more folders through the picker and scan them. */
  addRoots(): Promise<void>;
  removeRoot(root: string): void;
  /** Newest commit first; fills while a scan runs. */
  found: LocatedRepository[];
  status: DiscoveryStatus;
  error: string | null;
  scan(): Promise<void>;
}

/**
 * Use case: find the repositories in the folders the user chose.
 *
 * Scans on mount when folders are remembered, and again after one is added —
 * a scan is cheap (milliseconds for the walk, one git process per repository)
 * and the list arriving unasked is what makes the picker feel like it already
 * knows the machine. It never guesses a folder itself.
 */
export function useDiscoverRepositories(): Discovery {
  const { repositories, workspace, folders } = useServices();
  const [roots, setRoots] = useState<string[]>(() => workspace.readScanRoots());
  const [found, setFound] = useState<LocatedRepository[]>([]);
  const [status, setStatus] = useState<DiscoveryStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // A scan that was superseded by a newer one must not append to its list.
  const generation = useRef(0);

  const scanRoots = useCallback(
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
          setFound((current) => sortByRecency([...current, repository]));
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

  const scan = useCallback(() => scanRoots(roots), [scanRoots, roots]);

  // Only the first mount scans unasked; later root changes trigger their own
  // scan in `addRoots` and `removeRoot`, and must not run twice.
  const firstMount = useRef(true);
  useEffect(() => {
    if (!firstMount.current) return;
    firstMount.current = false;
    void scanRoots(roots);
  }, [scanRoots, roots]);

  const addRoots = useCallback(async () => {
    const picked = await folders.pickFolders("Choose folders to scan for repositories");
    const next = [...roots, ...picked.filter((p) => !roots.includes(p))];
    if (next.length === roots.length) return;
    setRoots(next);
    workspace.writeScanRoots(next);
    await scanRoots(next);
  }, [folders, roots, workspace, scanRoots]);

  const removeRoot = useCallback(
    (root: string) => {
      const next = roots.filter((r) => r !== root);
      setRoots(next);
      workspace.writeScanRoots(next);
      void scanRoots(next);
    },
    [roots, workspace, scanRoots],
  );

  return { roots, addRoots, removeRoot, found, status, error, scan };
}
