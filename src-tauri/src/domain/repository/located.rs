use super::Repository;
use crate::domain::analysis::CodeSize;

/// The tip of a repository, as much as a list entry needs to say.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeadInfo {
    /// Subject line of the newest commit.
    pub subject: String,
    /// Committer timestamp of the newest commit, seconds since the epoch.
    pub at: i64,
}

/// A repository on the start page, with enough to choose it from a list.
///
/// Distinct from [`Repository`] because it carries what a list row shows: the
/// head (the one fact a user picks by), the commit count, and the size of the
/// code. Everything else about the history is read once one of them is opened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocatedRepository {
    pub repository: Repository,
    /// `None` for a repository with no commits yet.
    pub head: Option<HeadInfo>,
    /// Zero for a repository with no commits yet.
    pub commit_count: u64,
    /// `None` when the code could not be measured; the row still renders.
    pub code: Option<CodeSize>,
}
