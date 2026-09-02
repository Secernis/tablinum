use super::Repository;

/// The tip of a repository, as much as a list entry needs to say.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeadInfo {
    /// Subject line of the newest commit.
    pub subject: String,
    /// Committer timestamp of the newest commit, seconds since the epoch.
    pub at: i64,
}

/// A repository found by a scan, with enough to choose it from a list.
///
/// Distinct from [`Repository`] because it carries the head — the one fact a
/// user picks by ("which one did I touch last week?") — and because a list of
/// forty of these has to be cheap. Everything else about the history is read
/// only once one of them is opened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocatedRepository {
    pub repository: Repository,
    /// `None` for a repository with no commits yet.
    pub head: Option<HeadInfo>,
}
