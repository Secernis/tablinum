use std::path::PathBuf;

use crate::domain::history::Commit;
use crate::domain::repository::RepoPath;

use super::ports::HistorySource;
use super::AppError;

/// The most commits one page may ask for.
///
/// The interface reveals five at a time; a cap well above that keeps a
/// mistaken call from asking git for the whole history in one go.
const PAGE_MAX: usize = 100;

/// A page of the log of the repository at `path`, newest first.
///
/// Pages by offset because that is what the interface does — "five more" —
/// and because the log of a repository does not change underneath an open
/// overview. If it did, a cursor by hash would be the honest answer.
pub fn list_commits(
    source: &dyn HistorySource,
    path: impl Into<PathBuf>,
    skip: usize,
    limit: usize,
) -> Result<Vec<Commit>, AppError> {
    let path = RepoPath::new(path)?;
    let repository = source.describe(&path)?;
    source.commits(&repository, skip, limit.clamp(1, PAGE_MAX))
}
