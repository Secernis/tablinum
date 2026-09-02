use std::path::PathBuf;

use crate::domain::history::HistorySummary;
use crate::domain::repository::{RepoPath, Repository};

use super::ports::HistorySource;
use super::AppError;

/// A repository the user has opened, with its history at a glance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenedRepository {
    pub repository: Repository,
    pub history: HistorySummary,
}

/// How many commits the overview lists.
const RECENT_LIMIT: usize = 20;

/// Open the repository at `path` and summarize its history.
///
/// The path arrives as the user typed or picked it. It is validated as a
/// directory here and as a repository by the source — two different questions
/// with two different answers for the person who asked.
pub fn open_repository(
    source: &dyn HistorySource,
    path: impl Into<PathBuf>,
) -> Result<OpenedRepository, AppError> {
    let path = RepoPath::new(path)?;
    let repository = source.describe(&path)?;
    let history = source.summarize(&repository, RECENT_LIMIT)?;
    Ok(OpenedRepository { repository, history })
}
