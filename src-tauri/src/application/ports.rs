//! The ports: what the use cases need from the outside world.
//!
//! Each trait is the whole of what a use case may ask for. Widening one is a
//! decision — it is also the list of everything an adapter has to fake in a
//! test.

use std::path::PathBuf;

use crate::domain::analysis::CodeSize;
use crate::domain::history::{Commit, HistorySummary};
use crate::domain::repository::{HeadInfo, RepoPath, Repository};

use super::AppError;

/// Finds directories that look like repositories.
///
/// Deliberately no notion of a default root: where a person keeps their code
/// is theirs to say, and a guess that is wrong reads as the app not working.
pub trait RepositoryLocator: Sync {
    /// Every repository under `roots`, at most `max_depth` levels down.
    fn locate(&self, roots: &[PathBuf], max_depth: usize) -> Vec<RepoPath>;
}

/// Reads a repository's history.
pub trait HistorySource: Sync {
    /// Confirm that `path` is a repository and name its branch.
    fn describe(&self, path: &RepoPath) -> Result<Repository, AppError>;

    /// The newest commit, or `None` for a repository without commits.
    fn head(&self, repository: &Repository) -> Result<Option<HeadInfo>, AppError>;

    /// How many commits HEAD reaches; zero for a repository without commits.
    fn commit_count(&self, repository: &Repository) -> Result<u64, AppError>;

    /// Totals plus the `recent_limit` newest commits.
    fn summarize(&self, repository: &Repository, recent_limit: usize) -> Result<HistorySummary, AppError>;

    /// A page of the log, newest first: `limit` commits after skipping `skip`.
    fn commits(&self, repository: &Repository, skip: usize, limit: usize) -> Result<Vec<Commit>, AppError>;
}

/// Measures a repository's code.
pub trait CodeSizeSource: Sync {
    /// Lines by language, honouring the repository's own ignore rules.
    fn measure(&self, repository: &Repository) -> Result<CodeSize, AppError>;
}
