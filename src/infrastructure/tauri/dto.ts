/**
 * The shapes the backend sends, field for field.
 *
 * Kept apart from the domain types even where they currently coincide: the DTO
 * is the IPC contract and changes with the backend, the domain type changes
 * with the product. The mapping in `repository-gateway.ts` is where the two
 * are allowed to differ.
 */

export interface LanguageShareDto {
  name: string;
  code: number;
}

export interface CodeSizeDto {
  files: number;
  code: number;
  comments: number;
  blanks: number;
  languages: LanguageShareDto[];
}

export interface LocatedRepositoryDto {
  path: string;
  name: string;
  branch: string | null;
  headSubject: string | null;
  headAt: number | null;
  commitCount: number;
  code: CodeSizeDto | null;
}

export interface CommitDto {
  shortHash: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  at: number;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface HistorySummaryDto {
  commitCount: number;
  authorCount: number;
  firstCommitAt: number | null;
  lastCommitAt: number | null;
  recent: CommitDto[];
}

export interface OpenedRepositoryDto {
  path: string;
  name: string;
  branch: string | null;
  history: HistorySummaryDto;
}

export type ErrorDto =
  | { kind: "git-not-installed" }
  | { kind: "not-a-repository"; path: string }
  | { kind: "invalid-path"; reason: string }
  | { kind: "failed"; message: string };
