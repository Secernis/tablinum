import { useCallback, useEffect, useState } from "react";

import type { Commit, OpenedRepository } from "@/domain/history";
import { logWarn } from "@/lib/log";

import { describeRepositoryError, type RepositoryError } from "../repository/gateway";
import { useServices } from "../services-context";

/** How many commits one step reveals. */
export const COMMITS_STEP = 5;

/** The log as the overview shows it: a window that grows five at a time. */
export interface CommitLog {
  /** The commits currently shown, newest first. */
  shown: Commit[];
  /** How many the repository has in total. */
  total: number;
  /** How many are not shown yet. */
  remaining: number;
  loading: boolean;
  error: string | null;
  /** Reveal the next five, fetching them when they are not loaded yet. */
  more(): Promise<void>;
  /** Back to the first five. What was loaded stays loaded. */
  fewer(): void;
}

/**
 * Use case: page through a repository's log five commits at a time.
 *
 * The summary brings the first twenty along, so the first three steps cost
 * nothing; from there each step fetches from the backend. "Fewer" only
 * narrows the window — the loaded commits are kept, so opening again is
 * instant.
 */
export function useCommitLog(opened: OpenedRepository): CommitLog {
  const { repositories } = useServices();
  const [loaded, setLoaded] = useState<Commit[]>(opened.history.recent);
  const [shownCount, setShownCount] = useState(COMMITS_STEP);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A different repository is a different log.
  useEffect(() => {
    setLoaded(opened.history.recent);
    setShownCount(COMMITS_STEP);
    setError(null);
  }, [opened]);

  const total = opened.history.commitCount;

  const more = useCallback(async () => {
    const wanted = shownCount + COMMITS_STEP;
    if (loaded.length >= wanted || loaded.length >= total) {
      setShownCount(wanted);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const page = await repositories.commits(opened.repository.path, loaded.length, wanted - loaded.length);
      setLoaded((current) => [...current, ...page]);
      setShownCount(wanted);
    } catch (e) {
      logWarn("commits.page.failed", { path: opened.repository.path, error: e });
      setError(describeRepositoryError(e as RepositoryError));
    } finally {
      setLoading(false);
    }
  }, [repositories, opened.repository.path, loaded.length, shownCount, total]);

  const fewer = useCallback(() => setShownCount(COMMITS_STEP), []);

  const shown = loaded.slice(0, shownCount);
  return { shown, total, remaining: Math.max(total - shown.length, 0), loading, error, more, fewer };
}
