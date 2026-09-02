import type { OpenedRepository } from "@/domain/history";
import type { LocatedRepository } from "@/domain/repository";

/**
 * Why a repository operation could not deliver.
 *
 * Mirrors the backend's tagged error so the interface can react by kind — a
 * missing git is explained once, a wrong folder is recovered from in place —
 * plus `unknown` for anything that did not come back in that shape.
 */
export type RepositoryError =
  | { kind: "git-not-installed" }
  | { kind: "not-a-repository"; path: string }
  | { kind: "invalid-path"; reason: string }
  | { kind: "failed"; message: string }
  | { kind: "unknown"; message: string };

/** One sentence the user can act on. */
export function describeRepositoryError(error: RepositoryError): string {
  switch (error.kind) {
    case "git-not-installed":
      return "git is not installed on this machine, or not on the PATH.";
    case "not-a-repository":
      return `${error.path} is not a git repository.`;
    case "invalid-path":
      return error.reason;
    case "failed":
      return `git reported: ${error.message}`;
    case "unknown":
      return error.message;
  }
}

/**
 * The port through which the app reaches repositories.
 *
 * This is everything a use case may ask for — and therefore everything a test
 * double has to provide. Widening it is a decision.
 */
export interface RepositoryGateway {
  /**
   * Every repository under `roots`, handed to `onFound` as each one is
   * described. Resolves with the total once the scan is over. Rejects with a
   * `RepositoryError`.
   */
  discover(roots: string[], onFound: (repository: LocatedRepository) => void): Promise<number>;
  /** Open the repository at `path` and summarize it. Rejects with a `RepositoryError`. */
  open(path: string): Promise<OpenedRepository>;
}
