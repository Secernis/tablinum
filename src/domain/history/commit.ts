/** Who wrote a commit. Name and email together, because neither alone identifies a person across a history. */
export interface Author {
  name: string;
  email: string;
}

/** How much one author contributed, in commits. */
export interface AuthorActivity {
  author: Author;
  commits: number;
}

/** The size of a commit, as git's shortstat counts it. */
export interface CommitStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

/** One commit, as much of it as the overview shows. */
export interface Commit {
  /** Abbreviated hash — enough to name it to a person. */
  shortHash: string;
  subject: string;
  author: Author;
  /** Committer time, seconds since the epoch. */
  at: number;
  stats: CommitStats;
}
