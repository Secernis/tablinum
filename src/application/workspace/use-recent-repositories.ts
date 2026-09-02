import { useCallback, useState } from "react";

import { useServices } from "../services-context";
import type { RecentRepository } from "./workspace-store";

/** The recent list and the one edit a user makes to it. */
export interface Recents {
  recent: RecentRepository[];
  forget(path: string): void;
  /** Re-read the store, for after another use case wrote to it. */
  refresh(): void;
}

/** Use case: what was opened before. */
export function useRecentRepositories(): Recents {
  const { workspace } = useServices();
  const [recent, setRecent] = useState<RecentRepository[]>(() => workspace.readRecent());

  const refresh = useCallback(() => setRecent(workspace.readRecent()), [workspace]);

  const forget = useCallback(
    (path: string) => {
      const next = workspace.readRecent().filter((r) => r.path !== path);
      workspace.writeRecent(next);
      setRecent(next);
    },
    [workspace],
  );

  return { recent, forget, refresh };
}
