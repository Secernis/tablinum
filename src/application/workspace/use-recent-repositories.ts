import { useCallback, useState } from "react";

import { useServices } from "../services-context";
import type { RecentRepository } from "./recent-repositories-store";

/** The recent list and the one edit a user makes to it. */
export interface Recents {
  recent: RecentRepository[];
  forget(path: string): void;
  /** Re-read the store, for after another use case wrote to it. */
  refresh(): void;
}

/** Use case: what was opened before. */
export function useRecentRepositories(): Recents {
  const { recentRepositories } = useServices();
  const [recent, setRecent] = useState<RecentRepository[]>(() => recentRepositories.read());

  const refresh = useCallback(() => setRecent(recentRepositories.read()), [recentRepositories]);

  const forget = useCallback(
    (path: string) => {
      const next = recentRepositories.read().filter((r) => r.path !== path);
      recentRepositories.write(next);
      setRecent(next);
    },
    [recentRepositories],
  );

  return { recent, forget, refresh };
}
