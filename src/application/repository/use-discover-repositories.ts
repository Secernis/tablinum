import { useCallback, useEffect, useState } from "react";

import type { LocatedRepository } from "@/domain/repository";
import { logWarn } from "@/lib/log";

import { useServices } from "../services-context";
import { describeRepositoryError, type RepositoryError } from "./gateway";

/** Where a scan is at. */
export type DiscoveryStatus = "idle" | "scanning" | "done";

/** What the picker gets to work with. */
export interface Discovery {
  /** The roots the backend suggests; loaded once. */
  roots: string[];
  /** The subset of `roots` the next scan covers. */
  selectedRoots: string[];
  toggleRoot(root: string): void;
  found: LocatedRepository[];
  status: DiscoveryStatus;
  error: string | null;
  scan(): Promise<void>;
}

/**
 * Use case: find the repositories on this machine.
 *
 * Loads the default roots on mount and scans only on request — a scan spawns
 * one git process per repository, which is not something to do behind the
 * user's back every time the picker mounts.
 */
export function useDiscoverRepositories(): Discovery {
  const { repositories } = useServices();
  const [roots, setRoots] = useState<string[]>([]);
  const [selectedRoots, setSelectedRoots] = useState<string[]>([]);
  const [found, setFound] = useState<LocatedRepository[]>([]);
  const [status, setStatus] = useState<DiscoveryStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    repositories
      .defaultRoots()
      .then((r) => {
        if (cancelled) return;
        setRoots(r);
        setSelectedRoots(r);
      })
      .catch((e: RepositoryError) => {
        logWarn("discover.roots.failed", { error: e });
        if (!cancelled) setError(describeRepositoryError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [repositories]);

  const toggleRoot = useCallback((root: string) => {
    setSelectedRoots((current) =>
      current.includes(root) ? current.filter((r) => r !== root) : [...current, root],
    );
  }, []);

  const scan = useCallback(async () => {
    setStatus("scanning");
    setError(null);
    try {
      setFound(await repositories.discover(selectedRoots));
      setStatus("done");
    } catch (e) {
      logWarn("discover.scan.failed", { error: e });
      setError(describeRepositoryError(e as RepositoryError));
      setStatus("idle");
    }
  }, [repositories, selectedRoots]);

  return { roots, selectedRoots, toggleRoot, found, status, error, scan };
}
