import type { RecentRepository, WorkspaceStore } from "@/application/workspace/workspace-store";
import { logWarn } from "@/lib/log";

const RECENT_KEY = "tablinum.recent-repositories";
const SCAN_ROOTS_KEY = "tablinum.scan-roots";

function isRecent(value: unknown): value is RecentRepository {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.path === "string" && typeof v.name === "string" && typeof v.openedAt === "number";
}

/**
 * Read a JSON array from local storage, keeping only the items that pass `isItem`.
 *
 * Every read validates the shape: the value was written by an earlier version
 * of this app, and a field that moved must degrade to "nothing remembered"
 * rather than to a picker that throws on its first render.
 */
function readList<T>(key: string, isItem: (value: unknown) => value is T): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isItem) : [];
  } catch (e) {
    // Private window, blocked site data, or a corrupt value: what is
    // remembered is a convenience, and an empty list is the correct fallback.
    logWarn("workspace.read.failed", { key, error: e });
    return [];
  }
}

function writeList(key: string, list: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch (e) {
    logWarn("workspace.write.failed", { key, error: e });
  }
}

/** The workspace memory in local storage. */
export function createLocalWorkspaceStore(): WorkspaceStore {
  return {
    readRecent: () => readList(RECENT_KEY, isRecent),
    writeRecent: (entries) => writeList(RECENT_KEY, entries),
    readScanRoots: () => readList(SCAN_ROOTS_KEY, (v): v is string => typeof v === "string"),
    writeScanRoots: (roots) => writeList(SCAN_ROOTS_KEY, roots),
  };
}
