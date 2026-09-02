use super::Commit;

/// What a repository's history adds up to, at a glance.
///
/// An empty repository is a valid summary — zero commits, no timestamps, no
/// recent list — rather than an error. It is a state the picker can land on,
/// and the interface has to draw it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistorySummary {
    pub commit_count: u64,
    pub author_count: u64,
    /// Committer timestamp of the oldest root commit, if any.
    pub first_commit_at: Option<i64>,
    /// Committer timestamp of the newest commit, if any.
    pub last_commit_at: Option<i64>,
    /// The newest commits, newest first.
    pub recent: Vec<Commit>,
}

impl HistorySummary {
    /// The summary of a repository with no commits yet.
    pub fn empty() -> Self {
        HistorySummary {
            commit_count: 0,
            author_count: 0,
            first_commit_at: None,
            last_commit_at: None,
            recent: Vec::new(),
        }
    }
}
