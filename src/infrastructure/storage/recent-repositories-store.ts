import type {
  RecentRepositoriesStore,
  RecentRepository,
} from "@/application/workspace/recent-repositories-store";
import { logWarn } from "@/lib/log";

const KEY = "tablinum.recent-repositories";

function isEntry(value: unknown): value is RecentRepository {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.path === "string" && typeof v.name === "string" && typeof v.openedAt === "number";
}

/**
 * The recent list in local storage.
 *
 * Every read validates the shape: the value was written by an earlier version
 * of this app, and a field that moved must degrade to "no recents" rather than
 * to a picker that throws on its first render.
 */
export function createLocalRecentRepositoriesStore(): RecentRepositoriesStore {
  return {
    read() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
      } catch (e) {
        // Private window, blocked site data, or a corrupt value: the list is
        // a convenience, and an empty one is the correct fallback.
        logWarn("recent.read.failed", { error: e });
        return [];
      }
    },
    write(entries) {
      try {
        localStorage.setItem(KEY, JSON.stringify(entries));
      } catch (e) {
        logWarn("recent.write.failed", { error: e });
      }
    },
  };
}
