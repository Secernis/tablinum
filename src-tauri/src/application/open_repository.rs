use std::path::PathBuf;

use crate::domain::analysis::CodeSize;
use crate::domain::history::HistorySummary;
use crate::domain::repository::{RepoPath, Repository};

use super::ports::{CodeSizeSource, HistorySource};
use super::AppError;

/// A repository the user has opened, with its history and its size at a glance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenedRepository {
    pub repository: Repository,
    pub history: HistorySummary,
    /// `None` when the code could not be measured; the overview still renders.
    pub code: Option<CodeSize>,
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
    code: &dyn CodeSizeSource,
    path: impl Into<PathBuf>,
) -> Result<OpenedRepository, AppError> {
    let path = RepoPath::new(path)?;
    let repository = source.describe(&path)?;
    let history = source.summarize(&repository, RECENT_LIMIT)?;
    // A measurement that fails is a missing panel, not a failed open: the
    // history is what the user came for.
    let code = match code.measure(&repository) {
        Ok(size) => Some(size),
        Err(e) => {
            log::warn!("open.measure.failed path={path} error={e}");
            None
        }
    };
    Ok(OpenedRepository { repository, history, code })
}
