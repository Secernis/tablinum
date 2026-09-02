use super::{AuthorActivity, Commit};

/// What a repository's history adds up to, at a glance.
///
/// An empty repository is a valid summary — zero commits, no timestamps, no
/// recent list — rather than an error. It is a state the picker can land on,
/// and the interface has to draw it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistorySummary {
    pub commit_count: u64,
    /// Every author with a commit, most commits first.
    pub authors: Vec<AuthorActivity>,
    /// Committer timestamp of the oldest root commit, if any.
    pub first_commit_at: Option<i64>,
    /// Committer timestamp of the newest commit, if any.
    pub last_commit_at: Option<i64>,
    /// The newest commits, newest first.
    pub recent: Vec<Commit>,
}

impl HistorySummary {
    /// How many people have committed.
    pub fn author_count(&self) -> u64 {
        self.authors.len() as u64
    }

    /// The summary of a repository with no commits yet.
    pub fn empty() -> Self {
        HistorySummary {
            commit_count: 0,
            authors: Vec::new(),
            first_commit_at: None,
            last_commit_at: None,
            recent: Vec::new(),
        }
    }
}
