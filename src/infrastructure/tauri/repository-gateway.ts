import { Channel, invoke } from "@tauri-apps/api/core";

import type { RepositoryError, RepositoryGateway } from "@/application/repository/gateway";
import type { OpenedRepository } from "@/domain/history";
import type { LocatedRepository } from "@/domain/repository";

import type { ErrorDto, LocatedRepositoryDto, OpenedRepositoryDto } from "./dto";

/** The command names, as registered in the backend's composition root. */
const COMMANDS = {
  discover: "discover_repositories",
  open: "open_repository",
} as const;

function toLocated(dto: LocatedRepositoryDto): LocatedRepository {
  return {
    path: dto.path,
    name: dto.name,
    branch: dto.branch,
    headSubject: dto.headSubject,
    headAt: dto.headAt,
  };
}

function toOpened(dto: OpenedRepositoryDto): OpenedRepository {
  return {
    repository: { path: dto.path, name: dto.name, branch: dto.branch },
    history: {
      commitCount: dto.history.commitCount,
      authorCount: dto.history.authorCount,
      firstCommitAt: dto.history.firstCommitAt,
      lastCommitAt: dto.history.lastCommitAt,
      recent: dto.history.recent.map((c) => ({
        shortHash: c.shortHash,
        subject: c.subject,
        author: { name: c.authorName, email: c.authorEmail },
        at: c.at,
        stats: { filesChanged: c.filesChanged, insertions: c.insertions, deletions: c.deletions },
      })),
    },
  };
}

/**
 * Turn whatever `invoke` rejected with into a `RepositoryError`.
 *
 * A rejection is only a tagged DTO when the backend command returned one; an
 * IPC failure or an unregistered command rejects with a string, and that has
 * to surface as a message rather than crash the mapping.
 */
function toError(reason: unknown): RepositoryError {
  if (typeof reason === "object" && reason !== null && "kind" in reason) {
    return reason as ErrorDto;
  }
  return { kind: "unknown", message: typeof reason === "string" ? reason : String(reason) };
}

/** The gateway backed by Tauri commands. */
export function createTauriRepositoryGateway(): RepositoryGateway {
  return {
    discover(roots, onFound) {
      // A channel rather than an event: it is scoped to this one call, so two
      // overlapping scans cannot feed each other's listeners.
      const onFoundChannel = new Channel<LocatedRepositoryDto>();
      onFoundChannel.onmessage = (dto) => onFound(toLocated(dto));
      return invoke<number>(COMMANDS.discover, { roots, onFound: onFoundChannel }).catch((e) =>
        Promise.reject(toError(e)),
      );
    },
    open: (path) =>
      invoke<OpenedRepositoryDto>(COMMANDS.open, { path })
        .then(toOpened)
        .catch((e) => Promise.reject(toError(e))),
  };
}
